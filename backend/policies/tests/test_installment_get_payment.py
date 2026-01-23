from datetime import date, timedelta

from django.test import TestCase

from policies.models import Policy
from products.models import Product
from policies.serializers import PolicySerializer


class BillingPeriodCurrentSerializerTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(
            code="GETPAY",
            name="GetPayment Plan",
            vehicle_type="AUTO",
            plan_type="RC",
            min_year=1990,
            max_year=2100,
            base_price=15000,
            coverages="",
        )
        self.policy = Policy.objects.create(
            number="GETPAY-1",
            product=self.product,
            premium=15000,
            start_date=date.today() - timedelta(days=5),
            end_date=date.today() + timedelta(days=60),
            status="active",
        )

    def test_serializer_returns_current_billing_period(self):
        data = PolicySerializer(self.policy).data
        billing_period = data.get("billing_period_current")
        self.assertIsNotNone(billing_period)
        self.assertEqual(billing_period["period"], date.today().strftime("%Y%m"))
