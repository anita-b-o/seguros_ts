from datetime import date, timedelta

from django.test import TestCase

from payments.models import BillingPeriod
from policies.models import Policy
from policies.serializers import PolicySerializer
from products.models import Product


class BillingPeriodCacheTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(
            code="CACHE-TEST",
            name="Cache Test Plan",
            vehicle_type="AUTO",
            plan_type="RC",
            min_year=1990,
            max_year=2100,
            base_price=14000,
            coverages="",
        )
        self.policy = Policy.objects.create(
            number="CACHE-1",
            product=self.product,
            premium=14000,
            start_date=date.today() - timedelta(days=1),
            end_date=date.today() + timedelta(days=90),
            status="active",
        )

    def test_serializer_does_not_create_duplicate_periods(self):
        PolicySerializer(self.policy).data
        PolicySerializer(self.policy).data
        self.assertEqual(BillingPeriod.objects.filter(policy=self.policy).count(), 1)
