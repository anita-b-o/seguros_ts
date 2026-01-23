from django.core.exceptions import ValidationError
from django.db import models


class ContactInfo(models.Model):
    whatsapp = models.CharField("WhatsApp", max_length=50, blank=True, default="+54 9 221 000 0000")
    email = models.EmailField("Email", blank=True, default="hola@sancayetano.com")
    address = models.CharField(
        "Dirección",
        max_length=255,
        blank=True,
        default="Av. Ejemplo 1234, La Plata, Buenos Aires",
    )
    map_embed_url = models.TextField(
        "URL de iframe de mapa",
        blank=True,
        help_text="Pega aquí el iframe src de Google Maps para mostrar la ubicación.",
        default="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3283.798536911205!2d-58.381592984774424!3d-34.603738980460806!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMzTCsDM2JzEzLjQiUyA1OMKwMjInNTUuNyJX!5e0!3m2!1ses!2sar!4v1700000000000",
    )
    schedule = models.CharField("Horario de atención", max_length=120, blank=True, default="Lun a Vie 9:00 a 18:00")
    updated_at = models.DateTimeField(auto_now=True)
    singleton = models.BooleanField(default=True, editable=False, unique=True)

    class Meta:
        verbose_name = "Contacto"
        verbose_name_plural = "Contacto"

    def __str__(self):
        return "Información de contacto"

    def save(self, *args, **kwargs):
        self.singleton = True
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(singleton=True)
        return obj


class AppSettings(models.Model):
    # --- Otros settings existentes ---
    expiring_threshold_days = models.PositiveIntegerField(default=7)
    client_expiration_offset_days = models.PositiveIntegerField(default=2)
    default_term_months = models.PositiveIntegerField(default=3)

    # --- Cobro: ventana variable definida por admin ---
    payment_window_days = models.PositiveIntegerField(
        default=5,
        help_text="Cantidad de días que dura la ventana de pago desde el inicio del ciclo mensual.",
    )

    # ✅ NUEVO: vencimiento adelantado visible para el cliente (offset)
    payment_due_offset_days = models.PositiveIntegerField(
        default=0,
        help_text=(
            "Cantidad de días ANTES del último día de la ventana de pago que se muestra como 'vencimiento' al cliente. "
            "Debe ser menor que payment_window_days. Ej: window=10 y offset=3 => vencimiento visible = día 7."
        ),
    )

    # --- Ajuste de precio (ya existente) ---
    policy_adjustment_window_days = models.PositiveIntegerField(
        default=7,
        help_text="Cantidad de días antes del fin de la póliza en los que se considera el periodo de ajuste.",
    )

    # --- Campos legacy (se mantienen por compatibilidad/migraciones previas) ---
    # Si ya no los usás, se pueden eliminar en un refactor posterior con migraciones.
    payment_due_day_display = models.PositiveIntegerField(
        default=5,
        help_text="LEGACY: Día del mes comunicado al cliente como vencimiento (1-28/31).",
    )
    payment_due_day_real = models.PositiveIntegerField(
        default=7,
        help_text="LEGACY: Día del mes como corte real; debe ser >= display.",
    )

    updated_at = models.DateTimeField(auto_now=True)
    singleton = models.BooleanField(default=True, editable=False, unique=True)

    class Meta:
        verbose_name = "Ajustes de la app"
        verbose_name_plural = "Ajustes de la app"

    def __str__(self):
        return "Ajustes de pólizas"

    def save(self, *args, **kwargs):
        self.singleton = True
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(singleton=True)
        return obj

    def clean(self):
        super().clean()

        # Regla: offset < window (si window=10, offset puede ser 0..9)
        if self.payment_window_days is None or self.payment_window_days <= 0:
            raise ValidationError({"payment_window_days": "payment_window_days debe ser mayor a 0."})

        # CANÓNICO (UI actual + serializer)
        early = self.client_expiration_offset_days
        if early is not None and early >= self.payment_window_days:
            raise ValidationError(
                {
                    "client_expiration_offset_days": (
                        "El vencimiento visible (client_expiration_offset_days) debe ser menor que payment_window_days."
                    )
                }
            )

        # LEGACY (si alguien lo usa por error/compat)
        legacy = self.payment_due_offset_days
        if legacy is not None and legacy >= self.payment_window_days:
            raise ValidationError(
                {
                    "payment_due_offset_days": (
                        "payment_due_offset_days debe ser menor que payment_window_days."
                    )
                }
            )



class Announcement(models.Model):
    title = models.CharField(max_length=120)
    message = models.TextField(blank=True, default="")
    link = models.URLField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "-created_at"]
        verbose_name = "Anuncio"
        verbose_name_plural = "Anuncios"

    def __str__(self):
        return self.title
