from rest_framework import serializers
from .models import ContactInfo, AppSettings, Announcement


class ContactInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContactInfo
        fields = ("whatsapp", "email", "address", "map_embed_url", "schedule", "updated_at")


from rest_framework import serializers
from .models import AppSettings


class AppSettingsSerializer(serializers.ModelSerializer):
    """
    Preferencias globales del sistema.

    Alias expuestos por API:
    - payment_early_due_days -> client_expiration_offset_days (modelo)

    Reglas:
    - client_expiration_offset_days debe ser < payment_window_days
    """

    payment_early_due_days = serializers.IntegerField(
        source="client_expiration_offset_days",
        required=False,
        allow_null=True,
    )

    class Meta:
        model = AppSettings
        fields = (
            "expiring_threshold_days",
            "client_expiration_offset_days",
            "payment_early_due_days",
            "default_term_months",
            "payment_window_days",
            "policy_adjustment_window_days",
            # legacy (los dejo si hoy tu FE/BE aún los necesita en algún lado)
            "payment_due_day_display",
            "payment_due_day_real",
            "updated_at",
        )

    def validate(self, attrs):
        data = super().validate(attrs)

        window_days = data.get("payment_window_days", getattr(self.instance, "payment_window_days", None))
        early_days = data.get("client_expiration_offset_days", getattr(self.instance, "client_expiration_offset_days", None))

        if window_days is not None and early_days is not None:
            try:
                if int(early_days) >= int(window_days):
                    raise serializers.ValidationError(
                        {"payment_early_due_days": "Debe ser menor que payment_window_days."}
                    )
            except (TypeError, ValueError):
                pass

        # Validación de ajuste: debe ser >= 1 (si viene)
        adj = data.get("policy_adjustment_window_days", getattr(self.instance, "policy_adjustment_window_days", None))
        if adj is not None:
            try:
                if int(adj) < 1:
                    raise serializers.ValidationError(
                        {"policy_adjustment_window_days": "Debe ser >= 1."}
                    )
            except (TypeError, ValueError):
                pass

        return data


class AnnouncementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Announcement
        fields = ("id", "title", "message", "link", "is_active", "order", "created_at", "updated_at")
