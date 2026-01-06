# backend/policies/views.py
from django.db.models import Prefetch, Q
from audit.helpers import AuditModelViewSetMixin
from rest_framework import viewsets, permissions
from rest_framework.permissions import IsAdminUser
from rest_framework.decorators import action
from rest_framework.response import Response
from .access import policy_scope_queryset
from .models import Policy, PolicyVehicle
from .serializers import (
    PolicySerializer,
    PolicyClientListSerializer,
    PolicyClientDetailSerializer,
    PolicyVehicleSerializer,
)
from common.models import AppSettings
from payments.serializers import ReceiptSerializer
from payments.models import Receipt
from .billing import (
    current_payment_cycle,
    next_price_update_window,
    regenerate_installments,
    refresh_installment_statuses,
    update_policy_status_from_installments,
)
import os
import secrets
import string
from datetime import date
from calendar import monthrange


def _gen_claim_code(length=8):
    alphabet = string.ascii_uppercase + string.digits
    return "SC-" + "".join(secrets.choice(alphabet) for _ in range(length))


def _env_bool(val):
    return str(val).strip().lower() in ("1", "true", "t", "yes", "y", "on") if val is not None else False


def _policy_timeline(policy, settings_obj):
    today = date.today()
    cycle = current_payment_cycle(policy, settings_obj, today=today) or {}

    client_due = cycle.get("due_display") or getattr(policy, "end_date", None)
    real_due = cycle.get("due_real") or getattr(policy, "end_date", None)
    payment_start = cycle.get("payment_window_start") or getattr(policy, "start_date", None)
    payment_end = cycle.get("payment_window_end") or real_due or getattr(policy, "end_date", None)

    adjustment_from, adjustment_to = next_price_update_window(policy, settings_obj, today=today)

    return {
        "real_end_date": real_due,
        "client_end_date": client_due,
        "payment_start_date": payment_start,
        "payment_end_date": payment_end,
        "adjustment_from": adjustment_from,
        "adjustment_to": adjustment_to,
    }


def _client_status(status, client_end, real_end, payment_end=None):
    if status in ["cancelled", "inactive", "suspended"]:
        return status
    today = date.today()
    # normalizamos fechas
    if isinstance(real_end, str):
        try:
            real_end = date.fromisoformat(real_end)
        except ValueError:
            real_end = None
    if isinstance(payment_end, str):
        try:
            payment_end = date.fromisoformat(payment_end)
        except ValueError:
            payment_end = None
    if real_end and real_end < today:
        return "expired"
    if client_end and client_end < today:
        return "no_coverage"
    return status or "active"


def _add_months(start_date, months):
    """
    Suma meses conservando el día cuando es posible; si el mes de destino
    no tiene ese día (p. ej., 31 a febrero), se usa el último día del mes.
    """
    if not start_date or not months:
        return None
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


class IsOwnerOrAdmin(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return bool(user.is_staff or obj.user_id == user.id)


class PolicyBaseViewSet(viewsets.ModelViewSet):
    serializer_class = PolicySerializer
    refresh_on_read_default = _env_bool(os.getenv("POLICY_REFRESH_ON_READ"))

    def get_queryset(self):
        base_qs = (
            Policy.objects.select_related("user", "product", "vehicle")
            .prefetch_related(
                Prefetch("legacy_vehicle", queryset=PolicyVehicle.objects.all()),
                "installments",
            )
            .order_by("-id")
        )
        return policy_scope_queryset(base_qs, self.request)

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        # filtros admin: search por number o plate, solo sin usuario
        q = (request.query_params.get("search") or "").strip()
        if q:
            qs = qs.filter(
                Q(number__icontains=q)
                | Q(vehicle__license_plate__icontains=q)
                | Q(legacy_vehicle__plate__icontains=q)
            )
        only_unassigned = (request.query_params.get("only_unassigned") or "").lower() in ("1", "true", "yes")
        if only_unassigned:
            qs = qs.filter(user__isnull=True)
        refresh_flag = (request.query_params.get("refresh") or "").lower() in ("1", "true", "yes")
        allow_refresh = refresh_flag or self.refresh_on_read_default
        settings_obj = AppSettings.get_solo()
        page = self.paginate_queryset(qs)
        policies = list(page or qs)
        if allow_refresh:
            for policy in policies:
                self._touch_installments(policy, persist=False)
        timeline_map = {p.id: _policy_timeline(p, settings_obj) for p in policies}
        serializer = PolicySerializer(policies, many=True, context={"timeline_map": timeline_map})

        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    def _touch_installments(self, policy, *, persist=False):
        refresh_installment_statuses(policy.installments.all(), persist=persist)
        update_policy_status_from_installments(policy, policy.installments.all(), persist=persist)

    @action(detail=False, methods=["get"], url_path="my")
    def my(self, request):
        user = request.user
        settings_obj = AppSettings.get_solo()
        policies = list(self.get_queryset().filter(user=user))
        refresh_flag = (request.query_params.get("refresh") or "").lower() in ("1", "true", "yes")
        allow_refresh = refresh_flag or self.refresh_on_read_default
        if allow_refresh:
            for policy in policies:
                self._touch_installments(policy, persist=False)
        timeline_map = {p.id: _policy_timeline(p, settings_obj) for p in policies}
        serializer = PolicyClientListSerializer(
            policies,
            many=True,
            context={"timeline_map": timeline_map},
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
                item["status"],
                cid,
                timeline.get("real_end_date"),
                timeline.get("payment_end_date"),
            )
        return Response(data)

    def retrieve(self, request, *args, **kwargs):
        obj = self.get_object()
        self.check_object_permissions(request, obj)
        settings_obj = AppSettings.get_solo()
        refresh_flag = (request.query_params.get("refresh") or "").lower() in ("1", "true", "yes")
        allow_refresh = refresh_flag or self.refresh_on_read_default
        if allow_refresh:
            self._touch_installments(obj, persist=False)
        timeline = _policy_timeline(obj, settings_obj)
        serializer = PolicyClientDetailSerializer(
            obj, context={"timeline_map": {obj.id: timeline}}
        )
        data = serializer.data
        cid = timeline.get("client_end_date")
        data["client_end_date"] = cid
        data["status"] = _client_status(
            data.get("status"),
            cid,
            timeline.get("real_end_date"),
            timeline.get("payment_end_date"),
        )
        return Response(data)

    @action(detail=True, methods=["post"], url_path="refresh")
    def refresh(self, request, pk=None):
        policy = self.get_object()
        self.check_object_permissions(request, policy)
        settings_obj = AppSettings.get_solo()
        if policy.start_date and not policy.installments.exists():
            regenerate_installments(policy)
        policy.refresh_from_db()
        self._touch_installments(policy, persist=True)
        timeline = _policy_timeline(policy, settings_obj)
        serializer = PolicyClientDetailSerializer(
            policy, context={"timeline_map": {policy.id: timeline}}
        )
        data = serializer.data
        cid = timeline.get("client_end_date")
        data["client_end_date"] = cid
        data["status"] = _client_status(
            data.get("status"),
            cid,
            timeline.get("real_end_date"),
            timeline.get("payment_end_date"),
        )
        return Response(data)

    @action(detail=True, methods=["get"], url_path="receipts")
    def receipts(self, request, pk=None):
        policy = self.get_object()
        qs = Receipt.objects.filter(policy=policy).order_by("-date", "-id")
        return Response(ReceiptSerializer(qs, many=True, context={"request": request}).data)

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
            policy = Policy.objects.select_related("vehicle", "product").get(
                number__iexact=lookup
            )
        except Policy.DoesNotExist:
            return Response(
                {"detail": "Póliza no encontrada. Verificá el número con tu asesor."},
                status=404,
            )

        if policy.user_id and policy.user_id != request.user.id:
            return Response(
                {"detail": "Esta póliza ya pertenece a otro usuario."},
                status=400,
            )

        product = policy.product
        vehicle = getattr(policy, "vehicle", None)
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
            return Response(
                {
                    "message": "Esta póliza ya está asociada a tu cuenta.",
                    "policy": payload,
                }
            )

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
        """
        Admin: genera un nuevo claim_code para la póliza y lo devuelve.
        """
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

        # Si se actualiza el monto dentro del periodo de ajuste reportado, se arranca un nuevo período:
        premium_changed = "premium" in data
        prev_end = getattr(instance, "end_date", None)
        timeline = _policy_timeline(instance, settings_obj)
        adjustment_start = timeline.get("adjustment_from")
        adjustment_end = timeline.get("adjustment_to")
        in_adjustment_window = _date_in_window(adjustment_start, adjustment_end)
        if premium_changed and prev_end and in_adjustment_window:
            term_months = getattr(settings_obj, "default_term_months", 0) or 0
            if term_months <= 0:
                term_months = 3
            new_start = prev_end
            new_end = _add_months(prev_end, term_months)
            data["start_date"] = new_start
            data["end_date"] = new_end

        serializer.save()


class PolicyViewSet(PolicyBaseViewSet):
    def get_permissions(self):
        if self.action in ["my", "claim"]:
            return [permissions.IsAuthenticated()]
        if self.action in ["retrieve", "receipts", "refresh"]:
            return [permissions.IsAuthenticated(), IsOwnerOrAdmin()]
        if self.action in ["list", "create", "update", "partial_update", "destroy"]:
            return [permissions.IsAdminUser()]
        return [permissions.IsAdminUser()]


class AdminPolicyViewSet(AuditModelViewSetMixin, PolicyBaseViewSet):
    permission_classes = [IsAdminUser]
