from unittest.mock import patch

from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.urls import reverse
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from django.contrib.auth import get_user_model

from accounts import auth_views
from accounts.utils import otp as otp_utils

User = get_user_model()


class OTPTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.password = "StrongPass123"
        self.staff = User.objects.create_user(
            dni="11000000",
            email="staff@example.com",
            password=self.password,
            first_name="Staff",
            last_name="Member",
            is_staff=True,
        )
        self.admin = User.objects.create_superuser(
            dni="99000000",
            email="admin@example.com",
            password=self.password,
            first_name="Admin",
            last_name="User",
        )
        self.onboard_user = User.objects.create_user(
            dni="12000000",
            email="onboard@example.com",
            password="OtherPass123",
            first_name="Onboard",
            last_name="User",
        )
        self.login_url = reverse("auth-login")
        self.resend_url = reverse("auth-onboarding-resend")

    def tearDown(self):
        cache.clear()

    @override_settings(
        OTP_PEPPER="test-pepper",
        OTP_RATE_LIMIT_SEND_COUNT=10,
        OTP_RATE_LIMIT_SEND_WINDOW=600,
        OTP_RATE_LIMIT_VERIFY_COUNT=10,
        OTP_RATE_LIMIT_VERIFY_WINDOW=600,
    )
    def test_onboarding_otp_stored_hashed(self):
        self.client.force_authenticate(user=self.admin)
        try:
            with patch("accounts.auth_views.generate_otp", return_value="222222"), patch(
                "accounts.auth_views._send_email_code"
            ):
                response = self.client.post(self.resend_url, {"email": self.onboard_user.email})
        finally:
            self.client.force_authenticate(user=None)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = cache.get(f"onboarding_otp:{self.onboard_user.id}")
        self.assertIsInstance(payload, dict)
        self.assertIn("hash", payload)
        self.assertIn("salt", payload)
        self.assertNotEqual(payload["hash"], "222222")
        self.assertEqual(payload["attempts"], 0)

    @override_settings(
        OTP_PEPPER="test-pepper",
        OTP_RATE_LIMIT_SEND_COUNT=10,
        OTP_RATE_LIMIT_SEND_WINDOW=600,
        OTP_RATE_LIMIT_VERIFY_COUNT=20,
        OTP_RATE_LIMIT_VERIFY_WINDOW=600,
        OTP_VERIFY_MAX_ATTEMPTS=5,
    )
    def test_admin_login_otp_verification_succeeds(self):
        with patch("accounts.auth_views.generate_otp", return_value="111111"), patch(
            "accounts.auth_views._send_email_code"
        ):
            send_response = self.client.post(
                self.login_url, {"email": self.staff.email, "password": self.password}
            )
        self.assertEqual(send_response.status_code, status.HTTP_202_ACCEPTED)

        with patch("accounts.auth_views._send_email_code"):
            verify_response = self.client.post(
                self.login_url,
                {"email": self.staff.email, "password": self.password, "otp": "111111"},
            )
        self.assertEqual(verify_response.status_code, status.HTTP_200_OK)
        self.assertIn("access", verify_response.data)

    @override_settings(
        OTP_PEPPER="test-pepper",
        OTP_RATE_LIMIT_SEND_COUNT=10,
        OTP_RATE_LIMIT_SEND_WINDOW=600,
        OTP_RATE_LIMIT_VERIFY_COUNT=50,
        OTP_RATE_LIMIT_VERIFY_WINDOW=600,
        OTP_VERIFY_MAX_ATTEMPTS=5,
    )
    def test_admin_login_otp_invalid_attempts_lock(self):
        with patch("accounts.auth_views.generate_otp", return_value="333333"), patch(
            "accounts.auth_views._send_email_code"
        ):
            self.client.post(self.login_url, {"email": self.staff.email, "password": self.password})

        for attempt in range(4):
            response = self.client.post(
                self.login_url,
                {"email": self.staff.email, "password": self.password, "otp": "000000"},
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        payload = cache.get(f"admin_otp:{self.staff.id}")
        self.assertEqual(payload["attempts"], 4)

        final = self.client.post(
            self.login_url,
            {"email": self.staff.email, "password": self.password, "otp": "000000"},
        )
        self.assertEqual(final.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIsNone(cache.get(f"admin_otp:{self.staff.id}"))

    @override_settings(
        OTP_PEPPER="test-pepper",
        OTP_RATE_LIMIT_SEND_COUNT=2,
        OTP_RATE_LIMIT_SEND_WINDOW=600,
        OTP_RATE_LIMIT_VERIFY_COUNT=20,
        OTP_RATE_LIMIT_VERIFY_WINDOW=600,
    )
    def test_admin_login_otp_send_rate_limited(self):
        with patch("accounts.auth_views.generate_otp", return_value="444444"), patch(
            "accounts.auth_views._send_email_code"
        ):
            first = self.client.post(
                self.login_url, {"email": self.staff.email, "password": self.password}
            )
        self.assertEqual(first.status_code, status.HTTP_202_ACCEPTED)
        with patch("accounts.auth_views.generate_otp", return_value="555555"), patch(
            "accounts.auth_views._send_email_code"
        ):
            second = self.client.post(
                self.login_url, {"email": self.staff.email, "password": self.password}
            )
        self.assertEqual(second.status_code, status.HTTP_202_ACCEPTED)

        third = self.client.post(
            self.login_url, {"email": self.staff.email, "password": self.password}
        )
        self.assertEqual(third.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    @override_settings(DEBUG=False)
    def test_otp_rate_limit_cache_failure_returns_503(self):
        with patch(
            "accounts.auth_views._increment_rate_counter",
            side_effect=auth_views.CacheUnavailable("cache down"),
        ):
            response = self.client.post(self.login_url, {"email": self.staff.email, "password": self.password})
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    @override_settings(DEBUG=False, FRONTEND_ORIGINS=[], FRONTEND_ORIGIN="")
    def test_reset_link_requires_frontend_origin_in_prod(self):
        user = User.objects.create_user(
            dni="22000000",
            email="reset@example.com",
            password="ResetPass123",
            first_name="Reset",
            last_name="User",
        )
        with self.assertRaises(ImproperlyConfigured):
            auth_views._build_reset_link(user)

    @override_settings(DEBUG=True, FRONTEND_ORIGINS=[], FRONTEND_ORIGIN="")
    def test_reset_link_allows_localhost_in_debug(self):
        user = User.objects.create_user(
            dni="23000000",
            email="local@example.com",
            password="LocalPass123",
            first_name="Local",
            last_name="User",
        )
        link = auth_views._build_reset_link(user)
        self.assertIn("http://localhost:5173/reset/confirm", link)

    def test_otp_hash_reflects_pepper_setting(self):
        salt = "pepper-test-salt"
        otp_value = "009988"
        with override_settings(OTP_PEPPER="pepper-a"):
            hash_a = otp_utils.otp_hash(otp_value, salt)
        with override_settings(OTP_PEPPER="pepper-b"):
            hash_b = otp_utils.otp_hash(otp_value, salt)
        self.assertNotEqual(hash_a, hash_b)
