from datetime import timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from products.models import Product
from policies.models import Policy


class ApiFlowsTest(APITestCase):
    def setUp(self):
        self.product = Product.objects.create(
            code="PLAN_TEST",
            name="Plan Test",
            subtitle="",
            bullets=[],
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=10000,
            coverages="Cobertura básica",
            published_home=True,
            is_active=True,
        )
        self.user = User.objects.create_user(
            dni="12345678",
            email="user@test.com",
            password="pass1234",
            first_name="User",
            last_name="Test",
        )
        self.admin = User.objects.create_user(
            dni="99999999",
            email="admin@test.com",
            password="admin1234",
            first_name="Admin",
            last_name="Test",
            is_staff=True,
            is_superuser=True,
        )
        today = timezone.now().date()
        self.claim_policy = Policy.objects.create(
            number="SC-CL-001",
            product=self.product,
            premium=Decimal("15000"),
            start_date=today,
            end_date=today + timedelta(days=90),
            status="active",
            claim_code="SC-CL-001",
        )
        self.pay_policy = Policy.objects.create(
            number="SC-PAY-001",
            user=self.user,
            product=self.product,
            premium=Decimal("18000"),
            start_date=today,
            end_date=today + timedelta(days=90),
            status="active",
            claim_code="SC-PAY-001",
        )

    def test_register_and_login(self):
        # Registro
        res = self.client.post(
            "/api/auth/register",
            {
                "email": "newuser@test.com",
                "dni": "55555555",
                "password": "pass1234",
                "first_name": "New",
                "last_name": "User",
            },
        )
        self.assertEqual(res.status_code, 201)
        self.assertIn("access", res.data)
        # Login usuario existente
        res2 = self.client.post(
            "/api/auth/login",
            {"email": self.user.email, "password": "pass1234"},
        )
        self.assertEqual(res2.status_code, 200)
        self.assertIn("access", res2.data)

    def test_quote_only_active_products(self):
        # Producto inactivo que no debe aparecer
        Product.objects.create(
            code="PLAN_INACT",
            name="Inactivo",
            subtitle="",
            bullets=[],
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=8000,
            coverages="",
            published_home=False,
            is_active=False,
        )
        res = self.client.post("/api/quotes/", {"vtype": "AUTO", "year": 2020})
        self.assertEqual(res.status_code, 200)
        plan_ids = {p["id"] for p in res.data.get("plans", [])}
        self.assertIn(self.product.id, plan_ids)
        self.assertNotIn(
            Product.objects.get(code="PLAN_INACT").id,
            plan_ids,
        )

    def test_claim_policy(self):
        self.client.force_authenticate(user=self.user)
        res = self.client.post("/api/policies/claim", {"code": self.claim_policy.claim_code})
        self.assertEqual(res.status_code, 200)
        self.claim_policy.refresh_from_db()
        self.assertEqual(self.claim_policy.user_id, self.user.id)

    def test_create_preference_fake_mp_in_debug(self):
        self.client.force_authenticate(user=self.user)
        res = self.client.post(f"/api/payments/policies/{self.pay_policy.id}/create_preference", {})
        self.assertEqual(res.status_code, 200)
        self.assertIn("init_point", res.data)
        self.assertIn("payment_id", res.data)

    def test_manual_payment_admin(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(f"/api/payments/manual/{self.pay_policy.id}/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("receipt_id", res.data)
