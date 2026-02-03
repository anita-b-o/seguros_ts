# backend/products/models.py
from django.db import models
from django.utils import timezone
from django.db.models.functions import Lower


def _normalize_code_value(value: str) -> str:
    cleaned = "".join(ch for ch in (value or "").upper() if ch.isalnum())
    return cleaned or ""


def _base_code_from_name(name: str) -> str:
    return _normalize_code_value(name) or "PRODUCT"


class Product(models.Model):
    VEHICLE_TYPES = (("AUTO", "Auto"), ("MOTO", "Moto"), ("COM", "Comercial"))
    PLAN_TYPES = (("RC", "Responsabilidad Civil"), ("TC", "Terceros Completo"), ("TR", "Todo Riesgo"))

    code = models.CharField(max_length=30, null=False, blank=False)
    name = models.CharField(max_length=120)
    subtitle = models.CharField(max_length=200, blank=True)

    # Lista de strings (lo consume el Home como "features")
    bullets = models.JSONField(default=list, blank=True)

    vehicle_type = models.CharField(max_length=5, choices=VEHICLE_TYPES, default="AUTO")
    plan_type = models.CharField(max_length=2, choices=PLAN_TYPES, default="TR")
    min_year = models.PositiveIntegerField(default=1995)
    max_year = models.PositiveIntegerField(default=2100)
    base_price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    franchise = models.CharField(max_length=80, blank=True)
    coverages = models.TextField(blank=True, help_text="Lista de coberturas en markdown")

    # Visible en Home
    published_home = models.BooleanField(default=True)
    # Activo/inactivo (si está inactivo no lo devolvemos públicamente)
    is_active = models.BooleanField(default=True)

    # Orden para el Home (menor primero)
    home_order = models.PositiveIntegerField(default=0)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(Lower("code"), name="uniq_product_code_lower")]

    @classmethod
    def normalize_code(cls, value: str) -> str:
        return _normalize_code_value(value)

    @classmethod
    def generate_unique_code(cls, base: str, *, exclude_pk=None) -> str:
        normalized = _normalize_code_value(base) or "PRODUCT"
        max_length = cls._meta.get_field("code").max_length
        candidate = normalized[:max_length]
        suffix = 0
        while True:
            conflict = cls.objects.filter(code__iexact=candidate)
            if exclude_pk is not None:
                conflict = conflict.exclude(pk=exclude_pk)
            if not conflict.exists():
                return candidate
            suffix += 1
            suffix_str = f"-{suffix}"
            trim_len = max(1, max_length - len(suffix_str))
            trimmed_base = normalized[:trim_len]
            candidate = f"{trimmed_base}{suffix_str}"

    def save(self, *args, **kwargs):
        if not self.code:
            base = _base_code_from_name(self.name)
            self.code = self.generate_unique_code(base)
        else:
            self.code = self.normalize_code(self.code)
        super().save(*args, **kwargs)

    def soft_delete(self, when=None):
        if self.is_deleted:
            return
        self.is_deleted = True
        self.deleted_at = when or timezone.now()
        self.save(update_fields=["is_deleted", "deleted_at"])

    def restore(self):
        if not self.is_deleted:
            return
        self.is_deleted = False
        self.deleted_at = None
        self.save(update_fields=["is_deleted", "deleted_at"])

    def __str__(self):
        return f"{self.name} ({self.get_plan_type_display()})"
