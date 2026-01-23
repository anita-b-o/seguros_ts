from datetime import date, timedelta

from django.test import TestCase

from payments.models import BillingPeriod, Payment, Receipt, PaymentWebhookEvent
from payments.views import _process_mp_webhook_for_payment, _normalize_payload
from policies.billing import regenerate_installments
from policies.models import Policy
from products.models import Product


class AdminPolicyPaymentsTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(
            code="ADM-PAY",
            name="Admin Pay Plan",
            vehicle_type="AUTO",
            plan_type="RC",
            min_year=1990,
            max_year=2100,
            base_price=13000,
            coverages="",
        )
        self.start_date = date.today()

    def _create_policy(self, status):
        policy = Policy.objects.create(
            number=f"ADM-{status}",
            product=self.product,
            premium=13000,
            start_date=self.start_date,
            end_date=self.start_date + timedelta(days=90),
            status=status,
        )
        regenerate_installments(policy)
        return policy

    def _create_payment(self, policy):
        installment = policy.installments.order_by("sequence").first()
        period = f"{installment.period_start_date.year}{str(installment.period_start_date.month).zfill(2)}"
        billing_period, _ = BillingPeriod.objects.get_or_create(
            policy=policy,
            period_start=installment.period_start_date,
            defaults={
                "period_end": installment.period_end_date or (installment.period_start_date + timedelta(days=30)),
                "due_date_soft": installment.due_date_display or installment.period_start_date,
                "due_date_hard": installment.due_date_real or installment.period_start_date,
                "amount": installment.amount,
                "currency": "ARS",
                "status": BillingPeriod.Status.UNPAID,
            },
        )
        return Payment.objects.create(
            policy=policy,
            billing_period=billing_period,
            period=period,
            amount=installment.amount,
        )

    def test_webhook_ignores_admin_managed_policy(self):
        policy = self._create_policy("cancelled")
        payment = self._create_payment(policy)
        payload = {
            "payment_id": payment.id,
            "status": "approved",
            "mp_payment_id": "adm-webhook",
        }
        res = _process_mp_webhook_for_payment(
            payment,
            _normalize_payload(payload),
            payload["mp_payment_id"],
            payload["status"],
            None,
            str(payment.amount),
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(payment.state, "PEN")
        self.assertEqual(Receipt.objects.filter(policy=policy).count(), 0)
        self.assertEqual(
            PaymentWebhookEvent.objects.filter(payment=payment).count(),
            1,
        )
        policy.refresh_from_db()
        self.assertEqual(policy.status, "cancelled")
