from django.db import migrations, models


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0009_paymentwebhookevent"),
        ("policies", "0008_remove_policyinstallment_payment"),
    ]

    operations = [
        migrations.RunPython(
            noop,
            reverse_code=noop,
        ),
        migrations.RemoveConstraint(
            model_name="payment",
            name="uniq_payment_installment",
        ),
        migrations.AlterField(
            model_name="payment",
            name="installment",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=models.PROTECT,
                related_name="payment",
                to="policies.policyinstallment",
            ),
        ),
    ]
