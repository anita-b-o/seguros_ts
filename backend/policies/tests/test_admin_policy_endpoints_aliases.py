from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase, APIClient

from products.models import Product
from policies.models import Policy


User = get_user_model()


class AdminPolicyEndpointsAliasesTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            dni="61000002",
            email="admin-endpoints@example.com",
            password="AdminPass123",
            is_staff=True,
        )
        self.product = Product.objects.create(
            code="ADM-EP",
            name="Admin Endpoint Plan",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=12000,
            coverages="",
        )
        self.policy = Policy.objects.create(
            number="SC-EP-1",
            product=self.product,
            premium=12000,
            status="active",
            start_date=date.today(),
            end_date=date.today() + timedelta(days=365),
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_admin_pending_payments_alias(self):
        resp = self.client.get(
            "/api/admin/payments/pending",
            {"policy_id": self.policy.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)

    def test_policy_receipts_trailing_slash(self):
        resp = self.client.get(
            f"/api/policies/{self.policy.id}/receipts/",
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.data, list)
