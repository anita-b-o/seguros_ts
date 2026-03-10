from datetime import date

from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase, APIClient

from common.models import AppSettings
from products.models import Product
from payments.models import BillingPeriod
from policies.models import Policy, PolicyInstallment


User = get_user_model()


class AdminPolicyBillingPeriodTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            dni="70000010",
            email="admin-billing@example.com",
            password="AdminPass123",
            is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)
        self.product = Product.objects.create(
            code="BPTEST",
            name="Billing Test",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=12000,
            coverages="",
        )

    def _payload(self, **overrides):
        today = date.today()
        data = {
            "product_id": self.product.id,
            "premium": 12000,
            "status": "active",
            "start_date": f"{today.year}-{today.month:02d}-01",
            "end_date": f"{today.year}-12-31",
            "vehicle": {
                "plate": "AA000AA",
                "make": "Test",
                "model": "Fixture",
                "year": 2020,
            },
        }
        data.update(overrides)
        return data

    def test_admin_create_autogenerates_sc_number_and_billing_period(self):
        url = reverse("admin-policies-list")
        res = self.client.post(url, self._payload(), format="json")
        self.assertEqual(res.status_code, 201)

        policy_id = res.data.get("id")
        self.assertIsNotNone(policy_id)
        self.assertRegex(res.data.get("number", ""), r"^SC-\d{6}$")
        self.assertIsNotNone(res.data.get("billing_period_current"))

        policy = Policy.objects.get(id=policy_id)
        self.assertTrue(BillingPeriod.objects.filter(policy=policy).exists())

    def test_admin_create_does_not_create_installments(self):
        url = reverse("admin-policies-list")
        res = self.client.post(url, self._payload(), format="json")
        self.assertEqual(res.status_code, 201)

        policy_id = res.data.get("id")
        policy = Policy.objects.get(id=policy_id)
        self.assertEqual(PolicyInstallment.objects.filter(policy=policy).count(), 0)

    def test_admin_create_uses_default_term_months_for_end_date(self):
        settings_obj = AppSettings.get_solo()
        settings_obj.default_term_months = 3
        settings_obj.save(update_fields=["default_term_months"])

        url = reverse("admin-policies-list")
        res = self.client.post(url, self._payload(start_date="2026-01-01"), format="json")
        self.assertEqual(res.status_code, 201)

        policy = Policy.objects.get(id=res.data["id"])
        self.assertEqual(policy.start_date.isoformat(), "2026-01-01")
        self.assertEqual(policy.end_date.isoformat(), "2026-03-31")
        self.assertEqual(policy.default_term_months_snapshot, 3)

    def test_admin_list_does_not_create_billing_periods(self):
        today = date.today()
        policy = Policy.objects.create(
            number="SC-READONLY-1",
            product=self.product,
            premium=12000,
            status="active",
            start_date=date(today.year, today.month, 1),
            end_date=date(today.year, 12, 31),
        )
        self.assertEqual(BillingPeriod.objects.filter(policy=policy).count(), 0)

        url = reverse("admin-policies-list")
        res = self.client.get(url, HTTP_ACCEPT="application/json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(BillingPeriod.objects.filter(policy=policy).count(), 0)

        payload = res.data.get("results", res.data)
        item = next((row for row in payload if row.get("id") == policy.id), None)
        self.assertIsNotNone(item)
        self.assertIsNone(item.get("billing_period_current"))
