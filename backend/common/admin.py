from django import forms
from django.contrib import admin
from django.http import HttpResponseRedirect
from django.urls import reverse

from .models import ContactInfo, AppSettings, Announcement


@admin.register(ContactInfo)
class ContactInfoAdmin(admin.ModelAdmin):
    list_display = ("whatsapp", "email", "address", "schedule", "updated_at")

    def has_add_permission(self, request):
        # Limit to single instance
        return not ContactInfo.objects.exists()

    def add_view(self, request, form_url="", extra_context=None):
        if ContactInfo.objects.exists():
            obj = ContactInfo.get_solo()
            url = reverse("admin:common_contactinfo_change", args=(obj.pk,))
            return HttpResponseRedirect(url)
        return super().add_view(request, form_url, extra_context)


class AppSettingsForm(forms.ModelForm):
    class Meta:
        model = AppSettings
        fields = [
            # ✅ Ventana de pago (duración variable definida por admin)
            "payment_window_days",
            # ✅ Vencimiento adelantado (días antes del fin de la ventana)
            #    Este campo reemplaza el viejo payment_due_day_display
            "payment_due_offset_days",
            # ✅ Duración del plan
            "default_term_months",
            # ✅ Ventana de ajuste (días antes del fin de la póliza)
            "policy_adjustment_window_days",
        ]
        labels = {
            "payment_window_days": "Duración de la ventana de pago (días)",
            "payment_due_offset_days": "Vencimiento adelantado visible (días antes del fin)",
            "default_term_months": "Duración del plan (meses)",
            "policy_adjustment_window_days": "Período de ajuste antes del fin (días)",
        }
        help_texts = {
            "payment_window_days": (
                "Cantidad de días que dura la ventana de pago desde el inicio del período mensual. "
                "Ej.: si la póliza inicia 15/01 y la ventana es 10 días, el período visible es 15→25."
            ),
            "payment_due_offset_days": (
                "Cuántos días ANTES del último día de la ventana de pago se muestra el vencimiento al cliente. "
                "Debe ser menor que payment_window_days. "
                "Ej.: ventana=10 y offset=3 => el cliente ve vencimiento el día 7, pero el real es el día 10."
            ),
            "default_term_months": "Cantidad de meses que se generan por defecto para la vigencia del contrato.",
            "policy_adjustment_window_days": (
                "Cantidad de días previos al fin de la póliza que definen la ventana de ajuste."
            ),
        }


@admin.register(AppSettings)
class AppSettingsAdmin(admin.ModelAdmin):
    list_display = (
        "payment_window_days",
        "payment_due_offset_days",
        "default_term_months",
        "policy_adjustment_window_days",
        "updated_at",
    )
    readonly_fields = ("updated_at",)
    form = AppSettingsForm
    fieldsets = (
        (
            "Calendario de cobro",
            {
                "fields": (
                    "payment_window_days",
                    "payment_due_offset_days",
                    "default_term_months",
                    "policy_adjustment_window_days",
                ),
            },
        ),
        ("Auditoría", {"fields": ("updated_at",)}),
    )

    def has_add_permission(self, request):
        return not AppSettings.objects.exists()

    def add_view(self, request, form_url="", extra_context=None):
        if AppSettings.objects.exists():
            obj = AppSettings.get_solo()
            url = reverse("admin:common_appsettings_change", args=(obj.pk,))
            return HttpResponseRedirect(url)
        return super().add_view(request, form_url, extra_context)


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ("title", "is_active", "order", "created_at", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("title", "message")
