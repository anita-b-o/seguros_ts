from datetime import date

from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase, APIClient

from products.models import Product
from policies.models import Policy


User = get_user_model()


class AdminPolicyNumberConflictTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            dni="70000000",
            email="admin-number@example.com",
            password="AdminPass123",
            is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)
        self.product = Product.objects.create(
            code="POLNUM",
            name="Test",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=12000,
            coverages="",
        )

    def _payload(self, number=None):
        today = date.today()
        data = {
            "product_id": self.product.id,
            "premium": 12000,
            "status": "active",
            "start_date": f"{today.year}-{today.month:02d}-01",
            "end_date": f"{today.year}-12-31",
            "vehicle": {
                "plate": "BB000BB",
                "make": "Test",
                "model": "Fixture",
                "year": 2020,
            },
        }
        if number is not None:
            data["number"] = number
        return data

    def test_duplicate_number_returns_409(self):
        url = reverse("admin-policies-list")
        payload = self._payload(number="SC-TEST-1")
        res1 = self.client.post(url, payload, format="json")
        self.assertEqual(res1.status_code, 201)

        res2 = self.client.post(url, payload, format="json")
        self.assertEqual(res2.status_code, 409)
        self.assertEqual(res2.data.get("number"), ["Policy number already exists."])
        self.assertEqual(Policy.objects.filter(number="SC-TEST-1").count(), 1)

    def test_auto_generated_number_uses_policy_id(self):
        url = reverse("admin-policies-list")
        res = self.client.post(url, self._payload(number=None), format="json")
        self.assertEqual(res.status_code, 201)
        policy_id = res.data.get("id")
        self.assertIsNotNone(policy_id)
        expected = f"SC-{int(policy_id):06d}"
        self.assertEqual(res.data.get("number"), expected)
        self.assertTrue(Policy.objects.filter(id=policy_id, number=expected).exists())
