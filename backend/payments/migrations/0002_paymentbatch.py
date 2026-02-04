from django.conf import settings
from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="PaymentBatch",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("payment_ids", models.JSONField(blank=True, default=list)),
                ("policy_ids", models.JSONField(blank=True, default=list)),
                ("total_amount", models.DecimalField(decimal_places=2, max_digits=12)),
                ("currency", models.CharField(default="ARS", max_length=3)),
                ("state", models.CharField(choices=[("PEN", "Pendiente"), ("APR", "Aprobado"), ("REJ", "Rechazado")], default="PEN", max_length=3)),
                ("mp_preference_id", models.CharField(blank=True, max_length=80)),
                ("mp_payment_id", models.CharField(blank=True, max_length=80)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="payment_batches", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "Pago en conjunto",
                "verbose_name_plural": "Pagos en conjunto",
                "ordering": ["-created_at"],
            },
        ),
    ]
