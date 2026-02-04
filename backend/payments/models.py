# backend/payments/models.py
import uuid

from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone
from django.conf import settings

from policies.models import Policy


PERIOD_REGEX = r"^(19|20)\d{2}(0[1-9]|1[0-2])$"
period_validator = RegexValidator(
    regex=PERIOD_REGEX,
    message="El período debe tener el formato AAAAMM y representar un mes válido.",
)


class BillingPeriod(models.Model):
    class Status:
        UNPAID = "UNPAID"
        PAID = "PAID"
        OVERDUE = "OVERDUE"

        CHOICES = [
            (UNPAID, "No pagado"),
            (PAID, "Pagado"),
            (OVERDUE, "Vencido"),
        ]

    policy = models.ForeignKey(
        Policy,
        on_delete=models.CASCADE,
        related_name="billing_periods",
    )

    # Ventana del período y vencimientos
    period_start = models.DateField()
    period_end = models.DateField()
    due_date_soft = models.DateField()
    due_date_hard = models.DateField()

    # Monto del período (source-of-truth para Payment.amount)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default="ARS")

    status = models.CharField(
        max_length=10,
        choices=Status.CHOICES,
        default=Status.UNPAID,
        db_index=True,
    )

    # Snapshot de pricing (premium, tasas, etc.) para auditoría/consistencia
    pricing_snapshot = models.JSONField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [["policy", "period_start"]]
        ordering = ["policy_id", "period_start"]
        verbose_name = "Periodo de facturación"
        verbose_name_plural = "Periodos de facturación"

    def __str__(self):
        period_code = self.period_start.strftime("%Y%m")
        return f"{self.policy_id} - {period_code}"

    @property
    def period_code(self):
        return self.period_start.strftime("%Y%m")

    @property
    def is_unpaid(self):
        return self.status == self.Status.UNPAID

    def mark_paid(self):
        if self.status == self.Status.PAID:
            return False
        self.status = self.Status.PAID
        self.save(update_fields=["status", "updated_at"])
        return True


class BillingNotification(models.Model):
    class Type(models.TextChoices):
        PERIOD_START = "period_start", "Inicio de período de pago"
        SOFT_DUE_TOMORROW = "soft_due_tomorrow", "Mañana vence (adelantado)"
        SOFT_DUE_TODAY = "soft_due_today", "Último día de cobertura (adelantado)"
        NO_COVERAGE = "no_coverage", "Sin cobertura (día posterior adelantado)"
        HARD_DUE_TODAY = "hard_due_today", "Último día real"
        HARD_DUE_PASSED = "hard_due_passed", "Vencida (día posterior real)"

    billing_period = models.ForeignKey(
        BillingPeriod,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    notification_type = models.CharField(
        max_length=40,
        choices=Type.choices,
        db_index=True,
    )
    trigger_date = models.DateField(db_index=True)
    sent_to = models.EmailField(blank=True)
    subject = models.CharField(max_length=140)
    body = models.TextField(blank=True)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["billing_period", "notification_type", "trigger_date"],
                name="uniq_billing_notification_per_day",
            )
        ]
        ordering = ["-sent_at"]
        verbose_name = "Notificación de cobro"
        verbose_name_plural = "Notificaciones de cobro"


class Payment(models.Model):
    STATE = (
        ("PEN", "Pendiente"),
        ("APR", "Aprobado"),
        ("REJ", "Rechazado"),
    )

    policy = models.ForeignKey(Policy, on_delete=models.CASCADE, related_name="payments")

    billing_period = models.ForeignKey(
        BillingPeriod,
        on_delete=models.PROTECT,
        related_name="payments",
    )

    period = models.CharField(
        max_length=6,
        db_index=True,
        validators=[period_validator],
        help_text="Período AAAAMM (mes entre 01 y 12).",
    )

    amount = models.DecimalField(max_digits=10, decimal_places=2)

    state = models.CharField(max_length=3, choices=STATE, default="PEN")

    mp_preference_id = models.CharField(max_length=80, blank=True)
    mp_payment_id = models.CharField(max_length=80, blank=True)

    receipt_pdf = models.FileField(upload_to="receipts/", blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    last_state_change_at = models.DateTimeField(null=True, blank=True)
    last_state_change_reason = models.CharField(max_length=128, null=True, blank=True)

    def clean(self):
        # billing_period es obligatorio por diseño de flujo
        if not self.billing_period_id:
            raise ValidationError(
                {"billing_period": "Debe asociarse un periodo de facturación vigente."}
            )

        super().clean()

        # Consistencia policy <-> billing_period.policy
        if self.billing_period_id and self.policy_id and self.billing_period.policy_id != self.policy_id:
            raise ValidationError(
                {
                    "policy": "Debe coincidir con la póliza del periodo de facturación asociado al pago."
                }
            )

        # Si viene billing_period, fijamos policy automáticamente
        if self.billing_period_id:
            self.policy = self.billing_period.policy

    def save(self, *args, **kwargs):
        # Source-of-truth: BillingPeriod
        if self.billing_period_id:
            self.period = self.billing_period.period_code
            self.amount = self.billing_period.amount

        # Validación: dejamos pasar unique para evitar duplicados por carrera en save()
        self.full_clean(validate_unique=False)

        # Auditoría de cambios de estado
        state_changed = False
        if self.pk:
            prev_state = (
                self.__class__.objects.filter(pk=self.pk)
                .values_list("state", flat=True)
                .first()
            )
            if prev_state != self.state:
                state_changed = True
        else:
            state_changed = True

        if state_changed:
            self.last_state_change_at = timezone.now()

        save_kwargs = dict(kwargs)
        update_fields = save_kwargs.get("update_fields")

        # Si update_fields está limitado, aseguramos persistir last_state_change_at
        if state_changed and update_fields is not None:
            fields = set(update_fields)
            fields.add("last_state_change_at")
            save_kwargs["update_fields"] = fields

        return super().save(*args, **save_kwargs)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["billing_period"],
                condition=Q(state="APR"),
                name="uniq_billing_period_approved",
            )
        ]


class PaymentBatch(models.Model):
    STATE = (
        ("PEN", "Pendiente"),
        ("APR", "Aprobado"),
        ("REJ", "Rechazado"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="payment_batches",
    )

    payment_ids = models.JSONField(default=list, blank=True)
    policy_ids = models.JSONField(default=list, blank=True)

    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default="ARS")

    state = models.CharField(max_length=3, choices=STATE, default="PEN")

    mp_preference_id = models.CharField(max_length=80, blank=True)
    mp_payment_id = models.CharField(max_length=80, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Pago en conjunto"
        verbose_name_plural = "Pagos en conjunto"

    def __str__(self):
        return f"Lote {self.id}"


class Receipt(models.Model):
    policy = models.ForeignKey(Policy, on_delete=models.CASCADE, related_name="receipts")

    date = models.DateField(auto_now_add=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    concept = models.CharField(max_length=120, blank=True)
    method = models.CharField(max_length=30, blank=True)
    auth_code = models.CharField(max_length=80, blank=True)

    next_due = models.DateField(null=True, blank=True)

    # Legacy receipt fields preserve historical Charge data now that the Charge model has been removed.
    legacy_charge_id = models.IntegerField(
        null=True,
        blank=True,
        help_text="Legacy Charge PK preserved for audit after Charge removal. Charge no longer exists in runtime.",
    )
    legacy_charge_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Legacy Charge amount (if available) for historic receipts. Used for post-mortem reporting only.",
    )
    legacy_charge_due_date = models.DateField(
        null=True,
        blank=True,
        help_text="Legacy Charge due date (if available) for historic receipts. Not part of the billing flow.",
    )

    file = models.FileField(upload_to="receipts/", null=True, blank=True)

    class Meta:
        ordering = ["-date", "-id"]
        verbose_name = "Recibo"
        verbose_name_plural = "Recibos"

    def __str__(self):
        return f"Recibo {self.id} - {self.policy.number}"


class PaymentWebhookEvent(models.Model):
    PROVIDER_MERCADO_PAGO = "mercadopago"

    PROVIDER_CHOICES = [
        (PROVIDER_MERCADO_PAGO, "Mercado Pago"),
    ]

    provider = models.CharField(max_length=40, choices=PROVIDER_CHOICES)
    external_event_id = models.CharField(max_length=255)

    payment = models.ForeignKey(
        Payment,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="webhook_events",
    )

    received_at = models.DateTimeField(auto_now_add=True)
    raw_payload = models.JSONField(null=True, blank=True)

    class Meta:
        unique_together = [["provider", "external_event_id"]]
        ordering = ["-received_at"]
