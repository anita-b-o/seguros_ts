from datetime import date, timedelta

from django.test import TestCase

from payments.billing import ensure_current_billing_period
from payments.models import BillingPeriod
from policies.models import Policy
from products.models import Product


class BillingPeriodUniquenessTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(
            code="SYNC-TEST",
            name="Sync Plan",
            vehicle_type="AUTO",
            plan_type="RC",
            min_year=1990,
            max_year=2100,
            base_price=14000,
            coverages="",
        )
        self.policy = Policy.objects.create(
            number="SYNC-1",
            product=self.product,
            premium=14000,
            start_date=date.today() - timedelta(days=5),
            end_date=date.today() + timedelta(days=90),
            status="active",
        )

    def test_current_period_is_unique(self):
        first = ensure_current_billing_period(self.policy)
        second = ensure_current_billing_period(self.policy)
        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertEqual(first.id, second.id)
        self.assertEqual(BillingPeriod.objects.filter(policy=self.policy).count(), 1)
