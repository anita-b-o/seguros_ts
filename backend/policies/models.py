# backend/policies/models.py
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from accounts.models import User
from products.models import Product


def _add_months(start_date: date, months: int) -> date | None:
    """
    Suma meses conservando el día cuando es posible; si el mes de destino
    no tiene ese día (p. ej., 31 a febrero), se usa el último día del mes.
    """
    if not start_date:
        return None
    if not months:
        return start_date
    year = start_date.year + (start_date.month - 1 + months) // 12
    month = (start_date.month - 1 + months) % 12 + 1
    day = start_date.day
    last_day = monthrange(year, month)[1]
    return date(year, month, min(day, last_day))


class Policy(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Activa"
        NO_COVERAGE = "no_coverage", "Sin cobertura"
        EXPIRED = "expired", "Vencida"
        SUSPENDED = "suspended", "Suspendida"
        CANCELLED = "cancelled", "Cancelada"
        INACTIVE = "inactive", "Inactiva"

    STATUS = Status.choices
    BILLING_STATUS_MAP = {
        Status.ACTIVE: Status.ACTIVE,
        Status.SUSPENDED: Status.SUSPENDED,
        Status.CANCELLED: Status.CANCELLED,
        Status.NO_COVERAGE: Status.CANCELLED,
        Status.EXPIRED: Status.CANCELLED,
        Status.INACTIVE: Status.CANCELLED,
    }

    number = models.CharField(max_length=30, unique=True)
    user = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="policies",
        verbose_name="Titular",
    )
    product = models.ForeignKey(
        Product,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="policies",
    )
    premium = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS, default=Status.ACTIVE)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    claim_code = models.CharField(max_length=20, null=True, blank=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    vehicle = models.ForeignKey(
        "vehicles.Vehicle",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="policies",
    )

    # ✅ Soft delete (para “Pólizas eliminadas” + recuperar)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Póliza"
        verbose_name_plural = "Pólizas"

    def __str__(self):
        vehicle_plate = getattr(getattr(self, "contract_vehicle", None), "plate", "")
        return f"{self.number} - {vehicle_plate}".strip(" -")

    @property
    def billing_status(self):
        return self.BILLING_STATUS_MAP.get(self.status, self.Status.CANCELLED)

    @property
    def is_active(self):
        return self.billing_status == self.Status.ACTIVE

    @property
    def is_suspended(self):
        return self.billing_status == self.Status.SUSPENDED

    @property
    def is_cancelled(self):
        return self.billing_status == self.Status.CANCELLED

    @property
    def contract_vehicle(self):
        """
        Snapshot contractual del vehículo; no depende de vehicles.Vehicle.
        """
        return getattr(self, "legacy_vehicle", None)

    def clean(self):
        super().clean()
        if self.vehicle_id and self.user_id:
            if self.vehicle.owner_id != self.user_id:
                raise ValidationError(
                    {"vehicle": "El vehículo debe pertenecer al titular de la póliza."}
                )

    # ----------------------------
    # Soft delete helpers
    # ----------------------------
    def soft_delete(self, when=None):
        if self.is_deleted:
            return
        self.is_deleted = True
        self.deleted_at = when or timezone.now()
        self.save(update_fields=["is_deleted", "deleted_at", "updated_at"])

    def restore(self):
        if not self.is_deleted:
            return
        self.is_deleted = False
        self.deleted_at = None
        self.save(update_fields=["is_deleted", "deleted_at", "updated_at"])

    # ----------------------------
    # Payment cycle (sin BillingPeriod)
    # ----------------------------
    def payment_cycle_dates(self, *, settings_obj=None, today: date | None = None):
        """
        Calcula SIEMPRE el ciclo del período de pago, aun si no existe BillingPeriod.

        Regla (Opción A): el ciclo mensual ancla en el día start_date (ej: 15 -> cada mes 15).
        - payment_window_days: duración del período de pago (admin).
        - payment_early_due_days: vencimiento adelantado (admin), días antes del último día.

        Ejemplo:
        - window_days=10
        - early_due_days=3
        - ciclo: 1..10
        - vencimiento adelantado: 7
        - vencimiento real: 10

        Retorna:
          {
            "cycle_start": date,
            "cycle_end": date,          # último día real del período de pago (hard)
            "early_due": date,          # vencimiento adelantado (display)
            "window_days": int,
            "early_due_days": int
          }
        """
        if not self.start_date:
            return None

        today = today or timezone.localdate()

        window_days = 0
        early_due_days = 0

        if settings_obj:
            window_days = int(getattr(settings_obj, "payment_window_days", 0) or 0)
            early_due_days = int(getattr(settings_obj, "payment_early_due_days", 0) or 0)

        # Fallback de emergencia para no romper UI si falta settings/campo
        if window_days <= 0:
            window_days = 10

        # early_due_days debe ser [0 .. window_days-1]
        if early_due_days < 0:
            early_due_days = 0
        if early_due_days >= window_days:
            early_due_days = max(0, window_days - 1)

        start = self.start_date

        # Meses entre start y today (aprox por año/mes)
        months = (today.year - start.year) * 12 + (today.month - start.month)
        candidate = _add_months(start, months)

        # Si today todavía no llegó al “día ancla” de este mes => usar mes anterior
        if candidate and today < candidate:
            candidate = _add_months(start, months - 1)

        cycle_start = candidate or start
        cycle_end = cycle_start + timedelta(days=window_days - 1)
        early_due = cycle_end - timedelta(days=early_due_days) if early_due_days > 0 else cycle_end

        return {
            "cycle_start": cycle_start,
            "cycle_end": cycle_end,
            "early_due": early_due,
            "window_days": window_days,
            "early_due_days": early_due_days,
        }


class PolicyVehicle(models.Model):
    policy = models.OneToOneField(Policy, on_delete=models.CASCADE, related_name="legacy_vehicle")
    plate = models.CharField("Patente", max_length=10, db_index=True)
    make = models.CharField("Marca", max_length=80)
    model = models.CharField("Modelo", max_length=80)
    version = models.CharField("Versión", max_length=80, blank=True)
    year = models.PositiveIntegerField("Año")
    city = models.CharField("Ciudad", max_length=80, blank=True)
    has_garage = models.BooleanField(default=False)
    is_zero_km = models.BooleanField(default=False)
    usage = models.CharField(max_length=30, default="privado")
    has_gnc = models.BooleanField(default=False)
    gnc_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    class Meta:
        verbose_name = "Vehículo de póliza"
        verbose_name_plural = "Vehículos de póliza"

    def __str__(self):
        return f"{self.plate.upper()} - {self.make} {self.model} ({self.year})"


class PolicyInstallment(models.Model):
    class Status:
        PENDING = "pending"
        NEAR_DUE = "near_due"
        PAID = "paid"
        EXPIRED = "expired"

        CHOICES = [
            (PENDING, "Pendiente"),
            (NEAR_DUE, "Próximo a vencer"),
            (PAID, "Pagado"),
            (EXPIRED, "Vencido"),
        ]

    policy = models.ForeignKey(
        Policy,
        on_delete=models.CASCADE,
        related_name="installments",
    )
    sequence = models.PositiveIntegerField(help_text="Número de cuota dentro de la vigencia (1..N)")
    period_start_date = models.DateField()
    period_end_date = models.DateField(null=True, blank=True)
    payment_window_start = models.DateField()
    payment_window_end = models.DateField()
    due_date_display = models.DateField()
    due_date_real = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=12, choices=Status.CHOICES, default=Status.PENDING)
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["policy_id", "sequence"]
        unique_together = ["policy", "sequence"]
        verbose_name = "Cuota de póliza"
        verbose_name_plural = "Cuotas de póliza"

    def mark_paid(self, when=None):
        self.status = self.Status.PAID
        self.paid_at = when or timezone.now()
        self.save(update_fields=["status", "paid_at", "updated_at"])
