from django.db import migrations


def _period_from_installment(installment):
    d = getattr(installment, "period_start_date", None)
    if not d:
        return None
    return d.strftime("%Y%m")


def sync_payment_installment_pi(apps, schema_editor):
    Payment = apps.get_model("payments", "Payment")
    for payment in Payment.objects.select_related("installment").exclude(installment_id__isnull=True):
        installment = getattr(payment, "installment", None)
        if not installment:
            continue
        expected_period = _period_from_installment(installment)
        expected_amount = installment.amount
        updates = []
        if expected_period and payment.period != expected_period:
            payment.period = expected_period
            updates.append("period")
        if expected_amount is not None and payment.amount != expected_amount:
            payment.amount = expected_amount
            updates.append("amount")
        if updates:
            payment.save(update_fields=updates)


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0010_alter_payment_installment"),
    ]

    operations = [
        migrations.RunPython(sync_payment_installment_pi, reverse_code=migrations.RunPython.noop),
    ]
