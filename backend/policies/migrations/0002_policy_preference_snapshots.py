from django.db import migrations, models


def backfill_policy_preference_snapshots(apps, schema_editor):
    Policy = apps.get_model("policies", "Policy")
    AppSettings = apps.get_model("common", "AppSettings")

    settings_obj = AppSettings.objects.filter(singleton=True).first() or AppSettings.objects.first()
    default_term = max(1, int(getattr(settings_obj, "default_term_months", 3) or 3))
    payment_window = max(1, int(getattr(settings_obj, "payment_window_days", 5) or 5))
    client_offset = max(
        0, int(getattr(settings_obj, "client_expiration_offset_days", 0) or 0)
    )
    adjustment_window = max(
        0, int(getattr(settings_obj, "policy_adjustment_window_days", 0) or 0)
    )

    Policy.objects.filter(default_term_months_snapshot__isnull=True).update(
        default_term_months_snapshot=default_term
    )
    Policy.objects.filter(payment_window_days_snapshot__isnull=True).update(
        payment_window_days_snapshot=payment_window
    )
    Policy.objects.filter(client_expiration_offset_days_snapshot__isnull=True).update(
        client_expiration_offset_days_snapshot=client_offset
    )
    Policy.objects.filter(policy_adjustment_window_days_snapshot__isnull=True).update(
        policy_adjustment_window_days_snapshot=adjustment_window
    )


class Migration(migrations.Migration):
    dependencies = [
        ("common", "0001_initial"),
        ("policies", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="policy",
            name="client_expiration_offset_days_snapshot",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="policy",
            name="default_term_months_snapshot",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="policy",
            name="payment_window_days_snapshot",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="policy",
            name="policy_adjustment_window_days_snapshot",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.RunPython(
            backfill_policy_preference_snapshots,
            migrations.RunPython.noop,
        ),
    ]
