from datetime import date, timedelta

from django.test import TestCase

from payments.billing import mark_overdue_and_suspend_if_needed
from payments.models import BillingPeriod
from policies.models import Policy
from products.models import Product


class BillingPeriodOverduePolicyStatusTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(
            code="OVERDUE-TEST",
            name="Overdue Plan",
            vehicle_type="AUTO",
            plan_type="RC",
            min_year=1990,
            max_year=2100,
            base_price=14000,
            coverages="",
        )
        self.policy = Policy.objects.create(
            number="OVERDUE-1",
            product=self.product,
            premium=14000,
            start_date=date.today() - timedelta(days=40),
            end_date=date.today() + timedelta(days=90),
            status="active",
        )
        self.period = BillingPeriod.objects.create(
            policy=self.policy,
            period_start=date.today().replace(day=1),
            period_end=date.today(),
            due_date_soft=date.today() - timedelta(days=5),
            due_date_hard=date.today() - timedelta(days=1),
            amount=14000,
            currency="ARS",
            status=BillingPeriod.Status.UNPAID,
        )

    def test_overdue_period_suspends_policy(self):
        mark_overdue_and_suspend_if_needed(self.policy, self.period, now=date.today())
        self.policy.refresh_from_db()
        self.period.refresh_from_db()
        self.assertEqual(self.policy.status, "suspended")
        self.assertEqual(self.period.status, BillingPeriod.Status.OVERDUE)
