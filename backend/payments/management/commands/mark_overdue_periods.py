from django.core.management.base import BaseCommand
from django.utils import timezone

from payments.billing import mark_overdue_and_suspend_if_needed
from payments.models import BillingPeriod


class Command(BaseCommand):
    help = "Marca periodos de facturación vencidos y suspende automáticamente las pólizas."

    def handle(self, *args, **options):
        today = timezone.localdate()
        periods = BillingPeriod.objects.select_related("policy").filter(
            status=BillingPeriod.Status.UNPAID,
            due_date_hard__lt=today,
        )
        marked = 0
        for period in periods:
            if mark_overdue_and_suspend_if_needed(period.policy, period, now=today):
                marked += 1
        self.stdout.write(self.style.SUCCESS(f"Periodos marcados como vencidos: {marked}"))
