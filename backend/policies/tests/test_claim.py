from django.urls import reverse
from rest_framework.test import APITestCase, APIClient
from django.contrib.auth import get_user_model
from products.models import Product
from policies.models import Policy

User = get_user_model()


class ClaimPolicyTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            dni="40000000", email="claim@example.com", password="ClaimPass123"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.product = Product.objects.create(
            code="CLAIM",
            name="Plan Claim",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=10000,
            coverages="",
        )
        self.policy = Policy.objects.create(
            number="SC-CLM-1",
            product=self.product,
            premium=10000,
            status="active",
            claim_code="CLAIM-CODE",
            holder_dni=self.user.dni,
        )

    def test_claim_policy_assigns_user(self):
        url = reverse("policies-claim")
        res = self.client.post(url, {"number": "SC-CLM-1"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.policy.refresh_from_db()
        self.assertEqual(self.policy.user, self.user)
        self.assertIn("policy", res.data)
        self.assertEqual(res.data["policy"]["id"], self.policy.id)
