from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from products.models import Product
from policies.billing import regenerate_installments
from policies.models import Policy
from payments.models import Payment
from payments.utils import period_from_installment

from common.metrics import (
    payments_confirmed_total,
    webhooks_processed_total,
    webhooks_received_total,
)


User = get_user_model()


class MetricsEndpointTest(APITestCase):
    def test_metrics_endpoint_responds(self):
        res = self.client.get("/metrics/")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"# HELP", res.content)


class WebhookMetricsTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            dni="12300000",
            email="metrics@example.com",
            password="MetricsPass123",
        )
        self.product = Product.objects.create(
            code="MET",
            name="Metrics plan",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=1000,
            coverages="[]",
        )
        self.policy = Policy.objects.create(
            number="SC-MET-1",
            user=self.user,
            product=self.product,
            premium=1000,
            start_date=date.today(),
            end_date=date.today() + timedelta(days=90),
            status="active",
        )
        regenerate_installments(self.policy)
        self.installment = self.policy.installments.order_by("sequence").first()
        period = period_from_installment(self.installment) or date.today().strftime("%Y%m")
        amount = self.installment.amount or Decimal("0")
        self.payment = Payment.objects.create(
            policy=self.policy,
            installment=self.installment,
            period=period,
            amount=amount,
        )

    @mock.patch("payments.views._authorize_mp_webhook", return_value=(True, "", 200))
    def test_webhook_increments_counters(self, _mock_auth):
        initial_received = webhooks_received_total._value.get()
        initial_processed = webhooks_processed_total._value.get()
        initial_confirmed = payments_confirmed_total._value.get()

        payload = {
            "payment_id": self.payment.id,
            "status": "approved",
            "event_id": "evt-metrics",
        }
        res = self.client.post("/api/payments/webhook/", payload, format="json")

        self.assertEqual(res.status_code, 200)
        self.assertEqual(webhooks_received_total._value.get(), initial_received + 1)
        self.assertEqual(webhooks_processed_total._value.get(), initial_processed + 1)
        self.assertEqual(payments_confirmed_total._value.get(), initial_confirmed + 1)
