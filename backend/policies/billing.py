# backend/policies/billing.py
from __future__ import annotations

from collections import defaultdict, deque
from datetime import date, timedelta
from django.db import transaction
from django.utils import timezone
from decimal import Decimal
from typing import Iterable, List, Optional, Sequence

from audit.helpers import audit_log, snapshot_entity
from common.models import AppSettings
from .models import Policy, PolicyInstallment

ADMIN_MANAGED_STATUSES = {"cancelled", "suspended", "inactive"}
AUTO_MANAGED_STATUSES = {"active", "expired"}


def _add_months(start: date, months: int) -> date:
    """
    Sum month intervals keeping the day when possible. When the target month
    does not have that day (e.g., 31 -> February), fallback to the last day.
    """
    if months == 0:
        return start
    year = start.year + (start.month - 1 + months) // 12
    month = (start.month - 1 + months) % 12 + 1
    # Cap day to last day of target month
    from calendar import monthrange

    last_day = monthrange(year, month)[1]
    return date(year, month, min(start.day, last_day))


def ensure_policy_end_date(policy: Policy) -> bool:
    """
    Aplica la duración por defecto si la póliza ya tiene una fecha de inicio pero no una de fin.
    """
    if not policy.start_date or policy.end_date:
        return False
    settings_obj = AppSettings.get_solo()
    months = getattr(settings_obj, "default_term_months", 0) or 0
    if months <= 0:
        return False
    computed = _add_months(policy.start_date, months)
    if not computed:
        return False
    policy.end_date = computed
    policy.save(update_fields=["end_date", "updated_at"])
    return True

def _months_between(start: date, end: date) -> int:
    """
    Number of whole months between start (inclusive) and end (exclusive).
    Used to derive the amount of installments between start_date and end_date.
    """
    if end <= start:
        return 0
    months = 0
    cursor = start
    while cursor < end:
        months += 1
        cursor = _add_months(cursor, 1)
    return months


def compute_installment_status(installment: PolicyInstallment, today: Optional[date] = None) -> str:
    """
    Stateless status derivation following the requested rules:
    - If already paid, keep PAID.
    - If today <= due_date_display (vencimiento visible) -> PENDING
    - If due_date_display < today <= due_date_real -> NEAR_DUE (aún puede pagar)
    - If today > due_date_real -> EXPIRED
    """
    if installment.status == PolicyInstallment.Status.PAID:
        return installment.status
    today = today or date.today()
    display_due = installment.due_date_display
    real_due = installment.due_date_real
    if display_due and today <= display_due:
        return PolicyInstallment.Status.PENDING
    if real_due and today <= real_due:
        return PolicyInstallment.Status.NEAR_DUE
    return PolicyInstallment.Status.EXPIRED


def _cycle_dates_for_period(period_start: date, *, payment_window_days: int, display_offset_days: int):
    """
    Deriva las fechas del ciclo de pago basándose en el inicio y la ventana configurada.
    """
    window_days = max(1, payment_window_days)
    display_offset = max(0, display_offset_days)

    payment_window_start = period_start
    period_end = _add_months(period_start, 1) - timedelta(days=1)
    due_real = payment_window_start + timedelta(days=window_days - 1)
    if due_real > period_end:
        due_real = period_end
    payment_window_end = due_real
    due_display = due_real - timedelta(days=display_offset)
    if due_display < payment_window_start:
        due_display = payment_window_start

    return {
        "period_end": period_end,
        "payment_window_start": payment_window_start,
        "payment_window_end": payment_window_end,
        "due_display": due_display,
        "due_real": due_real,
    }


def _build_installments(
    policy: Policy,
    months_duration: int,
    monthly_amount: Decimal,
    payment_window_days: int,
    display_offset_days: int,
) -> List[PolicyInstallment]:
    if months_duration <= 0 or not policy.start_date:
        return []
    installments: List[PolicyInstallment] = []
    start = policy.start_date
    window_days = max(1, payment_window_days)
    display_offset = max(0, display_offset_days)
    for idx in range(months_duration):
        period_start = _add_months(start, idx)
        cycle = _cycle_dates_for_period(
            period_start,
            payment_window_days=window_days,
            display_offset_days=display_offset,
        )

        installments.append(
            PolicyInstallment(
                policy=policy,
                sequence=idx + 1,
                period_start_date=period_start,
                period_end_date=cycle["period_end"],
                payment_window_start=cycle["payment_window_start"],
                payment_window_end=cycle["payment_window_end"],
                due_date_display=cycle["due_display"],
                due_date_real=cycle["due_real"],
                amount=monthly_amount,
                status=PolicyInstallment.Status.PENDING,
            )
        )
    return installments


def months_duration_for_policy(policy: Policy) -> int:
    """
    Derives months of coverage. Prefers explicit end_date/start_date; falls back
    to app default term if the end_date is missing.
    """
    settings_obj = AppSettings.get_solo()
    if policy.start_date and policy.end_date:
        return max(1, _months_between(policy.start_date, policy.end_date))
    return getattr(settings_obj, "default_term_months", 3) or 3


def _is_installment_paid(installment: PolicyInstallment) -> bool:
    return bool(
        installment.paid_at
        or installment.status == PolicyInstallment.Status.PAID
    )


def sync_installments_preserving_paid(
    policy: Policy,
    *,
    months_duration: Optional[int] = None,
    monthly_amount: Optional[Decimal] = None,
) -> Sequence[PolicyInstallment]:
    """
    Aligns the policy's installments with the expected plan while keeping any
    already paid installments untouched, and updating unpaid ones. Paid stray
    installments are renumbered out of the way before inserts occur to avoid
    UNIQUE constraint failures.
    """
    settings_obj = AppSettings.get_solo()
    if not policy.start_date:
        return policy.installments.all()

    months = months_duration if months_duration is not None else months_duration_for_policy(policy)
    if months <= 0:
        months = 0
    amount = monthly_amount if monthly_amount is not None else (policy.premium or Decimal("0"))

    window_days = max(1, getattr(settings_obj, "payment_window_days", 5) or 5)
    display_offset = max(0, getattr(settings_obj, "client_expiration_offset_days", 0) or 0)

    expected_periods: dict[date, dict] = {}
    for idx in range(months):
        period_start = _add_months(policy.start_date, idx)
        cycle = _cycle_dates_for_period(
            period_start,
            payment_window_days=window_days,
            display_offset_days=display_offset,
        )
        expected_periods[period_start] = {
            "sequence": idx + 1,
            "period_start": period_start,
            "cycle": cycle,
        }

    with transaction.atomic():
        existing = list(policy.installments.all())
        desired_sequences = set(range(1, months + 1))
        sequence_usage: dict[int, int] = {}
        max_sequence = 0
        for inst in existing:
            seq = inst.sequence or 0
            sequence_usage[seq] = sequence_usage.get(seq, 0) + 1
            if seq > max_sequence:
                max_sequence = seq

        next_sequence = max_sequence + 1
        paid_strays = [
            inst
            for inst in existing
            if _is_installment_paid(inst)
            and (
                (inst.period_start_date not in expected_periods)
                or not inst.period_start_date
            )
        ]
        for inst in paid_strays:
            seq = inst.sequence or 0
            duplicate = sequence_usage.get(seq, 0) > 1
            needs_resequence = seq in desired_sequences or duplicate
            if needs_resequence:
                sequence_usage[seq] = max(0, sequence_usage.get(seq, 1) - 1)
                inst.sequence = next_sequence
                sequence_usage[next_sequence] = sequence_usage.get(next_sequence, 0) + 1
                next_sequence += 1
                inst.save(update_fields=["sequence", "updated_at"])

        period_map = {inst.period_start_date: inst for inst in existing if inst.period_start_date}
        repurpose_candidates: dict[int, deque[PolicyInstallment]] = defaultdict(deque)
        for inst in existing:
            if _is_installment_paid(inst):
                continue
            if inst.period_start_date in expected_periods:
                continue
            seq_key = inst.sequence or 0
            repurpose_candidates[seq_key].append(inst)

        update_fields = [
            "sequence",
            "period_start_date",
            "period_end_date",
            "payment_window_start",
            "payment_window_end",
            "due_date_display",
            "due_date_real",
            "amount",
            "status",
        ]

        for period_start, data in expected_periods.items():
            sequence = data["sequence"]
            cycle = data["cycle"]
            inst = period_map.get(period_start)
            if inst:
                if _is_installment_paid(inst):
                    continue
                inst.sequence = sequence
                inst.period_end_date = cycle["period_end"]
                inst.payment_window_start = cycle["payment_window_start"]
                inst.payment_window_end = cycle["payment_window_end"]
                inst.due_date_display = cycle["due_display"]
                inst.due_date_real = cycle["due_real"]
                inst.amount = amount
                inst.status = compute_installment_status(inst)
                inst.save(update_fields=[*update_fields, "updated_at"])
            else:
                candidate_list = repurpose_candidates.get(sequence)
                if candidate_list:
                    candidate = candidate_list.popleft()
                    candidate.sequence = sequence
                    candidate.period_start_date = period_start
                    candidate.period_end_date = cycle["period_end"]
                    candidate.payment_window_start = cycle["payment_window_start"]
                    candidate.payment_window_end = cycle["payment_window_end"]
                    candidate.due_date_display = cycle["due_display"]
                    candidate.due_date_real = cycle["due_real"]
                    candidate.amount = amount
                    candidate.status = compute_installment_status(candidate)
                    candidate.save(update_fields=[*update_fields, "updated_at"])
                    continue
                inst = PolicyInstallment(
                    policy=policy,
                    sequence=sequence,
                    period_start_date=period_start,
                    period_end_date=cycle["period_end"],
                    payment_window_start=cycle["payment_window_start"],
                    payment_window_end=cycle["payment_window_end"],
                    due_date_display=cycle["due_display"],
                    due_date_real=cycle["due_real"],
                    amount=amount,
                    status=PolicyInstallment.Status.PENDING,
                )
                inst.status = compute_installment_status(inst)
                inst.save()

        expected_starts = set(expected_periods.keys())
        existing_after = list(policy.installments.all())
        to_remove = [
            inst.id
            for inst in existing_after
            if inst.period_start_date not in expected_starts and not _is_installment_paid(inst)
        ]
        if to_remove:
            PolicyInstallment.objects.filter(id__in=to_remove).delete()

    return policy.installments.all()


def regenerate_installments(
    policy: Policy,
    *,
    months_duration: Optional[int] = None,
    monthly_amount: Optional[Decimal] = None,
) -> Sequence[PolicyInstallment]:
    """
    Idempotently recreates the installments of a policy. Uses a syncing helper that
    preserves paid installments while refreshing the unpaid ones.
    """
    months = months_duration if months_duration is not None else months_duration_for_policy(policy)
    amount = monthly_amount if monthly_amount is not None else (policy.premium or Decimal("0"))
    return sync_installments_preserving_paid(
        policy,
        months_duration=months,
        monthly_amount=amount,
    )


def current_payment_cycle(
    policy: Policy,
    settings_obj: AppSettings,
    *,
    today: Optional[date] = None,
) -> Optional[dict]:
    """
    Devuelve las fechas de la cuota vigente (o la última conocida) siguiendo
    las preferencias configurables.
    """
    if not policy.start_date:
        return None
    today = today or date.today()
    months_to_generate = max(months_duration_for_policy(policy), 1)
    window_days = max(1, getattr(settings_obj, "payment_window_days", 5) or 5)
    display_offset = max(0, getattr(settings_obj, "client_expiration_offset_days", 0) or 0)

    cycle: Optional[dict] = None
    for idx in range(months_to_generate):
        period_start = _add_months(policy.start_date, idx)
        cycle = {
            "period_start": period_start,
            **_cycle_dates_for_period(
                period_start,
                payment_window_days=window_days,
                display_offset_days=display_offset,
            ),
        }
        if cycle["due_real"] >= today:
            break
    return cycle


def next_price_update_window(
    policy: Policy,
    settings_obj: AppSettings,
    *,
    today: Optional[date] = None,
) -> tuple[Optional[date], Optional[date]]:
    """
    Devuelve el período de ajuste calculado en base al fin de la póliza y la ventana configurada.
    """
    _ = today  # mantenemos la firma compatiblemente aunque no la usamos aquí
    end_date = getattr(policy, "end_date", None)
    if not end_date:
        return None, None

    adjustment_days = max(0, getattr(settings_obj, "policy_adjustment_window_days", 0) or 0)
    if adjustment_days < 0:  # seguridad extra
        adjustment_days = 0

    adjustment_end = end_date - timedelta(days=1)
    adjustment_start = adjustment_end - timedelta(days=adjustment_days)
    return adjustment_start, adjustment_end


def mark_cycle_installment_paid(
    policy: Policy,
    payment=None,
    *,
    today: Optional[date] = None,
) -> Optional[PolicyInstallment]:
    """
    Marca la cuota correspondiente al ciclo vigente como pagada.
    """
    today = today or date.today()
    settings_obj = AppSettings.get_solo()
    cycle = current_payment_cycle(policy, settings_obj, today=today) or {}
    period_start = cycle.get("period_start")
    qs = policy.installments.all()
    target = None
    if period_start:
        target = qs.filter(period_start_date=period_start).order_by("sequence").first()
    if not target:
        target = qs.filter(status__in=[PolicyInstallment.Status.PENDING, PolicyInstallment.Status.NEAR_DUE]).order_by("sequence").first()
    if not target:
        target = qs.filter(status=PolicyInstallment.Status.EXPIRED).order_by("sequence").first()
    if not target:
        return None
    if payment and getattr(payment, "billing_period", None):
        target_start = target.period_start_date
        payment_start = getattr(payment.billing_period, "period_start", None)
        if payment_start and target_start and payment_start != target_start:
            raise ValueError("El pago no coincide con el ciclo de esta cuota.")
    target.mark_paid(when=timezone.now())
    installments = list(policy.installments.all())
    update_policy_status_from_installments(policy, installments, persist=True)
    return target


def refresh_installment_statuses(installments: Iterable[PolicyInstallment], *, persist: bool = False) -> None:
    """
    Updates the `status` field in memory (and optionally in DB) using
    compute_installment_status. This keeps the API aligned without needing a
    cron job right away.
    """
    to_update: List[PolicyInstallment] = []
    today = date.today()
    for inst in installments:
        new_status = compute_installment_status(inst, today=today)
        if inst.status != new_status:
            inst.status = new_status
            if persist:
                to_update.append(inst)
    if persist and to_update:
        PolicyInstallment.objects.bulk_update(to_update, ["status", "updated_at"])


def derive_policy_billing_status(installments: Iterable[PolicyInstallment]) -> str:
    """
    Collapse installment statuses into a single billing status for quick UI
    grouping.
    """
    has_expired = False
    has_near_due = False
    for inst in installments:
        status = inst.status
        if status == PolicyInstallment.Status.EXPIRED:
            has_expired = True
            break
        if status == PolicyInstallment.Status.NEAR_DUE:
            has_near_due = True
    if has_expired:
        return "expired"
    if has_near_due:
        return "near_due"
    return "on_track"


def update_policy_status_from_installments(
    policy: Policy,
    installments: Iterable[PolicyInstallment],
    *,
    persist: bool = False,
) -> str:
    """
    Auto-manages only the `AUTO_MANAGED_STATUSES` (currently "active" and
    "expired") based on installment state, while leaving
    `ADMIN_MANAGED_STATUSES` untouched (these require manual intervention).

    - ADMIN_MANAGED_STATUSES = {"cancelled", "suspended", "inactive"}
    - AUTO_MANAGED_STATUSES = {"active", "expired"}

    If any installment is expired, the policy moves to "expired".
    Otherwise it stays or becomes "active". The function is idempotent and
    never mutates admin-managed statuses.
    """
    current = getattr(policy, "status", "active") or "active"
    if current in ADMIN_MANAGED_STATUSES:
        # Administrative decisions take precedence; do not override them.
        return current

    billing_status = derive_policy_billing_status(installments)
    new_status = "expired" if billing_status == "expired" else "active"

    if persist and new_status != current:
        before_snapshot = snapshot_entity(policy)
        policy.status = new_status
        policy.save(update_fields=["status", "updated_at"])
        audit_log(
            action="policy_status_auto_update",
            entity_type="Policy",
            entity_id=str(policy.pk),
            before=before_snapshot,
            after=snapshot_entity(policy),
            extra={"billing_status": billing_status},
        )
    return new_status
