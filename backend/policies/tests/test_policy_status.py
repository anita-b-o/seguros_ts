from datetime import date, timedelta

from django.test import TestCase

from payments.models import BillingPeriod
from policies.models import Policy
from policies.serializers import PolicySerializer
from products.models import Product


class PolicyBillingStatusTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(
            code="STATUS-TEST",
            name="Status Plan",
            vehicle_type="AUTO",
            plan_type="RC",
            min_year=1990,
            max_year=2100,
            base_price=14000,
            coverages="",
        )
        self.policy = Policy.objects.create(
            number="STATUS-1",
            product=self.product,
            premium=14000,
            start_date=date.today() - timedelta(days=5),
            end_date=date.today() + timedelta(days=90),
            status="active",
        )

    def _set_current_period_status(self, status):
        BillingPeriod.objects.filter(policy=self.policy).delete()
        BillingPeriod.objects.create(
            policy=self.policy,
            period_start=date.today().replace(day=1),
            period_end=date.today(),
            due_date_soft=date.today(),
            due_date_hard=date.today(),
            amount=14000,
            currency="ARS",
            status=status,
        )

    def test_billing_status_uses_current_period(self):
        self._set_current_period_status(BillingPeriod.Status.UNPAID)
        data = PolicySerializer(self.policy).data
        self.assertEqual(data["billing_status"], BillingPeriod.Status.UNPAID)

        self._set_current_period_status(BillingPeriod.Status.OVERDUE)
        data = PolicySerializer(self.policy).data
        self.assertEqual(data["billing_status"], BillingPeriod.Status.OVERDUE)

        self._set_current_period_status(BillingPeriod.Status.PAID)
        data = PolicySerializer(self.policy).data
        self.assertEqual(data["billing_status"], BillingPeriod.Status.PAID)
