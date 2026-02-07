from django.contrib.auth import get_user_model
from rest_framework import status
from django.conf import settings
from rest_framework.test import APIClient, APITestCase

from products.models import Product
from policies.models import Policy


User = get_user_model()


class LegacySlashCompatibilityTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            dni="80000000",
            email="legacy@example.com",
            password="LegacyPass123",
        )
        self.admin = User.objects.create_user(
            dni="80000001",
            email="admin@example.com",
            password="AdminPass123",
            is_staff=True,
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)

        product = Product.objects.create(
            code="LEGACY",
            name="Legacy Product",
            vehicle_type="AUTO",
            plan_type="TR",
            base_price=5000,
            coverages="",
            is_active=True,
        )
        Policy.objects.create(
            number="SC-LEGACY-1",
            product=product,
            premium=4500,
            status="active",
            user=self.user,
        )

    def _slash_variants(self, path):
        return [path, f"{path}/"]

    def test_admin_policies_list_requires_admin_and_respects_query_params(self):
        params = {"page": 1, "page_size": 1}
        base = "/api/admin/policies/policies"
        for url in self._slash_variants(base):
            forbidden = self.client.get(url, params)
            self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)

            allowed = self.admin_client.get(url, params)
            self.assertEqual(allowed.status_code, status.HTTP_200_OK)
            self.assertIn("results", allowed.data)
            self.assertLessEqual(len(allowed.data["results"]), params["page_size"])

    def test_admin_accounts_users_list_requires_admin(self):
        base = "/api/admin/accounts/users"
        for url in self._slash_variants(base):
            forbidden = self.client.get(url)
            self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)

            allowed = self.admin_client.get(url)
            self.assertEqual(allowed.status_code, status.HTTP_200_OK)
            self.assertTrue(isinstance(allowed.data, list))
            self.assertGreaterEqual(len(allowed.data), 2)

    def test_admin_products_insurance_types_list_requires_admin(self):
        base = "/api/admin/products/insurance-types"
        for url in self._slash_variants(base):
            forbidden = self.client.get(url)
            self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)

            allowed = self.admin_client.get(url)
            self.assertEqual(allowed.status_code, status.HTTP_200_OK)
            self.assertIn("results", allowed.data)

    def test_common_admin_settings_accepts_slash_variants(self):
        base = "/api/common/admin/settings"
        for url in self._slash_variants(base):
            forbidden = self.client.get(url)
            self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)

            allowed = self.admin_client.get(url)
            self.assertEqual(allowed.status_code, status.HTTP_200_OK)

    def test_accounts_users_me_slash_variants_require_auth(self):
        guest = APIClient()
        base = "/api/accounts/users/me"
        for url in self._slash_variants(base):
            anonymous = guest.get(url)
            self.assertEqual(anonymous.status_code, status.HTTP_401_UNAUTHORIZED)

            authenticated = self.client.get(url)
            self.assertEqual(authenticated.status_code, status.HTTP_200_OK)

    def test_auth_login_accepts_slash_variants(self):
        guest = APIClient()
        base = "/api/auth/login"
        payload = {"email": self.user.email, "password": "LegacyPass123"}
        for url in self._slash_variants(base):
            response = guest.post(url, payload, format="json")
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertIn(settings.JWT_ACCESS_COOKIE, response.cookies)
            self.assertIn(settings.JWT_REFRESH_COOKIE, response.cookies)

    def test_users_lookup_deprecated_includes_slash_variants(self):
        guest = APIClient()
        base = "/api/users/lookup"
        for url in self._slash_variants(base):
            response = guest.get(url)
            self.assertEqual(response.status_code, status.HTTP_410_GONE)
