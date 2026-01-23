from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APITestCase

from audit.models import AuditLog
from payments.models import BillingPeriod, Payment
from policies.billing import update_policy_status_from_installments
from policies.models import Policy, PolicyInstallment
from products.models import Product

User = get_user_model()


class PolicyAuditTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(
            code="AUDIT-STAT",
            name="Audit Status",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=1000,
            coverages="[]",
        )
        self.start_date = date(2024, 1, 1)

    def _create_policy(self, status):
        return Policy.objects.create(
            number=f"AUDIT-{status}",
            user=None,
            product=self.product,
            premium=1000,
            start_date=self.start_date,
            end_date=self.start_date + timedelta(days=30),
            status=status,
        )

    def _add_installment(self, policy, status):
        return PolicyInstallment.objects.create(
            policy=policy,
            sequence=1,
            period_start_date=self.start_date,
            period_end_date=self.start_date + timedelta(days=30),
            payment_window_start=self.start_date,
            payment_window_end=self.start_date + timedelta(days=15),
            due_date_display=self.start_date + timedelta(days=5),
            due_date_real=self.start_date + timedelta(days=10),
            amount=policy.premium,
            status=status,
        )

    def test_policy_status_change_generates_audit_log(self):
        policy = self._create_policy("active")
        self._add_installment(policy, PolicyInstallment.Status.EXPIRED)
        update_policy_status_from_installments(policy, policy.installments.all(), persist=True)
        log = AuditLog.objects.filter(
            action="policy_status_auto_update",
            entity_type="Policy",
            entity_id=str(policy.id),
        ).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.after.get("status"), "expired")


class PaymentAuditTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            dni="99000000",
            email="audit-pay@example.com",
            password="AuditPay123",
        )
        self.client.force_authenticate(user=self.user)
        self.product = Product.objects.create(
            code="AUDIT-PAY",
            name="Audit Payment",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=1000,
            coverages="[]",
        )
        self.policy = Policy.objects.create(
            number="AUDIT-PAY-1",
            user=self.user,
            product=self.product,
            premium=1000,
            start_date=date.today(),
            end_date=date.today() + timedelta(days=30),
            status="active",
        )
        PolicyInstallment.objects.create(
            policy=self.policy,
            sequence=1,
            period_start_date=date.today(),
            period_end_date=date.today() + timedelta(days=30),
            payment_window_start=date.today(),
            payment_window_end=date.today() + timedelta(days=10),
            due_date_display=date.today() + timedelta(days=5),
            due_date_real=date.today() + timedelta(days=7),
            amount=self.policy.premium,
            status=PolicyInstallment.Status.PENDING,
        )

    @mock.patch.dict("os.environ", {"MP_ACCESS_TOKEN": "dummy"})
    @mock.patch("payments.views._mp_create_preference")
    def test_payment_creation_logs_audit(self, mock_mp_create):
        mock_mp_create.return_value = ({"id": "pref-audit", "init_point": "http://pay"}, "")
        installment = self.policy.installments.first()
        res = self.client.post(
            f"/api/payments/policies/{self.policy.id}/create_preference",
            {"installment_id": installment.id},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        log = AuditLog.objects.filter(action="payment_created", entity_type="Payment").order_by("-created_at").first()
        self.assertIsNotNone(log)
        self.assertEqual(log.extra.get("policy_id"), self.policy.id)


class WebhookAuditTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            dni="99100000",
            email="audit-webhook@example.com",
            password="AuditHook123",
        )
        self.client.force_authenticate(user=self.user)
        self.product = Product.objects.create(
            code="AUDIT-HOOK",
            name="Audit Webhook",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=2000,
            coverages="[]",
        )
        self.policy = Policy.objects.create(
            number="AUDIT-HOOK-1",
            user=self.user,
            product=self.product,
            premium=2000,
            start_date=date.today(),
            end_date=date.today() + timedelta(days=30),
            status="active",
        )
        installment = PolicyInstallment.objects.create(
            policy=self.policy,
            sequence=1,
            period_start_date=date.today(),
            period_end_date=date.today() + timedelta(days=30),
            payment_window_start=date.today(),
            payment_window_end=date.today() + timedelta(days=10),
            due_date_display=date.today() + timedelta(days=5),
            due_date_real=date.today() + timedelta(days=7),
            amount=self.policy.premium,
            status=PolicyInstallment.Status.PENDING,
        )
        self.payment = Payment.objects.create(
            policy=self.policy,
            billing_period=BillingPeriod.objects.create(
                policy=self.policy,
                period_start=installment.period_start_date,
                period_end=installment.period_end_date,
                due_date_soft=installment.due_date_display,
                due_date_hard=installment.due_date_real,
                amount=self.policy.premium,
                currency="ARS",
                status=BillingPeriod.Status.UNPAID,
            ),
            period=date.today().strftime("%Y%m"),
            amount=self.policy.premium,
        )

    @mock.patch("payments.views._authorize_mp_webhook", return_value=(True, "", 200))
    def test_webhook_processing_records_audit(self, _mock_auth):
        payload = {"payment_id": self.payment.id, "status": "approved", "event_id": "audit-hook"}
        res = self.client.post("/api/payments/webhook/", payload, format="json")
        self.assertEqual(res.status_code, 200)
        log = AuditLog.objects.filter(
            action="webhook_payment_approved",
            entity_type="Payment",
            entity_id=str(self.payment.id),
        ).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.extra.get("event_id"), "audit-hook")
