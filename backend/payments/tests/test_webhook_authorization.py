from django.test import override_settings
from rest_framework.test import APIRequestFactory, APITestCase

from payments.views import _authorize_mp_webhook


class MpWebhookAuthorizationTests(APITestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    @override_settings(DEBUG=False, MP_WEBHOOK_SECRET="", MP_ALLOW_WEBHOOK_NO_SECRET=False)
    def test_missing_secret_in_production_returns_500(self):
        request = self.factory.post("/api/payments/webhook", {})
        ok, detail, status_code = _authorize_mp_webhook(request)
        self.assertFalse(ok)
        self.assertEqual(status_code, 500)
        self.assertIn("MP_WEBHOOK_SECRET is required", detail)

    @override_settings(
        DEBUG=True,
        MP_WEBHOOK_SECRET="",
        MP_ALLOW_WEBHOOK_NO_SECRET=True,
    )
    def test_debug_allows_missing_secret_with_flag(self):
        request = self.factory.post("/api/payments/webhook", {})
        ok, detail, status_code = _authorize_mp_webhook(request)
        self.assertTrue(ok)
        self.assertEqual(status_code, 200)
        self.assertIn("sin validar firma", detail)

    @override_settings(DEBUG=False, MP_WEBHOOK_SECRET="test-secret")
    def test_accepts_matching_signature(self):
        request = self.factory.post(
            "/api/payments/webhook",
            {},
            HTTP_X_MP_SIGNATURE="test-secret",
        )
        ok, detail, status_code = _authorize_mp_webhook(request)
        self.assertTrue(ok)
        self.assertEqual(status_code, 200)

    @override_settings(DEBUG=False, MP_WEBHOOK_SECRET="test-secret")
    def test_missing_signature_returns_403(self):
        request = self.factory.post("/api/payments/webhook", {})
        ok, detail, status_code = _authorize_mp_webhook(request)
        self.assertFalse(ok)
        self.assertEqual(status_code, 403)
        self.assertIn("Authorization Bearer", detail)

    @override_settings(DEBUG=False, MP_WEBHOOK_SECRET="test-secret")
    def test_invalid_signature_returns_403(self):
        request = self.factory.post(
            "/api/payments/webhook",
            {},
            HTTP_X_MP_SIGNATURE="wrong-secret",
        )
        ok, detail, status_code = _authorize_mp_webhook(request)
        self.assertFalse(ok)
        self.assertEqual(status_code, 403)
        self.assertIn("Firma inválida", detail)

    @override_settings(DEBUG=False, MP_WEBHOOK_SECRET="test-secret")
    def test_accepts_authorization_header(self):
        request = self.factory.post(
            "/api/payments/webhook",
            {},
            HTTP_AUTHORIZATION="Bearer test-secret",
        )
        ok, detail, status_code = _authorize_mp_webhook(request)
        self.assertTrue(ok)
        self.assertEqual(status_code, 200)
