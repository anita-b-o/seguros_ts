import logging
import time
from datetime import timedelta

from django.utils import timezone
from rest_framework import permissions, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from common.authentication import OptionalAuthenticationMixin, SoftJWTAuthentication
from payments.billing import ensure_current_billing_period
from policies.billing import ADMIN_MANAGED_STATUSES, _add_months, regenerate_installments
from policies.models import Policy
from .models import ContactInfo, AppSettings, Announcement
from .serializers import ContactInfoSerializer, AppSettingsSerializer, AnnouncementSerializer


class ContactInfoView(OptionalAuthenticationMixin, APIView):
    """PUBLIC ENDPOINT: acepta SoftJWT opcional y no depende de request.user."""

    permission_classes = [permissions.AllowAny]
    optional_soft_purpose = SoftJWTAuthentication.PURPOSE_PUBLIC

    def get(self, request):
        obj = ContactInfo.get_solo()
        data = ContactInfoSerializer(obj).data
        return Response(data)

    def patch(self, request):
        obj = ContactInfo.get_solo()
        serializer = ContactInfoSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    put = patch


class AppSettingsView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        obj = AppSettings.get_solo()
        return Response(AppSettingsSerializer(obj).data)

    def patch(self, request):
        obj = AppSettings.get_solo()
        serializer = AppSettingsSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        old_term = getattr(obj, "default_term_months", 0) or 0
        old_window = getattr(obj, "payment_window_days", 0) or 0
        old_early = getattr(obj, "client_expiration_offset_days", 0) or 0
        old_adj = getattr(obj, "policy_adjustment_window_days", 0) or 0

        serializer.save()

        new_term = getattr(serializer.instance, "default_term_months", 0) or 0
        new_window = getattr(serializer.instance, "payment_window_days", 0) or 0
        new_early = getattr(serializer.instance, "client_expiration_offset_days", 0) or 0
        new_adj = getattr(serializer.instance, "policy_adjustment_window_days", 0) or 0

        # Si cambia la vigencia por defecto, recalculamos end_date (y cuotas si aplica)
        if new_term and new_term != old_term:
            self._apply_default_term(new_term)

        # Si cambia ventana de pago o vencimiento visible, refrescamos ciclos/billing
        if new_window != old_window or new_early != old_early:
            self._apply_payment_window_settings()

        # Si cambia el periodo de ajuste, no necesitamos regenerar nada persistente:
        # afecta sólo la lógica de “en ajuste” (cálculo por fechas y settings).
        # Lo dejamos acá por claridad y futuras extensiones.
        # if new_adj != old_adj:
        #     pass

        return Response(serializer.data)

    put = patch

    def _apply_default_term(self, months: int) -> None:
        now = timezone.now()
        queryset = Policy.objects.filter(start_date__isnull=False).exclude(
            status__in=ADMIN_MANAGED_STATUSES
        )
        start = time.monotonic()
        affected = 0
        logger = logging.getLogger(__name__)

        for policy in queryset.iterator():
            new_end = _add_months(policy.start_date, months)
            if not new_end:
                continue
            if policy.end_date == new_end:
                continue
            policy.end_date = new_end
            policy.updated_at = now
            policy.save(update_fields=["end_date", "updated_at"])
            regenerate_installments(policy, months_duration=months)
            affected += 1

        duration = time.monotonic() - start
        logger.info(
            "Regenerated %d policies for new default_term (%d months) in %.3fs",
            affected,
            months,
            duration,
        )

    def _apply_payment_window_settings(self) -> None:
        now = timezone.now()
        today = timezone.localdate()
        queryset = Policy.objects.filter(start_date__isnull=False).exclude(
            status__in=ADMIN_MANAGED_STATUSES
        )
        start = time.monotonic()
        affected = 0
        logger = logging.getLogger(__name__)

        for policy in queryset.iterator():
            regenerate_installments(policy)
            ensure_current_billing_period(policy, now=today)
            policy.updated_at = now
            policy.save(update_fields=["updated_at"])
            affected += 1

        duration = time.monotonic() - start
        logger.info(
            "Updated %d policies for new payment window settings in %.3fs",
            affected,
            duration,
        )


class AnnouncementViewSet(OptionalAuthenticationMixin, viewsets.ModelViewSet):
    """
    CRUD admin + listado público de anuncios.
    """
    queryset = Announcement.objects.all().order_by("order", "-created_at")
    serializer_class = AnnouncementSerializer
    PUBLIC_ACTIONS = {"list", "retrieve"}

    def _resolve_action(self):
        action = getattr(self, "action", None)
        if action:
            return action

        req = getattr(self, "request", None)
        if req is None:
            return None

        method = req.method.lower()
        action_map = getattr(self, "action_map", None)
        if action_map:
            mapped = action_map.get(method)
            if mapped:
                return mapped

        if method == "get":
            kwargs = getattr(self, "kwargs", None) or {}
            lookup_field = getattr(self, "lookup_field", "pk")
            if kwargs.get(lookup_field) is not None or kwargs.get("pk") is not None:
                return "retrieve"
            return "list"

        return None

    def get_permissions(self):
        action = self._resolve_action()
        if action in self.PUBLIC_ACTIONS:
            return [permissions.AllowAny()]
        return super().get_permissions()

    def should_use_optional_authentication(self):
        return self._resolve_action() in self.PUBLIC_ACTIONS

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            return qs.filter(is_active=True)
        if self.action == "retrieve":
            user = getattr(self.request, "user", None)
            if user and user.is_authenticated and user.is_staff:
                return qs
            return qs.filter(is_active=True)
        return qs
