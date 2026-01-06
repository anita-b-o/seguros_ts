import hashlib
import json
import logging
import os
import uuid
from decimal import Decimal

try:
    import requests
except ImportError:
    requests = None
from django.db import IntegrityError, transaction
from rest_framework import permissions, viewsets
from rest_framework.decorators import action, api_view, permission_classes, authentication_classes
from rest_framework.response import Response

from common.models import AppSettings
from policies.billing import (
    ADMIN_MANAGED_STATUSES,
    current_payment_cycle,
    mark_cycle_installment_paid,
    refresh_installment_statuses,
    update_policy_status_from_installments,
)
from policies.models import Policy, PolicyInstallment

from .models import Payment, Receipt, PaymentWebhookEvent
from audit.helpers import audit_log, snapshot_entity
from common import metrics
from .serializers import PaymentSerializer
from .utils import generate_receipt_pdf

from datetime import date
from django.conf import settings
from django.urls import reverse
from django.utils.crypto import get_random_string, constant_time_compare
from policies.access import get_scoped_policy_or_404

def _env_bool(val):
    return str(val).strip().lower() in ("1", "true", "t", "yes", "y", "on") if val is not None else False


logger = logging.getLogger(__name__)


def _authorize_mp_webhook(request):
    """
    Valida la firma del webhook usando un secreto compartido.
    Acepta:
      - Header `X-Mp-Signature: <token>`
      - Authorization: Bearer <token>
    """
    secret = (getattr(settings, "MP_WEBHOOK_SECRET", "") or "").strip()
    allow_no_secret = (
        settings.DEBUG and getattr(settings, "MP_ALLOW_WEBHOOK_NO_SECRET", False)
    )

    def allow(detail=None):
        return True, detail, 200

    def reject(detail, status):
        return False, detail, status

    if not secret:
        if allow_no_secret:
            logger.warning(
                "mp_webhook_no_secret_debug",
                extra={"detail": "MP_WEBHOOK_SECRET ausente; se aceptó en modo debug."},
            )
            return allow("MP_WEBHOOK_SECRET ausente; se aceptó sin validar firma.")
        detail = "MP_WEBHOOK_SECRET is required when DEBUG=False"
        logger.critical(
            "mp_webhook_misconfigured",
            extra={"detail": detail},
        )
        return reject(detail, 500)

    signature = (request.headers.get("X-Mp-Signature") or "").strip()
    authorization = (request.headers.get("Authorization") or "").strip()
    bearer = ""
    if authorization.lower().startswith("bearer"):
        bearer = authorization[6:].strip()

    incoming_tokens = [token for token in (signature, bearer) if token]
    if not incoming_tokens:
        return reject("Se requiere Authorization Bearer o X-Mp-Signature.", 403)

    if any(constant_time_compare(token, secret) for token in incoming_tokens):
        return allow()

    return reject("Firma inválida", 403)



def _current_payment_window(policy, settings_obj):
    """
    Devuelve (inicio, fin) de la ventana de pago vigente o próxima,
    siguiendo la misma lógica que policies/_policy_timeline.
    """
    cycle = current_payment_cycle(policy, settings_obj)
    if not cycle:
        return None, None
    return cycle.get("payment_window_start"), cycle.get("due_real")


def _mp_headers():
    token = os.getenv("MP_ACCESS_TOKEN") or os.getenv("MERCADOPAGO_ACCESS_TOKEN")
    if not token:
        return None
    return {"Authorization": f"Bearer {token}"}


def _mp_fake_payments_allowed():
    """
    Permite simular pagos cuando no hay token de MP.
    Útil en desarrollo o entornos sin MP configurado.
    """
    if not settings.DEBUG:
        return False
    return getattr(settings, "MP_ALLOW_FAKE_PREFERENCES", True)


def _mp_notification_url(request):
    override = os.getenv("MP_NOTIFICATION_URL")
    if override:
        return override
    try:
        return request.build_absolute_uri(reverse("mp_webhook"))
    except Exception:
        return None


def _normalize_payload(payload):
    if hasattr(payload, "dict"):
        return payload.dict()
    try:
        return dict(payload)
    except Exception:
        return {}


def _webhook_request_context(request):
    return {
        "remote_addr": request.META.get("REMOTE_ADDR"),
        "user_agent": request.headers.get("User-Agent"),
    }


def _map_status_to_state(status_norm):
    if status_norm == "approved":
        return "APR"
    if status_norm == "rejected":
        return "REJ"
    return "PEN"


def _is_state_transition_allowed(current, desired):
    if current == "APR":
        return desired == "APR"
    if current == "REJ":
        return desired == "REJ"
    return True


def _get_mp_webhook_event_id(payload_dict):
    event_id = payload_dict.get("id") or payload_dict.get("event_id")
    if event_id:
        return event_id

    mp_payment_id = payload_dict.get("mp_payment_id") or payload_dict.get("payment_id") or payload_dict.get("external_reference")
    status = (payload_dict.get("status") or "").strip().lower()
    preference = payload_dict.get("mp_preference_id") or payload_dict.get("preference_id")

    if mp_payment_id and status:
        return f"{mp_payment_id}:{status}"

    if mp_payment_id:
        return f"{mp_payment_id}:{preference or 'nopref'}"

    serialized = json.dumps(payload_dict or {}, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _try_create_mp_webhook_event(payment, event_id, payload_dict):
    try:
        PaymentWebhookEvent.objects.create(
            provider=PaymentWebhookEvent.PROVIDER_MERCADO_PAGO,
            external_event_id=event_id,
            payment=payment,
            raw_payload=payload_dict or None,
        )
        return True
    except IntegrityError:
        return False


def _process_mp_webhook_for_payment(
    payment,
    payload_dict,
    mp_payment_id,
    status_str,
    preference_id,
    amount_raw,
):
    event_id = _get_mp_webhook_event_id(payload_dict)
    receipt = None
    metrics.webhooks_processed_total.inc()
    before_snapshot = snapshot_entity(payment)

    with transaction.atomic():
        if not _try_create_mp_webhook_event(payment, event_id, payload_dict):
            metrics.webhooks_duplicate_total.inc()
            audit_log(
                action="webhook_duplicate",
                entity_type="Payment",
                entity_id=str(payment.pk),
                before=before_snapshot,
                extra={"event_id": event_id},
                request=None,
            )
            return Response({"detail": "ok"})

        locked_payment = (
            Payment.objects.select_related("policy", "installment")
            .select_for_update()
            .get(pk=payment.pk)
        )
        policy = None
        if locked_payment.policy_id:
            try:
                policy = Policy.objects.select_for_update().get(pk=locked_payment.policy_id)
            except Policy.DoesNotExist:
                logger.warning(
                    "mp_webhook_policy_missing",
                    extra={
                        "payment_id": locked_payment.id,
                        "payment_policy_id": locked_payment.policy_id,
                        "event_id": event_id,
                        "mp_payment_id": mp_payment_id,
                    },
                )
                policy = None

        policy_status = policy.status if policy else None
        if policy_status in ADMIN_MANAGED_STATUSES:
            logger.warning(
                "mp_webhook_admin_managed_policy",
                extra={
                    "payment_id": locked_payment.id,
                    "policy_id": locked_payment.policy_id,
                    "policy_status": policy_status,
                    "event_id": event_id,
                    "mp_payment_id": mp_payment_id,
                },
            )
            return Response({"detail": "ok"})

        status_norm = (status_str or "").lower()
        desired_state = _map_status_to_state(status_norm)
        if not _is_state_transition_allowed(locked_payment.state, desired_state):
            logger.warning(
                "mp_webhook_state_transition_blocked",
                extra={
                    "payment_id": locked_payment.id,
                    "current_state": locked_payment.state,
                    "desired_state": desired_state,
                    "event_id": event_id,
                },
            )
            return Response({"detail": "ok"})

        if preference_id and locked_payment.mp_preference_id and preference_id != locked_payment.mp_preference_id:
            return Response({"detail": "mp_preference_id no coincide"}, status=400)

        if amount_raw is not None:
            try:
                incoming_amount = Decimal(str(amount_raw))
                if locked_payment.amount and incoming_amount != Decimal(str(locked_payment.amount)):
                    return Response(
                        {"detail": "El monto informado no coincide con el pago registrado."},
                        status=400,
                    )
            except Exception:
                return Response({"detail": "Monto inválido en webhook."}, status=400)

        if locked_payment.state == "APR":
            if mp_payment_id and locked_payment.mp_payment_id != mp_payment_id:
                locked_payment.mp_payment_id = mp_payment_id
                locked_payment.save(update_fields=["mp_payment_id"])
            return Response({"detail": "ok"})

        locked_payment.mp_payment_id = mp_payment_id or locked_payment.mp_payment_id

        if status_norm == "approved" and not locked_payment.installment_id:
            logger.warning(
                "mp_webhook_approved_without_installment",
                extra={
                    "payment_id": locked_payment.id,
                    "policy_id": locked_payment.policy_id,
                    "mp_payment_id": mp_payment_id,
                },
            )
            return Response(
                {
                    "detail": "Webhook aprobado ignorado: el pago no está vinculado a ninguna cuota."
                },
                status=409,
            )

        if status_norm == "approved":
            metrics.payments_confirmed_total.inc()
            if policy is None:
                logger.warning(
                    "mp_webhook_approved_without_policy",
                    extra={
                        "payment_id": locked_payment.id,
                        "policy_id": locked_payment.policy_id,
                        "event_id": event_id,
                        "mp_payment_id": mp_payment_id,
                    },
                )
                return Response(
                    {"detail": "Webhook aprobado ignorado: el pago no tiene póliza válida."},
                    status=409,
                )

            locked_payment.state = "APR"
            locked_payment.save(update_fields=["state", "mp_payment_id"])
            after_snapshot = snapshot_entity(locked_payment)

            installment = locked_payment.installment
            locked_installment = None
            if installment:
                locked_installment = PolicyInstallment.objects.select_for_update().get(pk=installment.pk)
                already_paid = locked_installment.status == PolicyInstallment.Status.PAID
                if not already_paid:
                    locked_installment.mark_paid(payment=locked_payment)

            installments_qs = policy.installments.select_for_update() if policy else PolicyInstallment.objects.none()
            refresh_installment_statuses(installments_qs, persist=True)
            update_policy_status_from_installments(policy, installments_qs, persist=True)

            mp_auth_code = str(mp_payment_id or "")
            receipt_exists = Receipt.objects.filter(
                policy=policy,
                method="mercadopago",
                auth_code=mp_auth_code,
            ).exists()
            if receipt_exists:
                logger.info(
                    "mp_webhook_receipt_already_exists",
                    extra={
                        "payment_id": locked_payment.id,
                        "policy_id": policy.id,
                        "mp_payment_id": mp_payment_id,
                        "event_id": event_id,
                    },
                )
            else:
                receipt = Receipt.objects.create(
                    policy=policy,
                    amount=locked_payment.amount,
                    concept="Pago con Mercado Pago",
                    method="mercadopago",
                    auth_code=mp_auth_code,
                    next_due=None,
                )
            logger.info(
                "mp_webhook_payment_approved",
                extra={
                    "payment_id": locked_payment.id,
                    "policy_id": policy.id if policy else None,
                    "mp_payment_id": mp_payment_id,
                    "amount": float(locked_payment.amount),
                    "installment_id": getattr(locked_installment, "id", None),
                },
            )
            audit_log(
                action="webhook_payment_approved",
                entity_type="Payment",
                entity_id=str(locked_payment.pk),
                before=before_snapshot,
                after=after_snapshot,
                extra={
                    "event_id": event_id,
                    "mp_payment_id": mp_payment_id,
                    "status": status_norm,
                },
                request=None,
            )
        elif status_norm == "rejected":
            metrics.payments_failed_total.inc()
            locked_payment.state = "REJ"
            locked_payment.save(update_fields=["mp_payment_id", "state"])
            logger.info(
                "mp_webhook_payment_rejected",
                extra={"payment_id": locked_payment.id, "policy_id": locked_payment.policy_id, "mp_payment_id": mp_payment_id},
            )
            audit_log(
                action="webhook_payment_rejected",
                entity_type="Payment",
                entity_id=str(locked_payment.pk),
                before=before_snapshot,
                after=snapshot_entity(locked_payment),
                extra={
                    "event_id": event_id,
                    "mp_payment_id": mp_payment_id,
                    "status": status_norm,
                },
                request=None,
            )
        else:
            locked_payment.state = "PEN"
            locked_payment.save(update_fields=["mp_payment_id", "state"])
            logger.info(
                "mp_webhook_payment_pending",
                extra={"payment_id": locked_payment.id, "policy_id": locked_payment.policy_id, "mp_payment_id": mp_payment_id},
            )
            audit_log(
                action="webhook_payment_pending",
                entity_type="Payment",
                entity_id=str(locked_payment.pk),
                before=before_snapshot,
                after=snapshot_entity(locked_payment),
                extra={
                    "event_id": event_id,
                    "mp_payment_id": mp_payment_id,
                    "status": status_norm,
                },
                request=None,
            )

        payment = locked_payment

    if receipt:
        try:
            payment_for_pdf = Payment.objects.select_related("policy__vehicle", "policy__product", "policy__user").get(pk=payment.pk)
            rel_path = generate_receipt_pdf(payment_for_pdf)
        except Exception as exc:
            logger.exception(
                "mp_webhook_receipt_pdf_failed",
                extra={
                    "payment_id": payment.pk,
                    "receipt_id": receipt.id,
                    "error": str(exc),
                },
            )
        else:
            if rel_path:
                payment_for_pdf.receipt_pdf.name = rel_path
                payment_for_pdf.save(update_fields=["receipt_pdf"])
                receipt.file.name = rel_path
                receipt.save(update_fields=["file"])

    return Response({"detail": "ok"})


def _mp_create_preference(payload):
    headers = _mp_headers()
    if not headers:
        return None, "MP_ACCESS_TOKEN no configurado"
    if not requests:
        return None, "requests no está instalado; ejecutá `pip install -r requirements.txt` para habilitar Mercado Pago."
    try:
        resp = requests.post(
            "https://api.mercadopago.com/checkout/preferences",
            json=payload,
            headers=headers,
            timeout=10,
        )
        if resp.status_code >= 300:
            return None, f"Mercado Pago respondió {resp.status_code}: {resp.text}"
        return resp.json(), ""
    except Exception as exc:
        return None, f"No se pudo crear preferencia en Mercado Pago: {exc}"


def _mp_fetch_payment(mp_payment_id):
    headers = _mp_headers()
    if not headers:
        return None, "MP_ACCESS_TOKEN no configurado"
    if not requests:
        return None, "requests no está instalado; ejecutá `pip install -r requirements.txt` para habilitar Mercado Pago."
    try:
        resp = requests.get(
            f"https://api.mercadopago.com/v1/payments/{mp_payment_id}",
            headers=headers,
            timeout=10,
        )
        if resp.status_code >= 300:
            return None, f"Mercado Pago respondió {resp.status_code}: {resp.text}"
        return resp.json(), ""
    except Exception as exc:
        return None, f"No se pudo consultar el pago en Mercado Pago: {exc}"

class PaymentViewSet(viewsets.ModelViewSet):
    queryset = Payment.objects.all().order_by('-id')
    serializer_class = PaymentSerializer

    def get_permissions(self):
        if self.action in ['create_preference', 'pending']:
            return [permissions.IsAuthenticated()]
        return [permissions.IsAdminUser()]

    @action(detail=False, methods=['get'], url_path='config', permission_classes=[permissions.IsAdminUser])
    def config(self, request):
        """
        Health-check de configuración de pagos/MP.
        Solo admins.
        """
        token_ok = bool(_mp_headers())
        secret = bool((os.getenv("MP_WEBHOOK_SECRET") or "").strip())
        require_secret = not settings.DEBUG
        if os.getenv("MP_REQUIRE_WEBHOOK_SECRET") is not None:
            require_secret = _env_bool(os.getenv("MP_REQUIRE_WEBHOOK_SECRET"))
        allow_fake = _mp_fake_payments_allowed()
        notification_url = _mp_notification_url(request)
        return Response(
            {
                "mp_token_configured": token_ok,
                "webhook_secret_configured": secret,
                "webhook_secret_required": require_secret,
                "fake_payments_allowed": allow_fake,
                "notification_url": notification_url,
                "debug": settings.DEBUG,
            }
        )

    @action(detail=False, methods=['post'], url_path='policies/(?P<policy_id>[^/.]+)/create_preference')
    def create_preference(self, request, policy_id=None):
        policy = get_scoped_policy_or_404(request, id=policy_id)
        user = request.user

        if policy.status in ADMIN_MANAGED_STATUSES:
            logger.warning(
                "payment_create_preference_blocked_admin_status",
                extra={
                    "payment_id": None,
                    "policy_id": policy.id,
                    "policy_status": policy.status,
                    "user_id": user.id,
                },
            )
            return Response(
                {"detail": "La póliza está en un estado administrado (cancelada/suspendida) y no acepta pagos online."},
                status=403,
            )

        # Explicitly reject legacy charge-based contracts; billing is installment-driven only.
        if request.data.get("charge_ids"):
            return Response(
                {
                    "detail": "Los `charge_ids` están obsoletos; envía `installment_id`."
                },
                status=400,
            )
        installment_id = request.data.get("installment_id")
        if not installment_id:
            return Response(
                {"detail": "`installment_id` requerido para iniciar el pago."},
                status=400,
            )
        try:
            installment = PolicyInstallment.objects.select_related("policy").get(id=installment_id)
        except PolicyInstallment.DoesNotExist:
            return Response({"detail": "installment_id inválido."}, status=400)
        if installment.policy_id != policy.id:
            return Response({"detail": "La cuota no corresponde a esta póliza."}, status=400)
        if installment.status == PolicyInstallment.Status.PAID or installment.paid_at:
            logger.warning(
                "payment_create_preference_blocked_paid_installment",
                extra={
                    "policy_id": policy.id,
                    "installment_id": installment.id,
                },
            )
            return Response(
                {"detail": "La cuota ya fue pagada y no se puede iniciar otro cobro."},
                status=409,
            )

        period = None
        if installment.period_start_date:
            period = f"{installment.period_start_date.year}{str(installment.period_start_date.month).zfill(2)}"
        if not period:
            period = f"{date.today().year}{str(date.today().month).zfill(2)}"

        amount = installment.amount or Decimal("0")
        if amount <= 0:
            return Response({"detail": "Monto inválido para iniciar el pago."}, status=400)

        headers = _mp_headers()

        payment = None
        with transaction.atomic():
            locked_payment = (
                Payment.objects.select_for_update()
                .filter(installment=installment)
                .order_by("-id")
                .first()
            )
            if locked_payment and locked_payment.state == "APR":
                logger.warning(
                    "payment_create_preference_blocked_existing_apr",
                    extra={
                        "payment_id": locked_payment.id,
                        "policy_id": policy.id,
                        "installment_id": installment.id,
                        "user_id": user.id,
                    },
                )
                return Response(
                    {"detail": "Ya existe un pago aprobado para esta cuota; no se puede iniciar otro cobro."},
                    status=409,
                )

            if locked_payment and locked_payment.state == "REJ":
                locked_payment.state = "PEN"
                locked_payment.mp_preference_id = ""
                locked_payment.mp_payment_id = ""
                locked_payment.save(update_fields=["state", "mp_preference_id", "mp_payment_id"])
                payment = locked_payment
            elif locked_payment:
                payment = locked_payment
                if locked_payment.period != period or locked_payment.amount != amount:
                    locked_payment.period = period
                    locked_payment.amount = amount
                    locked_payment.save(update_fields=["period", "amount"])
            else:
                payment = Payment.objects.create(
                    policy=policy,
                    installment=installment,
                    period=period,
                    amount=amount,
                )
                metrics.payments_created_total.inc()
                audit_log(
                    action="payment_created",
                    entity_type="Payment",
                    entity_id=str(payment.pk),
                    after=snapshot_entity(payment),
                    request=request,
                    actor=request.user,
                    extra={
                        "policy_id": policy.id,
                        "installment_id": installment.id,
                        "amount": float(amount),
                    },
                )
        logger.info(
            "payment_create_preference_start",
            extra={
                "payment_id": payment.id,
                "policy_id": policy.id,
                "amount": float(amount),
                "user_id": user.id,
                "has_mp_token": bool(headers),
                "installment_id": installment.id,
            },
        )

        # Si MP no está configurado, permitimos un modo "fake" para no bloquear cobros en demo.
        if not headers:
            if not _mp_fake_payments_allowed():
                payment.state = "REJ"
                payment.mp_preference_id = ""
                payment.mp_payment_id = ""
                payment.save(update_fields=["state", "mp_preference_id", "mp_payment_id"])
                return Response(
                    {
                        "detail": "Mercado Pago no está configurado (MP_ACCESS_TOKEN ausente). "
                                  "Definí MP_ACCESS_TOKEN o habilitá MP_ALLOW_FAKE_PREFERENCES para modo demo."
                    },
                    status=503,
                )
            # Modo demo: marcamos pago como aprobado y generamos recibo.
            payment.state = "APR"
            payment.mp_preference_id = f"offline-{payment.id}"
            payment.mp_payment_id = "offline"
            payment.save(update_fields=["state", "mp_preference_id", "mp_payment_id"])
            logger.warning(
                "payment_fake_mode_used",
                extra={
                    "payment_id": payment.id,
                    "policy_id": policy.id,
                    "amount": float(amount),
                    "installment_id": installment.id,
                },
            )
            installment.mark_paid(payment=payment)
            receipt = Receipt.objects.create(
                policy=policy,
                amount=amount,
                concept="Pago registrado en modo demo (sin MP)",
                method="manual",
                auth_code="offline",
                next_due=None,
            )
            rel_path = generate_receipt_pdf(payment)
            if rel_path:
                payment.receipt_pdf.name = rel_path
                payment.save(update_fields=["receipt_pdf"])
                receipt.file.name = rel_path
                receipt.save(update_fields=["file"])

            # Devolvemos un init_point simulado para que el front no falle al abrir.
            fake_init_point = f"https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id={payment.mp_preference_id}"
            return Response(
                {
                    "preference_id": payment.mp_preference_id,
                    "mp_preference_id": payment.mp_preference_id,
                    "init_point": fake_init_point,
                    "payment_id": payment.id,
                    "offline": True,
                }
            )

        # Payload real para MP
        items = [
            {
                "title": f"Cuota {installment.sequence}",
                "quantity": 1,
                "unit_price": float(installment.amount or 0),
                "currency_id": "ARS",
            }
        ]
        notification_url = _mp_notification_url(request)
        preference_payload = {
            "items": items,
            "external_reference": str(payment.id),
            "metadata": {
                "payment_id": payment.id,
                "policy_id": policy.id,
            },
            "statement_descriptor": "SAN CAYETANO",
        }
        if notification_url:
            preference_payload["notification_url"] = notification_url

        pref_data, err = _mp_create_preference(preference_payload)
        if pref_data is None:
            payment.state = "REJ"
            payment.mp_preference_id = ""
            payment.mp_payment_id = ""
            payment.save(update_fields=["state", "mp_preference_id", "mp_payment_id"])
            logger.error(
                "payment_create_preference_failed",
                extra={"payment_id": payment.id, "policy_id": policy.id, "error": err},
            )
            return Response({"detail": err}, status=502)

        preference_id = pref_data.get("id") or pref_data.get("preference_id")
        init_point = pref_data.get("init_point") or pref_data.get("sandbox_init_point")
        if not preference_id or not init_point:
            payment.state = "REJ"
            payment.mp_preference_id = ""
            payment.mp_payment_id = ""
            payment.save(update_fields=["state", "mp_preference_id", "mp_payment_id"])
            return Response({"detail": "Mercado Pago no devolvió preference_id/init_point."}, status=502)

        payment.mp_preference_id = preference_id
        payment.save(update_fields=["mp_preference_id"])
        logger.info(
            "payment_create_preference_success",
            extra={
                "payment_id": payment.id,
                "policy_id": policy.id,
                "preference_id": preference_id,
                "amount": float(amount),
            },
        )

        return Response({'preference_id': preference_id, 'mp_preference_id': preference_id, 'init_point': init_point, 'payment_id': payment.id})

    @action(detail=False, methods=['get'], url_path='pending')
    def pending(self, request):
        policy_id = request.query_params.get("policy_id")
        if not policy_id:
            return Response({"detail": "policy_id requerido"}, status=400)
        policy = get_scoped_policy_or_404(request, id=policy_id)
        # Datos mínimos requeridos para generar cargos
        if not getattr(policy, "start_date", None):
            return Response({"detail": "La póliza no tiene fecha de inicio. Cargá start_date para habilitar los pagos."}, status=400)
        if getattr(policy, "premium", None) in (None, ""):
            return Response({"detail": "La póliza no tiene premium definido. Cargá un premio mensual para habilitar los pagos."}, status=400)
        refresh_installment_statuses(policy.installments.all(), persist=True)
        unpaid = policy.installments.exclude(status=PolicyInstallment.Status.PAID).order_by("sequence")
        unpaid_list = list(unpaid)
        today = date.today()
        in_window = [
            inst
            for inst in unpaid_list
            if inst.payment_window_start
            and inst.payment_window_end
            and inst.payment_window_start <= today <= inst.payment_window_end
        ]
        target = in_window[0] if in_window else (unpaid_list[0] if unpaid_list else None)
        if not target:
            return Response(
                {
                    "installment": None,
                    "detail": "No hay cuotas pendientes.",
                }
            )
        installment_payload = {
            "installment_id": target.id,
            "policy_id": target.policy_id,
            "amount": str(target.amount),
            "status": target.status,
            "period_start_date": target.period_start_date,
            "payment_window_start": target.payment_window_start,
            "payment_window_end": target.payment_window_end,
            "due_date_display": target.due_date_display,
            "due_date_real": target.due_date_real,
        }
        # Only the next unpaid installment is returned; charge lists were removed with the Charge model.
        return Response({"installment": installment_payload})

@api_view(['POST'])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def mp_webhook(request):
    metrics.webhooks_received_total.inc()
    auth = _authorize_mp_webhook(request)
    # Backward compatibility: some deployments returned 2-tuple (ok, detail).
    if isinstance(auth, tuple) and len(auth) == 3:
        ok, err, status_code = auth
    elif isinstance(auth, tuple) and len(auth) == 2:
        ok, err = auth
        status_code = 200 if ok else 403
    else:
        ok, err, status_code = False, "Respuesta inválida de _authorize_mp_webhook", 500
    if not ok:
        logger.warning(
            "mp_webhook_rejected",
            extra={
                "reason": err,
                **_webhook_request_context(request),
            },
        )
        metrics.webhooks_invalid_signature_total.inc()
        audit_log(
            action="webhook_invalid_signature",
            entity_type="PaymentWebhookEvent",
            entity_id=event_id if event_id else None,
            extra={"reason": err},
            request=request,
        )
        return Response({'detail': err}, status=status_code)

    # Notificación clásica (propia) o oficial de MP
    payload = request.data or {}
    payload_dict = _normalize_payload(payload)
    mp_payment_id = payload.get('mp_payment_id') or payload.get("data", {}).get("id") or payload.get("id")
    status_str = payload.get('status')
    pid = payload.get('payment_id') or payload.get("external_reference")
    preference_id = payload.get('mp_preference_id') or payload.get("preference_id")
    amount_raw = payload.get('amount')
    event_id = payload.get("id") or payload.get("event_id")
    event_type = payload.get("type") or payload.get("topic")
    event_extra = {
        "event_id": event_id,
        "event_type": event_type,
        "mp_payment_id": mp_payment_id,
        "status": status_str,
    }
    logger.info(
        "mp_webhook_authorized",
        extra={"event": {k: v for k, v in event_extra.items() if v}},
    )
    audit_log(
        action="webhook_received",
        entity_type="PaymentWebhookEvent",
        entity_id=event_id if event_id else None,
        after={"event": event_extra, "status": status_str},
        request=request,
    )

    # Si viene id de MP y hay token, consultamos a MP para validar
    payment_info = None
    if mp_payment_id:
        payment_info, fetch_err = _mp_fetch_payment(mp_payment_id)
        if payment_info:
            status_str = payment_info.get("status") or status_str
            pid = pid or payment_info.get("external_reference")
            amount_raw = amount_raw or payment_info.get("transaction_amount")
            preference_id = preference_id or payment_info.get("order", {}).get("id") or payment_info.get("metadata", {}).get("preference_id")
        elif fetch_err:
            return Response({"detail": fetch_err}, status=502)

    if not pid:
        return Response({'detail':'payment_id/external_reference requerido'}, status=400)

    try:
        payment = Payment.objects.get(id=pid)
    except Payment.DoesNotExist:
        return Response({'detail':'payment_id inválido'}, status=400)

    return _process_mp_webhook_for_payment(
        payment,
        payload_dict,
        mp_payment_id,
        status_str,
        preference_id,
        amount_raw,
    )


@api_view(['POST'])
@permission_classes([permissions.IsAdminUser])
def manual_payment(request, policy_id=None):
    policy = get_scoped_policy_or_404(request, id=policy_id)
    admin_user_id = request.user.id if request.user and request.user.is_authenticated else None
    settings_obj = AppSettings.get_solo()
    today = date.today()
    cycle = current_payment_cycle(policy, settings_obj) or {}
    payment_start = cycle.get("payment_window_start") or getattr(policy, "start_date", None) or today
    payment_end = cycle.get("due_real") or payment_start

    premium = getattr(policy, "premium", None) or getattr(getattr(policy, "product", None), "base_price", None)
    if premium in (None, 0, ""):
        return Response({"detail": "La póliza no tiene premio definido para cobrar."}, status=400)
    period_str = None
    if payment_end:
        period_str = f"{payment_end.year}{str(payment_end.month).zfill(2)}"
    period_str = period_str or f"{today.year}{str(today.month).zfill(2)}"


    existing_payment = Payment.objects.filter(
        policy=policy,
        period=period_str,
        state="APR",
        mp_payment_id="manual",
    ).order_by("-id").first()
    def _manual_detail(base):
        policy_status = getattr(policy, "status", "active")
        if policy_status in ADMIN_MANAGED_STATUSES:
            return f"{base} La póliza permanece {policy_status} porque está administrada manualmente."
        return base

    if existing_payment:
        receipt = Receipt.objects.filter(policy=policy, method="manual").order_by("-id").first()
        if not receipt:
            receipt = Receipt.objects.create(
                policy=policy,
                amount=premium,
                concept="Pago manual (reintento)",
                method="manual",
                auth_code=f"admin:{request.user.id if request.user.is_authenticated else 'unknown'}",
                next_due=None,
                date=date.today(),
            )
        logger.info(
            "manual_payment_existing",
            extra={
                "policy_id": policy.id,
                "admin_user_id": admin_user_id,
                "period": period_str,
                "amount": premium,
                "payment_id": existing_payment.id,
            },
        )
        return Response(
            {
                "detail": _manual_detail("Pago manual ya registrado."),
                "payment_id": existing_payment.id,
                "receipt_id": receipt.id,
                "policy_status": policy.status,
            }
        )

    pay_obj = Payment.objects.create(
        policy=policy,
        period=period_str,
        amount=premium,
        state="APR",
        mp_payment_id="manual",
    )
    audit_log(
        action="manual_payment_created",
        entity_type="Payment",
        entity_id=str(pay_obj.pk),
        after=snapshot_entity(pay_obj),
        request=request,
        actor=request.user,
        extra={
            "policy_id": policy.id,
            "period": period_str,
            "amount": float(premium or 0),
        },
    )
    installment = mark_cycle_installment_paid(policy, payment=pay_obj)
    receipt = Receipt.objects.create(
        policy=policy,
        amount=premium,
        concept="Pago manual",
        method="manual",
        auth_code=f"admin:{request.user.id if request.user.is_authenticated else 'unknown'}",
        next_due=None,
        date=date.today(),
    )
    rel_path = generate_receipt_pdf(pay_obj)
    if rel_path:
        pay_obj.receipt_pdf.name = rel_path
        pay_obj.save(update_fields=["receipt_pdf"])
        receipt.file.name = rel_path
        receipt.save(update_fields=["file"])

    logger.info(
        "manual_payment_created",
        extra={
            "policy_id": policy.id,
            "admin_user_id": admin_user_id,
            "period": period_str,
            "amount": premium,
            "payment_id": pay_obj.id,
        },
    )

    return Response(
        {
            "detail": _manual_detail("Pago manual registrado."),
            "receipt_id": receipt.id,
            "installment_id": getattr(installment, "id", None),
            "policy_status": policy.status,
        }
    )
