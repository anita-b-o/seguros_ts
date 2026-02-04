from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("payments", "0002_paymentbatch"),
    ]

    operations = [
        migrations.CreateModel(
            name="BillingNotification",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "notification_type",
                    models.CharField(
                        choices=[
                            ("period_start", "Inicio de período de pago"),
                            ("soft_due_tomorrow", "Mañana vence (adelantado)"),
                            ("soft_due_today", "Último día de cobertura (adelantado)"),
                            ("no_coverage", "Sin cobertura (día posterior adelantado)"),
                            ("hard_due_today", "Último día real"),
                            ("hard_due_passed", "Vencida (día posterior real)"),
                        ],
                        db_index=True,
                        max_length=40,
                    ),
                ),
                ("trigger_date", models.DateField(db_index=True)),
                ("sent_to", models.EmailField(blank=True, max_length=254)),
                ("subject", models.CharField(max_length=140)),
                ("body", models.TextField(blank=True)),
                ("sent_at", models.DateTimeField(auto_now_add=True)),
                (
                    "billing_period",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="notifications",
                        to="payments.billingperiod",
                    ),
                ),
            ],
            options={
                "verbose_name": "Notificación de cobro",
                "verbose_name_plural": "Notificaciones de cobro",
                "ordering": ["-sent_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="billingnotification",
            constraint=models.UniqueConstraint(
                fields=("billing_period", "notification_type", "trigger_date"),
                name="uniq_billing_notification_per_day",
            ),
        ),
    ]
