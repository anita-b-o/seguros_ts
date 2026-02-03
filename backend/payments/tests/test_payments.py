from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase, APIClient
from django.contrib.auth import get_user_model

from products.models import Product
from policies.models import Policy
from payments.models import Payment, Receipt, BillingPeriod
from payments.billing import get_or_create_current_period


User = get_user_model()


class CreatePreferenceTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            dni="50000000", email="pay@example.com", password="PayPass123"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.product = Product.objects.create(
            code="PAY",
            name="Plan Pago",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=15000,
            coverages="",
        )
        self.policy = Policy.objects.create(
            number="SC-PAY-1",
            user=self.user,
            product=self.product,
            premium=15000,
            start_date=date.today(),
            end_date=date.today() + timedelta(days=90),
            status="active",
        )
        self.billing_period = get_or_create_current_period(self.policy)

    @mock.patch.dict("os.environ", {"MP_ACCESS_TOKEN": "dummy"})
    @mock.patch("payments.views._mp_create_preference")
    def test_create_preference_success(self, mock_mp_create):
        mock_mp_create.return_value = ({"id": "pref-1", "init_point": "http://pay"}, "")
        url = f"/api/payments/policies/{self.policy.id}/create_preference"
        res = self.client.post(url, {}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(Payment.objects.filter(policy=self.policy).exists())
        payment = Payment.objects.filter(policy=self.policy).latest("id")
        self.assertEqual(payment.mp_preference_id, "pref-1")
        self.assertEqual(payment.billing_period_id, self.billing_period.id)

    @mock.patch.dict("os.environ", {"MP_ACCESS_TOKEN": "dummy"})
    @mock.patch("payments.views._mp_create_preference")
    def test_idempotent_prefers_existing_payment(self, mock_mp_create):
        mock_mp_create.return_value = ({"id": "pref-2", "init_point": "http://pay"}, "")
        url = f"/api/payments/policies/{self.policy.id}/create_preference"
        res1 = self.client.post(url, {}, format="json")
        self.assertEqual(res1.status_code, 200)
        payment_id = res1.data["payment_id"]
        res2 = self.client.post(url, {}, format="json")
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.data["payment_id"], payment_id)
        self.assertEqual(
            Payment.objects.filter(policy=self.policy, billing_period=self.billing_period).count(),
            1,
        )

    def test_blocks_paid_period(self):
        self.billing_period.status = BillingPeriod.Status.PAID
        self.billing_period.save(update_fields=["status"])
        url = f"/api/payments/policies/{self.policy.id}/create_preference"
        res = self.client.post(url, {}, format="json")
        self.assertEqual(res.status_code, 409)

    @mock.patch.dict("os.environ", {"MP_ACCESS_TOKEN": "dummy"})
    @mock.patch("payments.views._mp_create_preference")
    def test_allows_overdue_period(self, mock_mp_create):
        # NOTE: Current behavior allows paying overdue periods and marks them OVERDUE + expires policy.
        # If business rules change to block overdue payments, update both view and this test.
        mock_mp_create.return_value = ({"id": "pref-3", "init_point": "http://pay"}, "")
        self.billing_period.due_date_hard = timezone.localdate() - timedelta(days=1)
        self.billing_period.save(update_fields=["due_date_hard"])
        url = f"/api/payments/policies/{self.policy.id}/create_preference"
        res = self.client.post(url, {}, format="json")
        self.assertEqual(res.status_code, 200)
        self.billing_period.refresh_from_db()
        self.assertEqual(self.billing_period.status, BillingPeriod.Status.OVERDUE)
        self.policy.refresh_from_db()
        self.assertEqual(self.policy.status, "expired")


class MpWebhookTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            dni="52000000", email="webhook@example.com", password="WebhookPass123"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.product = Product.objects.create(
            code="PAY-MP",
            name="Plan Webhook",
            vehicle_type="AUTO",
            plan_type="RC",
            min_year=1990,
            max_year=2100,
            base_price=12500,
            coverages="",
        )
        self.policy = Policy.objects.create(
            number="SC-WEB-1",
            user=self.user,
            product=self.product,
            premium=12500,
            start_date=date.today() - timedelta(days=30),
            end_date=date.today() + timedelta(days=90),
            status="active",
        )
        self.billing_period = get_or_create_current_period(self.policy)
        self.payment = Payment.objects.create(
            policy=self.policy,
            billing_period=self.billing_period,
            period=self.billing_period.period_code,
            amount=self.billing_period.amount,
            state="PEN",
        )

    def _call_webhook(self, payload):
        with mock.patch("payments.views._authorize_mp_webhook", return_value=(True, "")):
            return self.client.post("/api/payments/webhook/", payload, format="json")

    def test_webhook_marks_period_paid(self):
        res = self._call_webhook({"payment_id": self.payment.id, "status": "approved"})
        self.assertEqual(res.status_code, 200)
        self.payment.refresh_from_db()
        self.billing_period.refresh_from_db()
        self.assertEqual(self.payment.state, "APR")
        self.assertEqual(self.billing_period.status, BillingPeriod.Status.PAID)
        self.assertEqual(Receipt.objects.filter(policy=self.policy).count(), 1)
        self.policy.refresh_from_db()
        self.assertEqual(self.policy.status, "active")


class PaymentPolicyIntegrityTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(
            code="PAY-INTEGRITY",
            name="Integrity Plan",
            vehicle_type="AUTO",
            plan_type="RC",
            min_year=1990,
            max_year=2100,
            base_price=15000,
            coverages="",
        )
        self.policy = Policy.objects.create(
            number="SC-INTEGRITY-1",
            product=self.product,
            premium=15000,
            start_date=date.today(),
            end_date=date.today() + timedelta(days=90),
            status="active",
        )
        self.billing_period = get_or_create_current_period(self.policy)

    def _create_other_policy(self):
        return Policy.objects.create(
            number="SC-INTEGRITY-ALT",
            product=self.product,
            premium=15000,
            start_date=date.today(),
            end_date=date.today() + timedelta(days=90),
            status="active",
        )

    def test_payment_syncs_metadata_from_billing_period(self):
        payment = Payment.objects.create(
            policy=self.policy,
            billing_period=self.billing_period,
            period="000000",
            amount=Decimal("0.01"),
        )
        payment.refresh_from_db()
        self.assertEqual(payment.policy_id, self.policy.id)
        self.assertEqual(payment.period, self.billing_period.period_code)
        self.assertEqual(payment.amount, self.billing_period.amount)

    def test_payment_with_mismatched_policy_is_rejected(self):
        other_policy = self._create_other_policy()
        with self.assertRaises(ValidationError):
            Payment.objects.create(
                policy=other_policy,
                billing_period=self.billing_period,
                period=self.billing_period.period_code,
                amount=self.billing_period.amount,
            )


class PaymentStateTraceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            dni="70000000",
            email="state@example.com",
            password="StatePass123",
        )
        self.product = Product.objects.create(
            code="PAY-TRACE",
            name="Trace Plan",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=16000,
            coverages="",
        )
        self.policy = Policy.objects.create(
            number="SC-TRACE-1",
            user=self.user,
            product=self.product,
            premium=16000,
            start_date=date.today(),
            end_date=date.today() + timedelta(days=90),
            status="active",
        )
        self.billing_period = get_or_create_current_period(self.policy)
        self.payment = Payment.objects.create(
            policy=self.policy,
            billing_period=self.billing_period,
            period=self.billing_period.period_code,
            amount=self.billing_period.amount,
            state="PEN",
        )

    def test_state_fields_populated_on_create(self):
        self.assertIsNotNone(self.payment.updated_at)
        self.assertIsNotNone(self.payment.last_state_change_at)
        self.assertLessEqual(self.payment.last_state_change_at, self.payment.updated_at)

    def test_non_state_updates_do_not_change_state_timestamp(self):
        prev_last_state = self.payment.last_state_change_at
        prev_updated = self.payment.updated_at
        self.payment.amount = self.payment.amount + Decimal("100.00")
        self.payment.save()
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.last_state_change_at, prev_last_state)
        self.assertNotEqual(self.payment.updated_at, prev_updated)

    def test_state_change_updates_timestamp(self):
        prev_last_state = self.payment.last_state_change_at
        self.payment.state = "APR"
        self.payment.save()
        self.payment.refresh_from_db()
        self.assertNotEqual(self.payment.last_state_change_at, prev_last_state)
        self.assertEqual(self.payment.state, "APR")

    def test_state_change_with_update_fields_sticks_timestamp(self):
        prev_last_state = self.payment.last_state_change_at
        self.payment.state = "APR"
        self.payment.save(update_fields=["state"])
        self.payment.refresh_from_db()
        self.assertNotEqual(self.payment.last_state_change_at, prev_last_state)
        self.assertEqual(self.payment.state, "APR")
