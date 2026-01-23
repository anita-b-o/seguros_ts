from datetime import date
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase
from unittest.mock import patch

from accounts.models import User
from policies.models import Policy
from products.models import Product


class PolicyObjectScopeTests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.user_a = User.objects.create_user(
            dni="81000001",
            email="usera@example.com",
            password="UserAPass123",
        )
        self.user_b = User.objects.create_user(
            dni="82000002",
            email="userb@example.com",
            password="UserBPass123",
        )
        self.product = Product.objects.create(
            code="SCOPE",
            name="Scope Plan",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=2000,
            max_year=2099,
            base_price=10000,
            coverages="",
        )
        self.policy_a = Policy.objects.create(
            user=self.user_a,
            number="SC-SCOPE-A",
            product=self.product,
            premium=15000,
            start_date=date.today(),
            end_date=date.today(),
            status="active",
        )
        self.policy_b = Policy.objects.create(
            user=self.user_b,
            number="SC-SCOPE-B",
            product=self.product,
            premium=15000,
            start_date=date.today(),
            end_date=date.today(),
            status="active",
        )
    def _auth(self, user):
        self.client.force_authenticate(user=user)

    def test_policy_list_scoped_to_user(self):
        self._auth(self.user_a)
        response = self.client.get(reverse("policies-my"))
        self.assertEqual(response.status_code, 200)
        ids = [item.get("id") for item in response.data]
        self.assertIn(self.policy_a.id, ids)
        self.assertNotIn(self.policy_b.id, ids)
    def test_policy_detail_scoped_to_user(self):
        self._auth(self.user_a)
        url = reverse("policies-detail", args=[self.policy_b.id])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 404)

    @patch("payments.views._mp_headers", return_value={"Authorization": "Bearer token"})
    @patch(
        "payments.views._mp_create_preference",
        return_value=({"id": "pref-123", "init_point": "https://mock"}, ""),
    )
    def test_create_preference_requires_scope(self, mk_pref, mk_headers):
        self._auth(self.user_a)
        url = reverse("payments-create-preference", kwargs={"policy_id": self.policy_b.id})
        response = self.client.post(url, {})
        self.assertEqual(response.status_code, 404)

    @patch("payments.views._mp_headers", return_value={"Authorization": "Bearer token"})
    @patch(
        "payments.views._mp_create_preference",
        return_value=({"id": "pref-456", "init_point": "https://mock"}, ""),
    )
    def test_create_preference_allows_own_policy(self, mk_pref, mk_headers):
        self._auth(self.user_a)
        url = reverse("payments-create-preference", kwargs={"policy_id": self.policy_a.id})
        response = self.client.post(url, {})
        self.assertEqual(response.status_code, 200)
        self.assertIn("preference_id", response.data)
