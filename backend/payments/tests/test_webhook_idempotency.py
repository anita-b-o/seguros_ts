import hashlib
import json
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from payments.models import BillingPeriod, Payment, Receipt, PaymentWebhookEvent
from payments.views import (
    _get_mp_webhook_event_id,
    _normalize_payload,
    _process_mp_webhook_for_payment,
)
from policies.models import Policy
from policies.billing import regenerate_installments
from products.models import Product


User = get_user_model()


class MpWebhookIdempotencyTests(APITestCase):
    def setUp(self):
        self.product = Product.objects.create(
            code="WH-RT",
            name="Webhook Routing Plan",
            vehicle_type="AUTO",
            plan_type="RC",
            min_year=1990,
            max_year=2100,
            base_price=10000,
            coverages="",
        )
        self.user = User.objects.create_user(
            dni="70000000", email="webhook@example.com", password="HookPass123"
        )
        self.policy = Policy.objects.create(
            number="WH-RT-1",
            user=self.user,
            product=self.product,
            premium=10000,
            start_date=date.today(),
            end_date=date.today() + timedelta(days=90),
            status="active",
        )
        regenerate_installments(self.policy)
        installment = self.policy.installments.order_by("sequence").first()
        period = f"{date.today().year}{str(date.today().month).zfill(2)}"
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

    def test_webhook_processing_is_idempotent_for_same_payload(self):
        payload = {
            "payment_id": self.payment.id,
            "status": "approved",
            "mp_payment_id": "mp-evt-123",
            "id": "event-123",
        }
        payload_dict = _normalize_payload(payload)
        first = _process_mp_webhook_for_payment(
            self.payment,
            payload_dict,
            payload["mp_payment_id"],
            payload["status"],
            None,
            str(self.payment.amount),
        )
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(Payment.objects.get(id=self.payment.id).state, "APR")
        self.assertEqual(Receipt.objects.filter(policy=self.policy).count(), 1)
        self.assertEqual(
            PaymentWebhookEvent.objects.filter(
                provider=PaymentWebhookEvent.PROVIDER_MERCADO_PAGO,
                external_event_id="event-123",
            ).count(),
            1,
        )

        second = _process_mp_webhook_for_payment(
            self.payment,
            payload_dict,
            payload["mp_payment_id"],
            payload["status"],
            None,
            str(self.payment.amount),
        )
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(Receipt.objects.filter(policy=self.policy).count(), 1)
        self.assertEqual(
            PaymentWebhookEvent.objects.filter(
                provider=PaymentWebhookEvent.PROVIDER_MERCADO_PAGO,
                external_event_id="event-123",
            ).count(),
            1,
        )

    def test_different_status_generates_distinct_events(self):
        pending = {
            "payment_id": self.payment.id,
            "status": "pending",
            "mp_payment_id": "mp-evt-123",
        }
        approved = {
            "payment_id": self.payment.id,
            "status": "approved",
            "mp_payment_id": "mp-evt-123",
        }
        first = _process_mp_webhook_for_payment(
            self.payment,
            _normalize_payload(pending),
            pending["mp_payment_id"],
            pending["status"],
            None,
            str(self.payment.amount),
        )
        second = _process_mp_webhook_for_payment(
            self.payment,
            _normalize_payload(approved),
            approved["mp_payment_id"],
            approved["status"],
            None,
            str(self.payment.amount),
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(
            PaymentWebhookEvent.objects.filter(provider=PaymentWebhookEvent.PROVIDER_MERCADO_PAGO).count(),
            2,
        )
        self.assertEqual(Payment.objects.get(id=self.payment.id).state, "APR")

    def test_event_id_prefers_status_when_mp_payment_id_present(self):
        payload = {"mp_payment_id": "mp-123", "status": "pending"}
        self.assertEqual(_get_mp_webhook_event_id(payload), "mp-123:pending")

    def test_event_id_falls_back_to_hash_if_no_ids(self):
        payload = {"some": "data"}
        expected = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()
        self.assertEqual(_get_mp_webhook_event_id(payload), expected)
