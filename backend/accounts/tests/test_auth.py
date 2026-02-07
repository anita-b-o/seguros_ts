import os
import unittest
from unittest.mock import patch

from django.urls import reverse
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from accounts import auth_views


User = get_user_model()
GOOGLE_AUTH_AVAILABLE = getattr(auth_views, "GOOGLE_AUTH_AVAILABLE", False)


class AuthTests(APITestCase):
    def setUp(self):
        self.password = "StrongPass123"
        self.user = User.objects.create_user(
            dni="10000000",
            email="active@example.com",
            password=self.password,
            first_name="Active",
            last_name="User",
        )
        self.inactive = User.objects.create_user(
            dni="20000000",
            email="inactive@example.com",
            password=self.password,
            first_name="Inactive",
            last_name="User",
            is_active=False,
        )

    def test_login_success(self):
        url = reverse("auth-login")
        res = self.client.post(url, {"email": self.user.email, "password": self.password})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["user"]["email"], self.user.email)
        self.assertIn(settings.JWT_ACCESS_COOKIE, res.cookies)
        self.assertIn(settings.JWT_REFRESH_COOKIE, res.cookies)

    def test_login_inactive_user_blocked(self):
        url = reverse("auth-login")
        res = self.client.post(url, {"email": self.inactive.email, "password": self.password})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data.get("detail"), "La cuenta está inactiva. Contactá al administrador.")

    def test_lookup_endpoint_removed(self):
        urls = [
            "/api/users/lookup?email=active@example.com",
            "/api/users/lookup?email=nobody@example.com",
            "/api/users/lookup",
        ]
        for url in urls:
            res = self.client.get(url)
            self.assertEqual(res.status_code, 410)
            self.assertEqual(res.data.get("detail"), "Endpoint deprecated.")

    def test_google_status_flag_off(self):
        url = reverse("auth-google-status")
        with patch.dict(os.environ, {"ENABLE_GOOGLE_LOGIN": "false"}):
            res = self.client.get(url)
        self.assertEqual(res.status_code, 404)
        self.assertIn("detail", res.data)

    def test_google_status_flag_on_reports_config(self):
        url = reverse("auth-google-status")
        env = {"ENABLE_GOOGLE_LOGIN": "true", "GOOGLE_CLIENT_ID": "test-client"}
        with patch.dict(os.environ, env):
            res = self.client.get(url)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data.get("google_login_enabled"))
        self.assertTrue(res.data.get("google_client_id_configured"))
        self.assertEqual(res.data.get("google_auth_available"), GOOGLE_AUTH_AVAILABLE)

    def test_google_login_feature_flag_off(self):
        """
        El endpoint debe actuar como no existente si la feature flag está apagada.
        """
        url = reverse("auth-google")
        with patch.dict(os.environ, {"ENABLE_GOOGLE_LOGIN": "false"}):
            res = self.client.post(url, {"id_token": "nope"})
        self.assertEqual(res.status_code, 404)
        self.assertIn("detail", res.data)

    def test_google_import_placeholders_present(self):
        # Asegura que, incluso si google-auth no está instalado, las variables existen.
        self.assertTrue(hasattr(auth_views, "GOOGLE_AUTH_AVAILABLE"))
        self.assertTrue(hasattr(auth_views, "google_id_token"))
        self.assertTrue(hasattr(auth_views, "google_auth_requests"))
        self.assertTrue(hasattr(auth_views, "google_auth_exceptions"))

    def test_google_login_dependencies_missing(self):
        url = reverse("auth-google")
        env = {"ENABLE_GOOGLE_LOGIN": "true", "GOOGLE_CLIENT_ID": "test-client"}
        with patch.dict(os.environ, env):
            with patch.object(auth_views, "GOOGLE_AUTH_AVAILABLE", False):
                res = self.client.post(url, {"id_token": "stub"})
        self.assertEqual(res.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(res.data.get("detail"), "Google auth dependencies not installed")

    @unittest.skipUnless(GOOGLE_AUTH_AVAILABLE, "requires google-auth")
    def test_google_login_rejects_invalid_token(self):
        url = reverse("auth-google")
        env = {"ENABLE_GOOGLE_LOGIN": "true", "GOOGLE_CLIENT_ID": "test-client"}
        with patch.dict(os.environ, env):
            with patch("accounts.auth_views.google_id_token.verify_oauth2_token", side_effect=ValueError("invalid")):
                res = self.client.post(url, {"id_token": "bad"})
        self.assertEqual(res.status_code, 401)
        self.assertIn("detail", res.data)

    @unittest.skipUnless(GOOGLE_AUTH_AVAILABLE, "requires google-auth")
    def test_google_login_creates_and_syncs_user(self):
        url = reverse("auth-google")
        env = {
            "ENABLE_GOOGLE_LOGIN": "true",
            "GOOGLE_CLIENT_ID": "test-client.apps.googleusercontent.com",
        }
        base_payload = {
            "iss": "https://accounts.google.com",
            "aud": env["GOOGLE_CLIENT_ID"],
            "email": "google-user@example.com",
            "email_verified": True,
            "sub": "google-sub-123",
            "given_name": "Google",
            "family_name": "User",
            "name": "Google User",
            "picture": "https://example.com/pic.png",
        }
        with patch.dict(os.environ, env):
            with patch("accounts.auth_views.google_id_token.verify_oauth2_token") as mock_verify:
                mock_verify.return_value = base_payload
                res = self.client.post(url, {"id_token": "ok"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["user"]["email"], base_payload["email"])
        self.assertIn(settings.JWT_ACCESS_COOKIE, res.cookies)
        self.assertIn(settings.JWT_REFRESH_COOKIE, res.cookies)

        user = User.objects.get(email=base_payload["email"])
        self.assertEqual(user.dni, "ggoogle-sub-123")
        self.assertEqual(user.first_name, base_payload["given_name"])
        self.assertEqual(user.last_name, base_payload["family_name"])

        # Reejecutamos con nombres nuevos para verificar sync.
        updated_payload = {**base_payload, "given_name": "Googleia", "family_name": "Sync"}
        with patch.dict(os.environ, env):
            with patch("accounts.auth_views.google_id_token.verify_oauth2_token") as mock_verify:
                mock_verify.return_value = updated_payload
                res2 = self.client.post(url, {"id_token": "ok"})
        self.assertEqual(res2.status_code, 200)
        user.refresh_from_db()
        self.assertEqual(user.first_name, updated_payload["given_name"])
        self.assertEqual(user.last_name, updated_payload["family_name"])


class AdminUserCreationTests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            dni="99999999",
            email="admin@example.com",
            password="AdminPass123",
            first_name="Admin",
            last_name="User",
        )
        self.client.force_authenticate(user=self.admin)

    def test_admin_creates_user_with_hashed_password(self):
        payload = {
            "dni": "30000000",
            "email": "newuser@example.com",
            "first_name": "New",
            "last_name": "User",
            "password": "UserPass123",
        }
        res = self.client.post("/api/admin/users", payload, format="json")
        self.assertEqual(res.status_code, 201)
        user = User.objects.get(email=payload["email"])
        # contraseña debe estar hasheada y check_password debe validar
        self.assertNotEqual(user.password, payload["password"])
        self.assertTrue(user.check_password(payload["password"]))


class TokenRotationLogoutTests(APITestCase):
    def setUp(self):
        self.password = "StrongPass123"
        self.user = User.objects.create_user(
            dni="40000000",
            email="rotate@example.com",
            password=self.password,
            first_name="Rotate",
            last_name="User",
        )

    def _get_tokens(self):
        url = reverse("auth-login")
        res = self.client.post(url, {"email": self.user.email, "password": self.password})
        self.assertEqual(res.status_code, 200)
        return res.cookies

    def test_refresh_rotation_blacklists_old_token(self):
        cookies = self._get_tokens()
        old_refresh = cookies[settings.JWT_REFRESH_COOKIE].value
        refresh_url = reverse("auth-refresh")

        res = self.client.post(refresh_url, {"refresh": old_refresh})
        self.assertEqual(res.status_code, 200)
        new_refresh = res.cookies[settings.JWT_REFRESH_COOKIE].value
        self.assertNotEqual(old_refresh, new_refresh)

        retry = self.client.post(refresh_url, {"refresh": old_refresh})
        self.assertEqual(retry.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_blacklists_refresh(self):
        cookies = self._get_tokens()
        refresh_url = reverse("auth-refresh")
        refresh_token = cookies[settings.JWT_REFRESH_COOKIE].value
        self.client.cookies[settings.JWT_ACCESS_COOKIE] = cookies[settings.JWT_ACCESS_COOKIE].value

        logout_url = reverse("auth-logout")
        res = self.client.post(logout_url, {"refresh": refresh_token})
        self.assertEqual(res.status_code, status.HTTP_205_RESET_CONTENT)

        retry = self.client.post(refresh_url, {"refresh": refresh_token})
        self.assertEqual(retry.status_code, status.HTTP_401_UNAUTHORIZED)
