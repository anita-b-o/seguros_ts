from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase, APIClient

from common.models import AppSettings
from payments.models import BillingPeriod
from products.models import Product
from policies.models import Policy
from policies.billing import compute_term_end_date

User = get_user_model()
class AdminPolicyAdjustmentAndListBehaviorTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            dni="70000001",
            email="admin-adjust@example.com",
            password="AdminPass123",
            is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

        self.product = Product.objects.create(
            code="ADJ-PLAN",
            name="Ajuste Plan",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=12000,
            coverages="",
        )

    def test_list_does_not_change_policy_status(self):
        policy = Policy.objects.create(
            number="SC-LIST-1",
            product=self.product,
            premium=12000,
            status="active",
            start_date=date.today() - timedelta(days=30),
            end_date=date.today() + timedelta(days=30),
        )

        BillingPeriod.objects.create(
            policy=policy,
            period_start=date.today() - timedelta(days=10),
            period_end=date.today() - timedelta(days=1),
            due_date_soft=date.today() - timedelta(days=5),
            due_date_hard=date.today() - timedelta(days=1),
            amount=policy.premium,
            currency="ARS",
            status=BillingPeriod.Status.UNPAID,
        )

        resp = self.client.get("/api/admin/policies/policies/?page=1&page_size=10")
        self.assertEqual(resp.status_code, 200)

        policy.refresh_from_db()
        self.assertEqual(policy.status, "active")

    def test_premium_change_in_adjustment_uses_previous_end_date(self):
        settings = AppSettings.get_solo()
        settings.policy_adjustment_window_days = 10
        settings.default_term_months = 3
        settings.save(update_fields=["policy_adjustment_window_days", "default_term_months"])

        prev_end = date.today() + timedelta(days=5)
        policy = Policy.objects.create(
            number="SC-ADJ-1",
            product=self.product,
            premium=12000,
            status="active",
            start_date=date.today() - timedelta(days=60),
            end_date=prev_end,
            default_term_months_snapshot=3,
            policy_adjustment_window_days_snapshot=10,
        )

        settings.default_term_months = 6
        settings.save(update_fields=["default_term_months"])

        resp = self.client.patch(
            f"/api/admin/policies/policies/{policy.id}",
            {"premium": "13000"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)

        policy.refresh_from_db()
        self.assertEqual(policy.start_date, prev_end)
        self.assertEqual(policy.end_date, compute_term_end_date(prev_end, 6))
        self.assertEqual(policy.default_term_months_snapshot, 6)
