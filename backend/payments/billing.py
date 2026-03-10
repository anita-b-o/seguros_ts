"""
Servicio para la política de facturación mensual.

El modelo de suscripción es mensual y se paga el mes en curso. El módulo
mantiene los periodos con `due_date_soft` (informativa) y `due_date_hard`
(corte real), garantiza que no se puedan cobrar meses futuros ni vencidos,
y registra snapshots de pricing al recalcular el monto.
"""

from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from django.db import IntegrityError, transaction
from django.utils import timezone

from audit.helpers import audit_log, snapshot_entity
from common.models import AppSettings
from policies.models import Policy
from policies.billing import compute_term_end_date

from .models import BillingPeriod, Payment

DEFAULT_BILLING_PERIOD_CURRENCY = "ARS"



def _first_of_month(day: date) -> date:
    return date(day.year, day.month, 1)


def _last_of_month(day: date) -> date:
    last = monthrange(day.year, day.month)[1]
    return date(day.year, day.month, last)


def _clamp_to_month(period_start: date, target_day: int) -> date:
    last_day = monthrange(period_start.year, period_start.month)[1]
    safe_day = max(1, min(target_day, last_day))
    candidate = date(period_start.year, period_start.month, safe_day)
    if candidate < period_start:
        return period_start
    return candidate


def _add_months(start: date, months: int) -> date:
    if months == 0:
        return start
    year = start.year + (start.month - 1 + months) // 12
    month = (start.month - 1 + months) % 12 + 1
    last_day = monthrange(year, month)[1]
    return date(year, month, min(start.day, last_day))


def _policy_period_start(policy: Policy, today: date) -> Optional[date]:
    if not policy.start_date:
        return None
    if today < policy.start_date:
        return None
    months = (today.year - policy.start_date.year) * 12 + (today.month - policy.start_date.month)
    if months < 0:
        return None
    period_start = _add_months(policy.start_date, months)
    if period_start > today:
        months = max(0, months - 1)
        period_start = _add_months(policy.start_date, months)
    return period_start


def _cycle_dates_from_window(
    period_start: date,
    *,
    payment_window_days: int,
    display_offset_days: int,
) -> dict:
    window_days = max(1, payment_window_days)
    display_offset = max(0, display_offset_days)
    period_end = _add_months(period_start, 1) - timedelta(days=1)
    due_real = period_start + timedelta(days=window_days - 1)
    if due_real > period_end:
        due_real = period_end
    due_display = due_real - timedelta(days=display_offset)
    if due_display < period_start:
        due_display = period_start
    return {
        "period_end": period_end,
        "due_display": due_display,
        "due_real": due_real,
    }


def assert_is_current_period(period: "BillingPeriod", *, today: Optional[date] = None) -> bool:
    """
    Valida que el periodo coincide con el mes vigente para evitar pagos de
    meses pasados o futuros.
    """
    if not period:
        raise ValueError("No se especificó un periodo de facturación.")
    today = today or timezone.localdate()
    expected_start = _policy_period_start(period.policy, today)
    if not expected_start or period.period_start != expected_start:
        raise ValueError("El periodo no corresponde al mes vigente.")
    return True


def next_price_update_window(policy, settings_obj=None, today=None):
    """
    Informational helper used by policies timeline responses.
    Camino A billing uses BillingPeriod only; pricing update windows are optional.
    Return None if no window can be computed.
    """
    return None, None


def _to_decimal(value) -> Optional[Decimal]:
    if value in (None, ""):
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        return None


def _policy_monthly_amount(policy: Policy) -> Optional[Decimal]:
    candidate = policy.premium
    if candidate in (None, ""):
        candidate = getattr(getattr(policy, "product", None), "base_price", None)
    return _to_decimal(candidate)


def _pricing_snapshot(policy: Policy) -> dict:
    product = getattr(policy, "product", None)
    return {
        "policy_number": policy.number,
        "policy_updated_at": policy.updated_at.isoformat()
        if getattr(policy, "updated_at", None)
        else None,
        "premium": str(policy.premium or ""),
        "product_code": getattr(product, "code", None),
        "product_base_price": str(getattr(product, "base_price", "") or ""),
    }


def get_or_create_current_period(policy: Policy, *, now: Optional[date] = None) -> Optional[BillingPeriod]:
    today = now or timezone.localdate()
    period_start = _policy_period_start(policy, today)
    if not period_start:
        return None
    cycle = _cycle_dates_from_window(
        period_start,
        payment_window_days=policy.get_effective_payment_window_days(),
        display_offset_days=policy.get_effective_client_expiration_offset_days(),
    )
    period_end = cycle["period_end"]
    amount = _policy_monthly_amount(policy)
    if amount is None or amount <= 0:
        return None
    snapshot = _pricing_snapshot(policy)

    period = BillingPeriod.objects.filter(policy=policy, period_start=period_start).first()
    if period:
        if period.due_date_hard and today > period.due_date_hard:
            return period
        updates = {}
        if period.period_end != period_end:
            updates["period_end"] = period_end
        if period.due_date_soft != cycle["due_display"]:
            updates["due_date_soft"] = cycle["due_display"]
        if period.due_date_hard != cycle["due_real"]:
            updates["due_date_hard"] = cycle["due_real"]
        if updates:
            for key, value in updates.items():
                setattr(period, key, value)
            period.save(update_fields=[*updates.keys(), "updated_at"])
        return period

    try:
        with transaction.atomic():
            period = BillingPeriod.objects.create(
                policy=policy,
                period_start=period_start,
                period_end=period_end,
                due_date_soft=cycle["due_display"],
                due_date_hard=cycle["due_real"],
                amount=amount,
                currency=DEFAULT_BILLING_PERIOD_CURRENCY,
                status=BillingPeriod.Status.UNPAID,
                pricing_snapshot=snapshot,
            )
    except IntegrityError:
        period = BillingPeriod.objects.get(policy=policy, period_start=period_start)
    return period


def get_current_billing_period(policy: Policy, *, now: Optional[date] = None) -> Optional[BillingPeriod]:
    today = now or timezone.localdate()
    period_start = _policy_period_start(policy, today)
    if not period_start:
        return None
    return BillingPeriod.objects.filter(policy=policy, period_start=period_start).first()


def recalc_current_period_amount(policy: Policy, period: BillingPeriod, *, now: Optional[date] = None) -> bool:
    if period.status != BillingPeriod.Status.UNPAID:
        return False
    today = now or timezone.localdate()
    if period.due_date_hard and today > period.due_date_hard:
        return False
    new_amount = _policy_monthly_amount(policy)
    if new_amount is None or new_amount <= 0:
        return False
    snapshot = _pricing_snapshot(policy)
    if period.amount == new_amount and period.pricing_snapshot == snapshot:
        return False
    period.amount = new_amount
    period.pricing_snapshot = snapshot
    period.save(update_fields=["amount", "pricing_snapshot", "updated_at"])
    return True


def ensure_current_billing_period(policy: Policy, *, now: Optional[date] = None) -> Optional[BillingPeriod]:
    """
    Garantiza que exista el BillingPeriod del mes en curso, limpio y sin suspender la póliza
    (reactiva si corresponde y la póliza no está cancelada).
    """
    today = now or timezone.localdate()
    if policy.status not in ("cancelled", "inactive", "suspended") and policy.status != "active":
        reactivate_policy_if_applicable(policy)
    period = get_or_create_current_period(policy, now=today)
    if not period:
        return None
    return period


def _expire_policy_if_applicable(policy: Policy) -> bool:
    if policy.status in ("cancelled", "inactive"):
        return False
    if policy.status == "expired":
        return False
    before = snapshot_entity(policy)
    policy.status = "expired"
    policy.save(update_fields=["status", "updated_at"])
    audit_log(
        action="policy_expired_for_overdue",
        entity_type="Policy",
        entity_id=str(policy.pk),
        before=before,
        after=snapshot_entity(policy),
        extra={"reason": "billing_period_overdue"},
    )
    return True


def reactivate_policy_if_applicable(policy: Policy) -> bool:
    if policy.status in ("cancelled", "inactive", "suspended"):
        return False
    if policy.status == "active":
        return False
    before = snapshot_entity(policy)
    today = timezone.localdate()
    settings_obj = AppSettings.get_solo()
    term_months = max(1, int(getattr(settings_obj, "default_term_months", 0) or 0))
    end_date = compute_term_end_date(today, term_months) if term_months > 0 else policy.end_date
    policy.status = "active"
    policy.start_date = today
    policy.end_date = end_date
    policy.apply_settings_snapshot(settings_obj=settings_obj)
    policy.save(
        update_fields=[
            "status",
            "start_date",
            "end_date",
            "default_term_months_snapshot",
            "payment_window_days_snapshot",
            "client_expiration_offset_days_snapshot",
            "policy_adjustment_window_days_snapshot",
            "updated_at",
        ]
    )
    stale_periods = (
        BillingPeriod.objects.filter(policy=policy)
        .exclude(status=BillingPeriod.Status.PAID)
        .exclude(payments__state="APR")
        .distinct()
    )
    if stale_periods.exists():
        Payment.objects.filter(billing_period__in=stale_periods).exclude(state="APR").delete()
        stale_periods.delete()
    current_period = get_or_create_current_period(policy, now=today)
    if current_period and current_period.status != BillingPeriod.Status.UNPAID:
        current_period.status = BillingPeriod.Status.UNPAID
        current_period.save(update_fields=["status", "updated_at"])
    audit_log(
        action="policy_reactivated_after_payment",
        entity_type="Policy",
        entity_id=str(policy.pk),
        before=before,
        after=snapshot_entity(policy),
        extra={"reason": "billing_period_paid"},
    )
    return True


def mark_overdue_and_suspend_if_needed(
    policy: Policy, period: BillingPeriod, *, now: Optional[date] = None
) -> bool:
    """
    Marca el periodo como OVERDUE y vence la póliza si corresponde.
    El servicio de pagos puede seguir permitiendo cobros para reactivar la póliza.
    """
    today = now or timezone.localdate()
    if period.status == BillingPeriod.Status.OVERDUE:
        return _expire_policy_if_applicable(policy)
    if period.status != BillingPeriod.Status.UNPAID:
        return False
    if period.due_date_hard and today > period.due_date_hard:
        period.status = BillingPeriod.Status.OVERDUE
        period.save(update_fields=["status", "updated_at"])
        _expire_policy_if_applicable(policy)
        return True
    return False


def auto_mark_overdue_periods(policy: Policy, *, period: Optional[BillingPeriod] = None, now: Optional[date] = None) -> None:
    today = now or timezone.localdate()
    current = period or get_or_create_current_period(policy, now=today)
    if not current:
        return
    mark_overdue_and_suspend_if_needed(policy, current, now=today)
