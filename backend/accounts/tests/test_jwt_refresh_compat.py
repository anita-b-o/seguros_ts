from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase


User = get_user_model()


class JwtRefreshCompatibilityTests(APITestCase):
    def setUp(self):
        self.password = "StrongPass123"
        self.user = User.objects.create_user(
            dni="12340000",
            email="refresh@example.com",
            password=self.password,
            first_name="Refresh",
            last_name="User",
        )

    def _obtain_refresh_token(self):
        response = self.client.post(
            reverse("auth-login"),
            {"email": self.user.email, "password": self.password},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data["refresh"]

    def test_accounts_refresh_accepts_valid_token(self):
        refresh = self._obtain_refresh_token()
        response = self.client.post(
            "/api/accounts/jwt/refresh/",
            {"refresh": refresh},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

    def test_auth_refresh_alias_accepts_valid_token(self):
        refresh = self._obtain_refresh_token()
        response = self.client.post(
            "/api/auth/refresh/",
            {"refresh": refresh},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

    def test_accounts_refresh_rejects_invalid_token(self):
        response = self.client.post(
            "/api/accounts/jwt/refresh/",
            {"refresh": "invalid"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_auth_refresh_alias_rejects_invalid_token(self):
        response = self.client.post(
            "/api/auth/refresh/",
            {"refresh": "invalid"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
