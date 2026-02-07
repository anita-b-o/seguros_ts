from django.contrib.auth import get_user_model
from django.urls import reverse
from django.conf import settings
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

    def _obtain_refresh_token_body(self):
        response = self.client.post(
            "/api/accounts/jwt/create/",
            {"email": self.user.email, "password": self.password},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data["refresh"]

    def _obtain_refresh_cookie(self):
        response = self.client.post(
            reverse("auth-login"),
            {"email": self.user.email, "password": self.password},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.cookies[settings.JWT_REFRESH_COOKIE].value

    def test_accounts_refresh_accepts_valid_token(self):
        refresh = self._obtain_refresh_token_body()
        response = self.client.post(
            "/api/accounts/jwt/refresh/",
            {"refresh": refresh},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

    def test_auth_refresh_alias_accepts_valid_token(self):
        refresh = self._obtain_refresh_cookie()
        response = self.client.post(
            "/api/auth/refresh/",
            {"refresh": refresh},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn(settings.JWT_ACCESS_COOKIE, response.cookies)
        self.assertIn(settings.JWT_REFRESH_COOKIE, response.cookies)

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
