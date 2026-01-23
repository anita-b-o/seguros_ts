from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase, APIClient

from products.models import Product
from policies.models import Policy


User = get_user_model()


class AdminPolicyVehicleOptionalTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            dni="61000001",
            email="admin-vehicle@example.com",
            password="AdminPass123",
            is_staff=True,
        )
        self.product = Product.objects.create(
            code="ADM-VEH",
            name="Admin Vehicle Plan",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=12000,
            coverages="",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _base_payload(self, number="SC-100001"):
        return {
            "number": number,
            "product_id": self.product.id,
            "premium": 12000,
            "status": "active",
            "start_date": str(date.today()),
            "end_date": str(date.today() + timedelta(days=365)),
        }

    def test_create_policy_without_vehicle(self):
        payload = self._base_payload()
        resp = self.client.post("/api/admin/policies/policies", payload, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(Policy.objects.filter(number__iexact="SC-100001").exists())

    def test_create_policy_with_empty_vehicle_object(self):
        payload = self._base_payload(number="SC-100001-B")
        payload["vehicle"] = {}
        resp = self.client.post("/api/admin/policies/policies", payload, format="json")
        self.assertEqual(resp.status_code, 201)
        policy = Policy.objects.get(number__iexact="SC-100001-B")
        self.assertIsNone(policy.vehicle_id)

    def test_create_policy_with_partial_vehicle_returns_400_and_rolls_back(self):
        payload = self._base_payload(number="SC-100002")
        payload["user_id"] = self.admin.id
        payload["vehicle"] = {"plate": "AA123BB"}
        resp = self.client.post("/api/admin/policies/policies", payload, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(Policy.objects.filter(number__iexact="SC-100002").exists())

    def test_create_policy_with_valid_vehicle_assigns_fk(self):
        payload = self._base_payload(number="SC-100002-B")
        payload["user_id"] = self.admin.id
        payload["vehicle"] = {
            "plate": "AA123BB",
            "make": "Toyota",
            "model": "Corolla",
            "year": 2020,
        }
        resp = self.client.post("/api/admin/policies/policies", payload, format="json")
        self.assertEqual(resp.status_code, 201)
        policy = Policy.objects.get(number__iexact="SC-100002-B")
        self.assertIsNotNone(policy.vehicle_id)

    def test_patch_policy_with_vehicle_null(self):
        policy = Policy.objects.create(
            number="SC-100003",
            product=self.product,
            premium=12000,
            status="active",
            start_date=date.today(),
            end_date=date.today() + timedelta(days=365),
        )
        resp = self.client.patch(
            f"/api/admin/policies/policies/{policy.id}",
            {"vehicle": None},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)

    def test_create_policy_rolls_back_on_post_create_failure(self):
        payload = self._base_payload(number="SC-100004")
        with patch("policies.serializers.ensure_current_billing_period", side_effect=Exception("boom")):
            resp = self.client.post("/api/admin/policies/policies", payload, format="json")
        self.assertGreaterEqual(resp.status_code, 500)
        self.assertFalse(Policy.objects.filter(number__iexact="SC-100004").exists())
