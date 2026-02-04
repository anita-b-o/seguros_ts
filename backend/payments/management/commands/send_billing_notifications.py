from datetime import date, timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from common.models import ContactInfo
from payments.billing import get_or_create_current_period
from payments.models import BillingNotification, BillingPeriod
from policies.models import Policy


def _fmt_date(value: date | None) -> str:
    if not value:
        return "-"
    return value.strftime("%d/%m/%Y")


def _fmt_period_label(period: BillingPeriod) -> str:
    if not period or not period.period_start:
        return "-"
    return period.period_start.strftime("%m/%Y")


def _fmt_money(amount) -> str:
    try:
        amt = float(amount or 0)
    except (TypeError, ValueError):
        amt = 0.0
    return f"{amt:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def _user_name(user) -> str:
    if not user:
        return ""
    full = ""
    try:
        full = user.get_full_name() or ""
    except Exception:
        full = ""
    if not full:
        first = getattr(user, "first_name", "") or ""
        last = getattr(user, "last_name", "") or ""
        full = f"{first} {last}".strip()
    return full or getattr(user, "email", "") or ""


def _build_message(notification_type: str, *, period: BillingPeriod, contact: ContactInfo) -> tuple[str, str]:
    policy = period.policy
    policy_number = getattr(policy, "number", None) or str(getattr(policy, "id", "-"))
    name = _user_name(getattr(policy, "user", None))
    greeting = f"Hola {name}," if name else "Hola,"

    period_label = _fmt_period_label(period)
    amount = _fmt_money(period.amount)
    currency = getattr(period, "currency", "ARS")
    start = _fmt_date(period.period_start)
    due_soft = _fmt_date(period.due_date_soft)
    due_hard = _fmt_date(period.due_date_hard)

    support = ""
    if contact:
        parts = [p for p in [contact.email, contact.whatsapp] if p]
        if parts:
            support = f"\nContacto: {' / '.join(parts)}"

    if notification_type == BillingNotification.Type.PERIOD_START:
        subject = f"Factura disponible - Póliza {policy_number}"
        body = (
            f"{greeting}\n\n"
            f"Ya está disponible la factura del período {period_label} de tu póliza {policy_number}.\n"
            f"Monto: {amount} {currency}.\n"
            f"Período de pago: {start} al {due_hard}.\n"
            f"Vencimiento adelantado: {due_soft}.\n\n"
            "Podés abonar por los canales habituales para mantener la cobertura."
            f"\n\nGracias,\nSan Cayetano Seguros{support}"
        )
        return subject, body

    if notification_type == BillingNotification.Type.SOFT_DUE_TOMORROW:
        subject = f"Mañana vence - Póliza {policy_number}"
        body = (
            f"{greeting}\n\n"
            f"Te recordamos que mañana vence el pago adelantado de tu póliza {policy_number}.\n"
            f"Vencimiento adelantado: {due_soft}.\n\n"
            "Si todavía no abonaste, hacelo cuanto antes para evitar quedarte sin cobertura."
            f"\n\nGracias,\nSan Cayetano Seguros{support}"
        )
        return subject, body

    if notification_type == BillingNotification.Type.SOFT_DUE_TODAY:
        subject = f"Último día de cobertura - Póliza {policy_number}"
        body = (
            f"{greeting}\n\n"
            f"Hoy es el vencimiento adelantado de tu póliza {policy_number}.\n"
            "Si aún no abonaste, hacelo hoy para mantener la cobertura."
            f"\n\nGracias,\nSan Cayetano Seguros{support}"
        )
        return subject, body

    if notification_type == BillingNotification.Type.NO_COVERAGE:
        subject = f"Sin cobertura - Póliza {policy_number}"
        body = (
            f"{greeting}\n\n"
            "Estás viajando sin cobertura porque no se registró el pago.\n"
            "Pagá ahora para continuar con tu póliza."
            f"\n\nGracias,\nSan Cayetano Seguros{support}"
        )
        return subject, body

    if notification_type == BillingNotification.Type.HARD_DUE_TODAY:
        subject = f"Último día real - Póliza {policy_number}"
        body = (
            f"{greeting}\n\n"
            f"Hoy es el vencimiento real de tu póliza {policy_number}.\n"
            "Si todavía no abonaste, hacelo ahora para evitar el vencimiento."
            f"\n\nGracias,\nSan Cayetano Seguros{support}"
        )
        return subject, body

    if notification_type == BillingNotification.Type.HARD_DUE_PASSED:
        subject = f"Póliza vencida - Póliza {policy_number}"
        body = (
            f"{greeting}\n\n"
            "Tu póliza está vencida porque pasó el vencimiento real y no se registró el pago.\n"
            "Comunicate con la aseguradora para continuar con el servicio."
            f"\n\nGracias,\nSan Cayetano Seguros{support}"
        )
        return subject, body

    return "Notificación de póliza", f"{greeting}\n\nTenés una notificación pendiente."


def _notifications_for_today(period: BillingPeriod, today: date) -> list[str]:
    if not period:
        return []

    notifications = []
    soft_same_as_hard = period.due_date_soft == period.due_date_hard
    if period.period_start == today:
        notifications.append(BillingNotification.Type.PERIOD_START)
    if period.due_date_soft == today + timedelta(days=1):
        notifications.append(BillingNotification.Type.SOFT_DUE_TOMORROW)
    if not soft_same_as_hard and period.due_date_soft == today:
        notifications.append(BillingNotification.Type.SOFT_DUE_TODAY)
    if not soft_same_as_hard and period.due_date_soft == today - timedelta(days=1):
        notifications.append(BillingNotification.Type.NO_COVERAGE)
    if period.due_date_hard == today:
        notifications.append(BillingNotification.Type.HARD_DUE_TODAY)
    if period.due_date_hard == today - timedelta(days=1):
        notifications.append(BillingNotification.Type.HARD_DUE_PASSED)

    return notifications


class Command(BaseCommand):
    help = "Envía notificaciones de pago por email según el calendario de facturación."

    def add_arguments(self, parser):
        parser.add_argument(
            "--date",
            type=str,
            help="Fecha a procesar (YYYY-MM-DD). Por defecto: hoy.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="No envía emails ni persiste notificaciones; solo simula.",
        )
        parser.add_argument(
            "--policy-id",
            type=int,
            help="Limita la ejecución a una póliza específica.",
        )
        parser.add_argument(
            "--ensure-current",
            action="store_true",
            help="Crea el periodo vigente para pólizas activas si todavía no existe.",
        )

    def handle(self, *args, **options):
        today = timezone.localdate()
        if options.get("date"):
            today = date.fromisoformat(options["date"])

        policy_id = options.get("policy_id")
        dry_run = options.get("dry_run")
        ensure_current = options.get("ensure_current")

        if ensure_current:
            policy_qs = Policy.objects.select_related("user").filter(
                is_deleted=False,
                status="active",
            )
            if policy_id:
                policy_qs = policy_qs.filter(id=policy_id)
            for policy in policy_qs.iterator():
                get_or_create_current_period(policy, now=today)

        soft_tomorrow = today + timedelta(days=1)
        soft_yesterday = today - timedelta(days=1)
        hard_yesterday = today - timedelta(days=1)

        periods = BillingPeriod.objects.select_related("policy", "policy__user").filter(
            Q(period_start=today)
            | Q(due_date_soft__in=[today, soft_tomorrow, soft_yesterday])
            | Q(due_date_hard__in=[today, hard_yesterday])
        )
        if policy_id:
            periods = periods.filter(policy_id=policy_id)

        contact = ContactInfo.get_solo()
        sent = 0
        skipped = 0
        failures = 0

        for period in periods.iterator():
            policy = period.policy
            if not policy or policy.is_deleted or policy.status in ("cancelled", "inactive"):
                skipped += 1
                continue
            if period.status == BillingPeriod.Status.PAID:
                skipped += 1
                continue

            user = getattr(policy, "user", None)
            email = getattr(user, "email", "") or ""
            if not email:
                skipped += 1
                continue

            for notification_type in _notifications_for_today(period, today):
                exists = BillingNotification.objects.filter(
                    billing_period=period,
                    notification_type=notification_type,
                    trigger_date=today,
                ).exists()
                if exists:
                    skipped += 1
                    continue

                subject, body = _build_message(notification_type, period=period, contact=contact)

                if dry_run:
                    sent += 1
                    continue

                try:
                    send_mail(
                        subject,
                        body,
                        getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@sancayetano.com"),
                        [email],
                        fail_silently=False,
                    )
                except Exception:
                    failures += 1
                    continue

                BillingNotification.objects.create(
                    billing_period=period,
                    notification_type=notification_type,
                    trigger_date=today,
                    sent_to=email,
                    subject=subject,
                    body=body,
                )
                sent += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Notificaciones enviadas: {sent}. Omitidas: {skipped}. Fallidas: {failures}. Fecha: {today}."
            )
        )
