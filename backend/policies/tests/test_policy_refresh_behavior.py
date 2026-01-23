from datetime import date, timedelta

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from payments.models import BillingPeriod
from policies.models import Policy
from products.models import Product


class PolicyReadActionsSideEffectTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            dni="70000001",
            email="owner-refresh@example.com",
            password="OwnerPass123",
        )
        product = Product.objects.create(
            code="REFRESH",
            name="Refresh Plan",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=2010,
            max_year=2100,
            base_price=20000,
            coverages="Cobertura de prueba",
        )
        self.policy = Policy.objects.create(
            number="SC-REF-1",
            product=product,
            premium=20000,
            status="active",
            user=self.user,
            start_date=date.today() - timedelta(days=30),
            end_date=date.today() + timedelta(days=335),
        )
        self.client.force_authenticate(user=self.user)

    def test_list_get_creates_current_billing_period(self):
        url = reverse("policies-my")
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(BillingPeriod.objects.filter(policy=self.policy).exists())


class PolicyRefreshActionTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            dni="70000002",
            email="refresh-action@example.com",
            password="OwnerPass123",
        )
        product = Product.objects.create(
            code="REFRESH2",
            name="Refresh Plan 2",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=2010,
            max_year=2100,
            base_price=21000,
            coverages="Cobertura de prueba",
        )
        self.policy = Policy.objects.create(
            number="SC-REF-2",
            product=product,
            premium=21000,
            status="active",
            user=self.user,
            start_date=date.today() - timedelta(days=400),
            end_date=date.today() - timedelta(days=30),
        )
        self.client.force_authenticate(user=self.user)

    def test_refresh_action_keeps_billing_period(self):
        url = reverse("policies-refresh", args=[self.policy.id])
        response = self.client.post(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(BillingPeriod.objects.filter(policy=self.policy).exists())
