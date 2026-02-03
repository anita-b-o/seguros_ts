# backend/policies/views.py
from __future__ import annotations

import secrets
import string
from calendar import monthrange
from datetime import date, timedelta

from django.db import IntegrityError
from django.db.models import Case, Count, IntegerField, Prefetch, Q, Value, When
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from audit.helpers import AuditModelViewSetMixin
from common.models import AppSettings
from payments.billing import (
    ensure_current_billing_period,
    get_current_billing_period,
    mark_overdue_and_suspend_if_needed,
    reactivate_policy_if_applicable,
)
from payments.models import BillingPeriod, Payment, Receipt
from payments.serializers import ReceiptSerializer
from payments.utils import generate_receipt_pdf

from .access import policy_scope_queryset
from .models import Policy, PolicyVehicle
from .serializers import (
    AdminPolicyCreateSerializer,
    BillingPeriodCurrentSerializer,
    PolicyClientDetailSerializer,
    PolicyClientListSerializer,
    PolicySerializer,
    PolicyVehicleSerializer,
)


# ----------------------------
# Pagination: receipts (dashboard)
# ----------------------------
class ReceiptsPagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = "page_size"
    max_page_size = 50


def _gen_claim_code(length=8):
    alphabet = string.ascii_uppercase + string.digits
    return "SC-" + "".join(secrets.choice(alphabet) for _ in range(length))


def _get_settings_obj():
    try:
        return AppSettings.get_solo()
    except Exception:
        return None


def _add_months(start_date, months):
    """
    Suma meses conservando el día cuando es posible; si el mes de destino
    no tiene ese día (p. ej., 31 a febrero), se usa el último día del mes.
    """
    if not start_date or months is None:
        return None
    if months == 0:
        return start_date
    year = start_date.year + (start_date.month - 1 + months) // 12
    month = (start_date.month - 1 + months) % 12 + 1
    day = start_date.day
    last_day = monthrange(year, month)[1]
    return date(year, month, min(day, last_day))


def _date_in_window(start, end, today=None):
    today = today or date.today()
    if not start or not end:
        return False
    if isinstance(start, str):
        try:
            start = date.fromisoformat(start)
        except ValueError:
            return False
    if isinstance(end, str):
        try:
            end = date.fromisoformat(end)
        except ValueError:
            return False
    return start <= today <= end


def _policy_timeline(policy, *, settings_obj=None, period=None):
    """
    Timeline backend-first:
    - Calcula ciclo de pago SIEMPRE usando settings (aunque no haya BillingPeriod).
    - "vencimiento adelantado" = early_due (lo que ve el cliente)
    - vencimiento real = cycle_end (último día del período)
    - BillingPeriod (si existe) se usa solo para enriquecer/consistir, NO como requisito.

    ✅ Ventana de ajuste:
    policy_adjustment_window_days días ANTES de end_date.
    Si end_date = 20 y window=5 => [15..19] (end_date no se incluye).
    """
    today = date.today()
    settings_obj = settings_obj or _get_settings_obj()

    cycle = None
    if hasattr(policy, "payment_cycle_dates"):
        try:
            cycle = policy.payment_cycle_dates(settings_obj=settings_obj, today=today)
        except Exception:
            cycle = None

    # Defaults desde ciclo (si existe)
    payment_start = cycle["cycle_start"] if cycle else getattr(policy, "start_date", None)
    payment_end = cycle["cycle_end"] if cycle else getattr(policy, "end_date", None)
    client_due = cycle["early_due"] if cycle else getattr(policy, "end_date", None)
    real_due = payment_end

    # BillingPeriod: sólo pisa si trae valores útiles
    if period is not None:
        p_start = getattr(period, "period_start", None)
        d_soft = getattr(period, "due_date_soft", None)
        d_hard = getattr(period, "due_date_hard", None)

        if p_start:
            payment_start = p_start
        if d_hard:
            payment_end = d_hard
            real_due = d_hard
        if d_soft:
            client_due = d_soft

    # ✅ Período de ajuste por preferencia del admin
    adjustment_from = adjustment_to = None
    if settings_obj:
        try:
            window_days = int(getattr(settings_obj, "policy_adjustment_window_days", 0) or 0)
        except Exception:
            window_days = 0

        end = getattr(policy, "end_date", None)
        if window_days > 0 and end:
            adjustment_from = end - timedelta(days=window_days)
            adjustment_to = end - timedelta(days=1)

    return {
        "real_end_date": real_due,
        "client_end_date": client_due,
        "payment_start_date": payment_start,
        "payment_end_date": payment_end,
        "adjustment_from": adjustment_from,
        "adjustment_to": adjustment_to,
        "payment_window_days": cycle.get("window_days") if cycle else None,
        "payment_early_due_days": cycle.get("early_due_days") if cycle else None,
    }


def _client_status(status, client_end, real_end, payment_end=None, billing_status=None):
    if status in ["cancelled", "inactive", "suspended"]:
        return status
    if billing_status:
        try:
            if billing_status == BillingPeriod.Status.OVERDUE:
                return "expired"
            if billing_status in (BillingPeriod.Status.PAID, BillingPeriod.Status.UNPAID):
                return "active"
        except Exception:
            s = str(billing_status).upper()
            if s == "OVERDUE":
                return "expired"
            if s in ("PAID", "UNPAID"):
                return "active"
    today = date.today()

    def _to_date(v):
        if v is None:
            return None
        if isinstance(v, date):
            return v
        if isinstance(v, str):
            try:
                return date.fromisoformat(v)
            except ValueError:
                return None
        return None

    real_end = _to_date(real_end)
    payment_end = _to_date(payment_end)
    client_end = _to_date(client_end)

    # expired si venció el hard
    if real_end and real_end < today:
        return "expired"

    # no_coverage si venció el soft
    if client_end and client_end < today:
        return "no_coverage"

    return status or "active"


def _ensure_current_cycle(policy, *, now=None, allow_create=False):
    """
    BillingPeriod puede existir o no. Para UI no es requisito.
    En endpoints cliente permitimos crear BillingPeriod para mantener lógica de cobro/suspensión.
    """
    today = now or timezone.localdate()
    if allow_create:
        period = ensure_current_billing_period(policy, now=today)
        if period:
            mark_overdue_and_suspend_if_needed(policy, period, now=today)
        return period
    return get_current_billing_period(policy, now=today)


def _soft_delete_policy(policy: Policy):
    if hasattr(policy, "soft_delete") and callable(getattr(policy, "soft_delete")):
        policy.soft_delete()
        return

    if not hasattr(policy, "is_deleted"):
        raise AttributeError("Policy no tiene soft delete (falta is_deleted o soft_delete()).")

    policy.is_deleted = True
    if hasattr(policy, "deleted_at"):
        policy.deleted_at = timezone.now()
        policy.save(update_fields=["is_deleted", "deleted_at", "updated_at"])
    else:
        policy.save(update_fields=["is_deleted", "updated_at"])


def _restore_policy(policy: Policy):
    if hasattr(policy, "restore") and callable(getattr(policy, "restore")):
        policy.restore()
        return

    if not hasattr(policy, "is_deleted"):
        raise AttributeError("Policy no tiene soft delete (falta is_deleted o restore()).")

    policy.is_deleted = False
    if hasattr(policy, "deleted_at"):
        policy.deleted_at = None
        policy.save(update_fields=["is_deleted", "deleted_at", "updated_at"])
    else:
        policy.save(update_fields=["is_deleted", "updated_at"])


class IsOwnerOrAdmin(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return bool(user.is_staff or obj.user_id == user.id)


class PolicyBaseViewSet(viewsets.ModelViewSet):
    serializer_class = PolicySerializer

    def get_queryset(self):
        """
        Default (no-admin): por seguridad NO incluye eliminadas.
        Admin: puede pedir include_deleted=true o deleted_only=true si lo necesitás.
        """
        base_qs = (
            Policy.objects.select_related("user", "product", "vehicle")
            .prefetch_related(Prefetch("legacy_vehicle", queryset=PolicyVehicle.objects.all()))
            .order_by("-id")
        )

        qs = policy_scope_queryset(base_qs, self.request)

        include_deleted = (self.request.query_params.get("include_deleted") or "").lower() in (
            "1",
            "true",
            "yes",
        )
        deleted_only = (self.request.query_params.get("deleted_only") or "").lower() in (
            "1",
            "true",
            "yes",
        )

        if hasattr(Policy, "is_deleted"):
            if deleted_only:
                qs = qs.filter(is_deleted=True)
            elif not include_deleted:
                qs = qs.filter(is_deleted=False)

        return qs

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()

        # filtros admin: search por number o plate
        q = (request.query_params.get("search") or "").strip()
        if q:
            qs = qs.filter(
                Q(number__icontains=q)
                | Q(vehicle__license_plate__icontains=q)
                | Q(legacy_vehicle__plate__icontains=q)
            )

        only_unassigned = (request.query_params.get("only_unassigned") or "").lower() in (
            "1",
            "true",
            "yes",
        )
        if only_unassigned:
            qs = qs.filter(user__isnull=True)

        settings_obj = _get_settings_obj()

        page = self.paginate_queryset(qs)
        policies = list(page or qs)

        now = timezone.localdate()
        timeline_map = {}

        for policy in policies:
            period = _ensure_current_cycle(policy, now=now, allow_create=False)
            timeline_map[policy.id] = _policy_timeline(policy, settings_obj=settings_obj, period=period)

        serializer = PolicySerializer(
            policies,
            many=True,
            context={"timeline_map": timeline_map, "request": request},
        )

        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            self.perform_create(serializer)
        except IntegrityError as exc:
            detail = str(exc)
            if (
                "policies_policy.number" in detail
                or "UNIQUE constraint failed: policies_policy.number" in detail
            ):
                return Response(
                    {"number": ["Policy number already exists."]},
                    status=status.HTTP_409_CONFLICT,
                )
            raise
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    @action(detail=False, methods=["get"], url_path="my")
    def my(self, request):
        user = request.user
        settings_obj = _get_settings_obj()

        # Cliente: no mostrar eliminadas
        policies = list(self.get_queryset().filter(user=user, is_deleted=False))

        now = timezone.localdate()
        timeline_map = {}
        billing_status_map = {}
        for policy in policies:
            period = _ensure_current_cycle(policy, now=now, allow_create=True)
            timeline_map[policy.id] = _policy_timeline(policy, settings_obj=settings_obj, period=period)
            billing_status_map[policy.id] = getattr(period, "status", None) if period else None

        serializer = PolicyClientListSerializer(
            policies,
            many=True,
            context={"timeline_map": timeline_map, "request": request},
        )

        data = serializer.data
        for item in data:
            timeline = timeline_map.get(item["id"], {})
            cid = timeline.get("client_end_date")
            item["client_end_date"] = cid
            item["payment_start_date"] = timeline.get("payment_start_date")
            item["payment_end_date"] = timeline.get("payment_end_date")
            item["adjustment_from"] = timeline.get("adjustment_from")
            item["adjustment_to"] = timeline.get("adjustment_to")
            item["status"] = _client_status(
                item.get("status"),
                cid,
                timeline.get("real_end_date"),
                timeline.get("payment_end_date"),
                billing_status_map.get(item["id"]),
            )
        return Response(data)

    @action(detail=False, methods=["get"], url_path="my/dashboard")
    def my_dashboard(self, request):
        """
        GET /api/policies/my/dashboard/?policy_id=<id opcional>

        - policies: lista liviana para dropdown (NO crea BillingPeriod masivamente)
        - selected: detalle completo
        - billing_current: BillingPeriod vigente (si existe)
        - timeline: timeline de la seleccionada
        """
        user = request.user
        settings_obj = _get_settings_obj()

        qs = self.get_queryset().filter(user=user, is_deleted=False).order_by("-id")
        policies = list(qs)

        if not policies:
            return Response({"policies": [], "selected": None, "billing_current": None, "timeline": None})

        raw_policy_id = (request.query_params.get("policy_id") or "").strip()
        selected = None
        if raw_policy_id:
            selected = next((p for p in policies if str(p.id) == str(raw_policy_id)), None)
        if not selected:
            selected = policies[0]

        now = timezone.localdate()

        # Dropdown: sin side-effects masivos
        timeline_map_list = {}
        billing_status_map_list = {}
        for p in policies:
            period = _ensure_current_cycle(p, now=now, allow_create=False)
            timeline_map_list[p.id] = _policy_timeline(p, settings_obj=settings_obj, period=period)
            billing_status_map_list[p.id] = getattr(period, "status", None) if period else None

        list_ser = PolicyClientListSerializer(
            policies,
            many=True,
            context={"timeline_map": timeline_map_list, "request": request},
        )
        policies_data = list_ser.data

        for item in policies_data:
            tl = timeline_map_list.get(item["id"], {})
            cid = tl.get("client_end_date")
            item["client_end_date"] = cid
            item["payment_start_date"] = tl.get("payment_start_date")
            item["payment_end_date"] = tl.get("payment_end_date")
            item["adjustment_from"] = tl.get("adjustment_from")
            item["adjustment_to"] = tl.get("adjustment_to")
            item["status"] = _client_status(
                item.get("status"),
                cid,
                tl.get("real_end_date"),
                tl.get("payment_end_date"),
                billing_status_map_list.get(item["id"]),
            )

        # Seleccionada: detalle + billing_current (permitimos crear)
        selected_period = _ensure_current_cycle(selected, now=now, allow_create=True)
        selected_timeline = _policy_timeline(selected, settings_obj=settings_obj, period=selected_period)

        detail_ser = PolicyClientDetailSerializer(
            selected,
            context={"timeline_map": {selected.id: selected_timeline}, "request": request},
        )
        selected_data = detail_ser.data

        cid = selected_timeline.get("client_end_date")
        selected_data["client_end_date"] = cid
        selected_data["payment_start_date"] = selected_timeline.get("payment_start_date")
        selected_data["payment_end_date"] = selected_timeline.get("payment_end_date")
        selected_data["adjustment_from"] = selected_timeline.get("adjustment_from")
        selected_data["adjustment_to"] = selected_timeline.get("adjustment_to")
        selected_data["status"] = _client_status(
            selected_data.get("status"),
            cid,
            selected_timeline.get("real_end_date"),
            selected_timeline.get("payment_end_date"),
            getattr(selected_period, "status", None) if selected_period else None,
        )

        billing_current = BillingPeriodCurrentSerializer(selected_period).data if selected_period else None

        return Response(
            {
                "policies": policies_data,
                "selected": selected_data,
                "billing_current": billing_current,
                "timeline": selected_timeline,
            }
        )

    def retrieve(self, request, *args, **kwargs):
        obj = self.get_object()
        self.check_object_permissions(request, obj)

        if getattr(obj, "is_deleted", False) and not request.user.is_staff:
            return Response({"detail": "No encontrada."}, status=404)

        period = _ensure_current_cycle(obj, allow_create=True)
        settings_obj = _get_settings_obj()
        timeline = _policy_timeline(obj, settings_obj=settings_obj, period=period)

        serializer = PolicyClientDetailSerializer(
            obj, context={"timeline_map": {obj.id: timeline}, "request": request}
        )
        data = serializer.data

        cid = timeline.get("client_end_date")
        data["client_end_date"] = cid
        data["payment_start_date"] = timeline.get("payment_start_date")
        data["payment_end_date"] = timeline.get("payment_end_date")
        data["adjustment_from"] = timeline.get("adjustment_from")
        data["adjustment_to"] = timeline.get("adjustment_to")

        data["status"] = _client_status(
            data.get("status"),
            cid,
            timeline.get("real_end_date"),
            timeline.get("payment_end_date"),
            getattr(period, "status", None) if period else None,
        )
        return Response(data)

    @action(detail=True, methods=["post"], url_path="refresh")
    def refresh(self, request, pk=None):
        policy = self.get_object()
        self.check_object_permissions(request, policy)

        if getattr(policy, "is_deleted", False) and not request.user.is_staff:
            return Response({"detail": "No encontrada."}, status=404)

        policy.refresh_from_db()
        period = _ensure_current_cycle(policy, allow_create=True)

        settings_obj = _get_settings_obj()
        timeline = _policy_timeline(policy, settings_obj=settings_obj, period=period)

        serializer = PolicyClientDetailSerializer(
            policy, context={"timeline_map": {policy.id: timeline}, "request": request}
        )
        data = serializer.data

        cid = timeline.get("client_end_date")
        data["client_end_date"] = cid
        data["payment_start_date"] = timeline.get("payment_start_date")
        data["payment_end_date"] = timeline.get("payment_end_date")
        data["adjustment_from"] = timeline.get("adjustment_from")
        data["adjustment_to"] = timeline.get("adjustment_to")

        data["status"] = _client_status(
            data.get("status"),
            cid,
            timeline.get("real_end_date"),
            timeline.get("payment_end_date"),
            getattr(period, "status", None) if period else None,
        )
        return Response(data)

    @action(detail=True, methods=["get"], url_path="receipts")
    def receipts(self, request, pk=None):
        """
        GET /api/policies/<pk>/receipts/?page=1&page_size=10
        """
        policy = self.get_object()
        self.check_object_permissions(request, policy)

        # si está eliminada, solo admin
        if getattr(policy, "is_deleted", False) and not request.user.is_staff:
            return Response({"detail": "No encontrada."}, status=404)

        qs = Receipt.objects.filter(policy=policy).order_by("-date", "-id")

        if "page" not in request.query_params and "page_size" not in request.query_params:
            serializer = ReceiptSerializer(qs, many=True, context={"request": request})
            return Response(serializer.data)

        paginator = ReceiptsPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        serializer = ReceiptSerializer(page, many=True, context={"request": request})
        return paginator.get_paginated_response(serializer.data)

    @action(detail=False, methods=["post"], url_path="claim")
    def claim(self, request):
        number = (request.data.get("number") or request.data.get("code") or "").strip()
        if not number:
            return Response(
                {"detail": "Ingresá el número de póliza que te compartieron."},
                status=400,
            )
        lookup = number.upper()
        try:
            policy = (
                Policy.objects.select_related("vehicle", "product")
                .prefetch_related(Prefetch("legacy_vehicle", queryset=PolicyVehicle.objects.all()))
                .get(number__iexact=lookup, is_deleted=False)
            )
        except Policy.DoesNotExist:
            return Response(
                {"detail": "Póliza no encontrada. Verificá el número con tu asesor."},
                status=404,
            )

        _ensure_current_cycle(policy)

        if policy.user_id and policy.user_id != request.user.id:
            return Response(
                {"detail": "Esta póliza ya pertenece a otro usuario."},
                status=409,
            )

        holder_dni = (getattr(policy, "holder_dni", None) or "").strip()
        user_dni = str(getattr(request.user, "dni", "")).strip()
        if holder_dni and holder_dni != user_dni:
            return Response(
                {"detail": "El DNI no coincide con el titular de la póliza."},
                status=403,
            )

        product = policy.product
        vehicle = getattr(policy, "contract_vehicle", None)
        payload = {
            "id": policy.id,
            "number": policy.number,
            "product": {"id": product.id, "name": product.name} if product else None,
            "vehicle": PolicyVehicleSerializer(vehicle).data if vehicle else {},
            "status": policy.status,
            "status_readable": "Activa" if policy.status == "active" else policy.status,
            "plate": getattr(vehicle, "plate", None),
        }

        if policy.user_id == request.user.id:
            return Response({"message": "Esta póliza ya está asociada a tu cuenta.", "policy": payload})

        policy.user = request.user
        policy.save(update_fields=["user", "updated_at"])
        return Response({"message": "¡Póliza asociada!", "policy": payload})

    def get_throttles(self):
        if self.action == "claim":
            self.throttle_scope = "claim"
        elif hasattr(self, "throttle_scope"):
            delattr(self, "throttle_scope")
        return super().get_throttles()

    @action(detail=True, methods=["post"], url_path="regenerate-claim")
    def regenerate_claim(self, request, pk=None):
        policy = self.get_object()
        self.check_object_permissions(request, policy)
        if not request.user.is_staff:
            return Response({"detail": "Solo admins."}, status=403)
        policy.claim_code = _gen_claim_code()
        policy.save(update_fields=["claim_code", "updated_at"])
        return Response({"claim_code": policy.claim_code})

    def perform_create(self, serializer):
        serializer.save()

    def perform_update(self, serializer):
        settings_obj = AppSettings.get_solo()
        data = serializer.validated_data
        instance = serializer.instance

        premium_changed = "premium" in data
        prev_end = getattr(instance, "end_date", None)

        timeline = _policy_timeline(instance, settings_obj=settings_obj)
        adjustment_start = timeline.get("adjustment_from")
        adjustment_end = timeline.get("adjustment_to")
        in_adjustment_window = _date_in_window(adjustment_start, adjustment_end)

        should_override_dates = premium_changed and prev_end and in_adjustment_window
        new_start = None
        new_end = None

        if should_override_dates:
            term_months = int(getattr(settings_obj, "default_term_months", 0) or 0)
            if term_months <= 0:
                term_months = 3
            # En ajuste, la nueva vigencia arranca en el vencimiento anterior (no en "hoy")
            new_start = prev_end
            new_end = _add_months(prev_end, term_months)
            data["start_date"] = new_start
            data["end_date"] = new_end

        instance = serializer.save()

        if should_override_dates and new_start and new_end:
            instance.start_date = new_start
            instance.end_date = new_end
            instance.save(update_fields=["start_date", "end_date", "updated_at"])


class PolicyViewSet(PolicyBaseViewSet):
    def get_permissions(self):
        if self.action in ["my", "my_dashboard", "claim"]:
            return [permissions.IsAuthenticated()]
        if self.action in ["retrieve", "receipts", "refresh", "billing_current"]:
            return [permissions.IsAuthenticated(), IsOwnerOrAdmin()]
        if self.action in ["list", "create", "update", "partial_update", "destroy"]:
            return [permissions.IsAdminUser()]
        return [permissions.IsAdminUser()]

    @action(
        detail=True,
        methods=["get"],
        url_path="billing/current",
        permission_classes=[permissions.IsAuthenticated, IsOwnerOrAdmin],
    )
    def billing_current(self, request, pk=None):
        policy = self.get_object()
        self.check_object_permissions(request, policy)

        if getattr(policy, "is_deleted", False) and not request.user.is_staff:
            return Response({"detail": "No encontrada."}, status=404)

        period = ensure_current_billing_period(policy)
        if period:
            mark_overdue_and_suspend_if_needed(policy, period, now=timezone.localdate())
        if not period:
            return Response({"detail": "No hay periodo vigente."}, status=404)
        return Response(BillingPeriodCurrentSerializer(period).data)


class AdminPolicyViewSet(AuditModelViewSetMixin, PolicyBaseViewSet):
    permission_classes = [IsAdminUser]

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return AdminPolicyCreateSerializer
        return PolicySerializer

    def get_queryset(self):
        base_qs = (
            Policy.objects.select_related("user", "product", "vehicle")
            .prefetch_related(Prefetch("legacy_vehicle", queryset=PolicyVehicle.objects.all()))
            .order_by("-id")
        )
        return policy_scope_queryset(base_qs, self.request)

    def _with_adjustment_ordering_and_filter(self, qs):
        settings_obj = _get_settings_obj()
        try:
            window_days = int(getattr(settings_obj, "policy_adjustment_window_days", 0) or 0)
        except Exception:
            window_days = 0

        in_adj = (self.request.query_params.get("in_adjustment") or "").lower() in ("1", "true", "yes")

        if window_days <= 0:
            if in_adj:
                return qs.none()
            return qs

        today = timezone.localdate()
        lower = today + timedelta(days=1)
        upper = today + timedelta(days=window_days)

        if in_adj:
            qs = qs.filter(end_date__isnull=False, end_date__gte=lower, end_date__lte=upper)

        qs = qs.annotate(
            in_adjustment=Case(
                When(end_date__isnull=False, end_date__gte=lower, end_date__lte=upper, then=Value(1)),
                default=Value(0),
                output_field=IntegerField(),
            )
        ).order_by("-in_adjustment", "-id")

        return qs

    def _is_period_unpaid(self, period: BillingPeriod | None) -> bool:
        if not period:
            return True
        try:
            return period.status != BillingPeriod.Status.PAID
        except Exception:
            v = getattr(period, "status", None)
            return str(v).upper() != "PAID"

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        if hasattr(Policy, "is_deleted"):
            qs = qs.filter(is_deleted=False)

        q = (request.query_params.get("search") or "").strip()
        if q:
            qs = qs.filter(
                Q(number__icontains=q)
                | Q(vehicle__license_plate__icontains=q)
                | Q(legacy_vehicle__plate__icontains=q)
            )

        only_unassigned = (request.query_params.get("only_unassigned") or "").lower() in (
            "1",
            "true",
            "yes",
        )
        if only_unassigned:
            qs = qs.filter(user__isnull=True)

        status_filter = (request.query_params.get("status") or "").strip()
        if status_filter:
            qs = qs.filter(status=status_filter)

        qs = self._with_adjustment_ordering_and_filter(qs)

        settings_obj = _get_settings_obj()
        page = self.paginate_queryset(qs)
        policies = list(page or qs)

        now = timezone.localdate()
        timeline_map = {}
        for policy in policies:
            period = _ensure_current_cycle(policy, now=now, allow_create=False)
            timeline_map[policy.id] = _policy_timeline(policy, settings_obj=settings_obj, period=period)

        serializer = PolicySerializer(
            policies,
            many=True,
            context={"timeline_map": timeline_map, "request": request},
        )
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request):
        now = timezone.localdate()
        settings_obj = _get_settings_obj()

        qs = self.get_queryset()
        if hasattr(Policy, "is_deleted"):
            qs = qs.filter(is_deleted=False)

        try:
            window_days = int(getattr(settings_obj, "policy_adjustment_window_days", 0) or 0)
        except Exception:
            window_days = 0

        adjustment_items = []
        if window_days > 0:
            lower = now + timedelta(days=1)
            upper = now + timedelta(days=window_days)
            adj_qs = qs.filter(end_date__isnull=False, end_date__gte=lower, end_date__lte=upper).order_by("-id")
            adjustment_items = list(adj_qs.values("id", "number")[:500])

        adjustment_count = len(adjustment_items)

        soft_items = []
        candidates = qs.exclude(end_date__isnull=True).filter(end_date__gte=now).order_by("-id")[:3000]

        for p in candidates:
            period = _ensure_current_cycle(p, now=now, allow_create=False)
            tl = _policy_timeline(p, settings_obj=settings_obj, period=period)

            client_end = tl.get("client_end_date")
            real_end = tl.get("real_end_date") or tl.get("payment_end_date")

            def _to_date(v):
                if v is None:
                    return None
                if isinstance(v, date):
                    return v
                if isinstance(v, str):
                    try:
                        return date.fromisoformat(v)
                    except ValueError:
                        return None
                return None

            client_end = _to_date(client_end)
            real_end = _to_date(real_end)

            if not client_end or not real_end:
                continue

            if now > client_end and now <= real_end and self._is_period_unpaid(period):
                soft_items.append({"id": p.id, "number": p.number})

        soft_count = len(soft_items)

        by_status = list(qs.values("status").annotate(count=Count("id")).order_by("status"))

        return Response(
            {
                "adjustment": {"count": adjustment_count, "items": adjustment_items},
                "soft_overdue_unpaid": {"count": soft_count, "items": soft_items[:500]},
                "by_status": by_status,
            }
        )

    @action(detail=False, methods=["get"], url_path="deleted")
    def deleted(self, request):
        qs = self.get_queryset()
        if not hasattr(Policy, "is_deleted"):
            return Response(
                {"detail": "Soft delete no está habilitado en Policy (falta is_deleted/soft_delete)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = qs.filter(is_deleted=True).order_by("-id")

        settings_obj = _get_settings_obj()
        page = self.paginate_queryset(qs)
        policies = list(page or qs)

        now = timezone.localdate()
        timeline_map = {}
        for policy in policies:
            period = _ensure_current_cycle(policy, now=now, allow_create=False)
            timeline_map[policy.id] = _policy_timeline(policy, settings_obj=settings_obj, period=period)

        serializer = PolicySerializer(
            policies,
            many=True,
            context={"timeline_map": timeline_map, "request": request},
        )
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="restore")
    def restore(self, request, pk=None):
        policy = self.get_object()
        try:
            _restore_policy(policy)
        except AttributeError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        settings_obj = _get_settings_obj()
        period = _ensure_current_cycle(policy, allow_create=False)
        timeline = _policy_timeline(policy, settings_obj=settings_obj, period=period)
        serializer = PolicySerializer(
            policy, context={"timeline_map": {policy.id: timeline}, "request": request}
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="mark-paid")
    def mark_paid(self, request, pk=None):
        policy = self.get_object()
        today = timezone.localdate()

        period = ensure_current_billing_period(policy, now=today)
        if not period:
            return Response({"detail": "No hay periodo vigente para cobrar."}, status=400)

        force = bool(request.data.get("force")) if hasattr(request, "data") else False
        if not force and getattr(period, "due_date_hard", None) and today > period.due_date_hard:
            return Response(
                {
                    "detail": "Fuera de la ventana de pago. No se puede marcar como abonada.",
                    "due_date_hard": period.due_date_hard,
                },
                status=400,
            )

        try:
            already_paid = period.status == BillingPeriod.Status.PAID
        except Exception:
            already_paid = str(getattr(period, "status", "")).upper() == "PAID"

        if already_paid:
            settings_obj = _get_settings_obj()
            timeline = _policy_timeline(policy, settings_obj=settings_obj, period=period)
            return Response(
                {
                    "detail": "El periodo ya fue pagado.",
                    "policy": PolicySerializer(
                        policy,
                        context={"timeline_map": {policy.id: timeline}, "request": request},
                    ).data,
                },
                status=200,
            )

        existing_payment = Payment.objects.filter(billing_period=period, state="APR").order_by("-id").first()

        if not existing_payment:
            try:
                existing_payment = Payment.objects.create(
                    policy=policy,
                    billing_period=period,
                    state="APR",
                    mp_payment_id="manual",
                    mp_preference_id="manual",
                )
            except Exception:
                existing_payment = (
                    Payment.objects.filter(billing_period=period, state="APR").order_by("-id").first()
                )

        period.mark_paid()
        reactivate_policy_if_applicable(policy)

        admin_user_id = getattr(request.user, "id", None)
        receipt = Receipt.objects.create(
            policy=policy,
            amount=getattr(period, "amount", None),
            concept=f"Pago manual {getattr(period, 'period_code', '')}".strip(),
            method="manual",
            auth_code=f"admin:{admin_user_id or 'unknown'}",
            next_due=None,
        )

        rel_path = ""
        try:
            rel_path = generate_receipt_pdf(existing_payment)
        except Exception:
            rel_path = ""

        if rel_path:
            try:
                existing_payment.receipt_pdf.name = rel_path
                existing_payment.save(update_fields=["receipt_pdf"])
            except Exception:
                pass
            try:
                receipt.file.name = rel_path
                receipt.save(update_fields=["file"])
            except Exception:
                pass

        settings_obj = _get_settings_obj()
        timeline = _policy_timeline(policy, settings_obj=settings_obj, period=period)
        return Response(
            {
                "detail": "Póliza marcada como abonada.",
                "payment_id": getattr(existing_payment, "id", None),
                "receipt_id": getattr(receipt, "id", None),
                "policy": PolicySerializer(
                    policy,
                    context={"timeline_map": {policy.id: timeline}, "request": request},
                ).data,
            },
            status=200,
        )

    def perform_destroy(self, instance):
        if instance.user_id:
            instance.user = None
            instance.save(update_fields=["user", "updated_at"])
        _soft_delete_policy(instance)

    @action(detail=False, methods=["get"], url_path="adjustment-count")
    def adjustment_count(self, request):
        settings_obj = _get_settings_obj()
        try:
            days = int(getattr(settings_obj, "policy_adjustment_window_days", 0) or 0)
        except Exception:
            days = 0

        if days <= 0:
            return Response({"count": 0})

        today = timezone.localdate()
        lower = today + timedelta(days=1)
        upper = today + timedelta(days=days)

        qs = self.get_queryset()
        if hasattr(Policy, "is_deleted"):
            qs = qs.filter(is_deleted=False)

        qs = qs.exclude(end_date__isnull=True).filter(end_date__gte=lower, end_date__lte=upper)
        return Response({"count": qs.count()})
