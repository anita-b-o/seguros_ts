from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from payments.models import BillingPeriod, Payment, Receipt
from payments.views import _map_status_to_state, _process_mp_webhook_for_payment, _normalize_payload
from policies.billing import regenerate_installments
from policies.models import Policy, PolicyInstallment
from products.models import Product


User = get_user_model()


class WebhookStateTransitionTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(dni="92000000", email="state@example.com", password="StatePass123")
        self.product = Product.objects.create(
            code="STATE",
            name="State Test Plan",
            vehicle_type="AUTO",
            plan_type="RC",
            min_year=1990,
            max_year=2100,
            base_price=10000,
            coverages="",
        )
        self.policy = Policy.objects.create(
            number="STATE-1",
            user=self.user,
            product=self.product,
            premium=10000,
            start_date=date.today(),
            end_date=date.today() + timedelta(days=90),
            status="active",
        )
        regenerate_installments(self.policy)
        installment = self.policy.installments.order_by("sequence").first()
        period = f"{installment.period_start_date.year}{str(installment.period_start_date.month).zfill(2)}"
        billing_period = BillingPeriod.objects.create(
            policy=self.policy,
            period_start=installment.period_start_date,
            period_end=installment.period_end_date,
            due_date_soft=installment.due_date_display,
            due_date_hard=installment.due_date_real,
            amount=installment.amount,
            currency="ARS",
            status=BillingPeriod.Status.UNPAID,
        )
        self.payment = Payment.objects.create(
            policy=self.policy,
            billing_period=billing_period,
            period=period,
            amount=installment.amount,
        )

    def _payload(self, status, mp_payment_id="state-mp"):
        return {
            "payment_id": self.payment.id,
            "status": status,
            "mp_payment_id": mp_payment_id,
        }

    def test_pen_transitions_to_approved(self):
        self.payment.state = "PEN"
        self.payment.save(update_fields=["state"])
        payload = self._payload("approved")
        res = _process_mp_webhook_for_payment(
            self.payment,
            _normalize_payload(payload),
            payload["mp_payment_id"],
            payload["status"],
            None,
            str(self.payment.amount),
        )
        self.payment.refresh_from_db()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.payment.state, "APR")
        self.assertEqual(Receipt.objects.filter(policy=self.policy).count(), 1)

    def test_apr_ignores_pending_transition(self):
        self.payment.state = "APR"
        self.payment.save(update_fields=["state"])
        initial_receipts = Receipt.objects.filter(policy=self.policy).count()
        payload = self._payload("pending")
        res = _process_mp_webhook_for_payment(
            self.payment,
            _normalize_payload(payload),
            payload["mp_payment_id"],
            payload["status"],
            None,
            str(self.payment.amount),
        )
        self.payment.refresh_from_db()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.payment.state, "APR")
        self.assertEqual(Receipt.objects.filter(policy=self.policy).count(), initial_receipts)

    def test_rej_blocked_from_pending(self):
        self.payment.state = "REJ"
        self.payment.save(update_fields=["state"])
        payload = self._payload("pending")
        res = _process_mp_webhook_for_payment(
            self.payment,
            _normalize_payload(payload),
            payload["mp_payment_id"],
            payload["status"],
            None,
            str(self.payment.amount),
        )
        self.payment.refresh_from_db()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.payment.state, "REJ")
        self.assertEqual(Receipt.objects.filter(policy=self.policy).count(), 0)

    def test_state_mapping(self):
        self.assertEqual(_map_status_to_state("approved"), "APR")
        self.assertEqual(_map_status_to_state("rejected"), "REJ")
        self.assertEqual(_map_status_to_state("pending"), "PEN")
