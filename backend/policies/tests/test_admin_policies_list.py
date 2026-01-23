from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase, APIClient

from products.models import Product
from policies.models import Policy


User = get_user_model()


class AdminPoliciesListTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            dni="60000002",
            email="admin-list@example.com",
            password="AdminPass123",
            is_staff=True,
        )
        product = Product.objects.create(
            code="ADM-LIST",
            name="Admin List Plan",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=12000,
            coverages="",
        )
        Policy.objects.create(
            number="SC-ADM-1",
            product=product,
            premium=12000,
            status="active",
            start_date=date.today() - timedelta(days=10),
            end_date=date.today() + timedelta(days=355),
        )

    def test_admin_policies_list_does_not_crash_on_timeline_today_kwarg(self):
        client = APIClient()
        client.force_authenticate(user=self.admin)
        resp = client.get("/api/admin/policies/policies/?page=1&page_size=10", HTTP_ACCEPT="application/json")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("results", resp.data)
        self.assertGreater(len(resp.data["results"]), 0)
