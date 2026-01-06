import json
from unittest import mock

from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, override_settings

from common.middlewares import AccessLogMiddleware, RequestIDMiddleware, access_logger


class ObservabilityMiddlewareTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def _build_middleware(self, status_code: int = 200):
        def dummy_view(_: object):
            return HttpResponse(status=status_code)

        return RequestIDMiddleware(AccessLogMiddleware(dummy_view))

    def test_request_without_header_generates_request_id_and_logs_it(self):
        middleware = self._build_middleware()
        request = self.factory.get("/api/observability")
        with mock.patch.object(access_logger, "info") as info_mock:
            response = middleware(request)

        self.assertIn("X-Request-ID", response)
        info_mock.assert_called_once()
        extra = info_mock.call_args.kwargs.get("extra", {})
        self.assertEqual(extra["request_id"], response["X-Request-ID"])
        self.assertIn("duration_ms", extra)

    def test_request_with_header_preserves_request_id(self):
        middleware = self._build_middleware()
        request = self.factory.get("/api/observability", HTTP_X_REQUEST_ID="custom-id-123")
        with mock.patch.object(access_logger, "info") as info_mock:
            response = middleware(request)

        self.assertEqual(response["X-Request-ID"], "custom-id-123")
        extra = info_mock.call_args.kwargs.get("extra", {})
        self.assertEqual(extra["request_id"], "custom-id-123")

    def test_invalid_header_is_ignored_and_new_id_is_generated(self):
        middleware = self._build_middleware()
        invalid_value = "bad id!!!"  # spaces and exclamation mark invalid per charset
        request = self.factory.get("/api/observability", HTTP_X_REQUEST_ID=invalid_value)
        with mock.patch.object(access_logger, "info") as info_mock:
            response = middleware(request)

        self.assertNotEqual(response["X-Request-ID"], invalid_value)
        extra = info_mock.call_args.kwargs.get("extra", {})
        self.assertEqual(extra["request_id"], response["X-Request-ID"])

    def test_access_log_includes_duration_ms(self):
        middleware = self._build_middleware(status_code=418)
        request = self.factory.post("/api/observability")
        with mock.patch.object(access_logger, "info") as info_mock:
            _ = middleware(request)

        self.assertTrue(info_mock.called)
        extra = info_mock.call_args.kwargs.get("extra", {})
        self.assertIn("duration_ms", extra)
        self.assertIsInstance(extra["duration_ms"], float)
        self.assertGreaterEqual(extra["duration_ms"], 0)

    @override_settings(TRUSTED_PROXY_IPS=["127.0.0.1"])
    def test_route_and_view_names_are_logged_when_available(self):
        middleware = self._build_middleware()
        request = self.factory.get("/api/observability")
        request.META["HTTP_X_FORWARDED_FOR"] = " 1.2.3.4 , 5.6.7.8"
        resolver_match = mock.Mock(route="api/observability-route", view_name="observability_view")
        request.resolver_match = resolver_match
        with mock.patch.object(access_logger, "info") as info_mock:
            _ = middleware(request)

        extra = info_mock.call_args.kwargs.get("extra", {})
        self.assertEqual(extra["route"], "api/observability-route")
        self.assertEqual(extra["view"], "observability_view")
        self.assertEqual(extra["client_ip"], "1.2.3.4")

    @override_settings(TRUSTED_PROXY_IPS=["127.0.0.1"])
    def test_remote_trusted_proxy_uses_forwarded_header(self):
        middleware = self._build_middleware()
        request = self.factory.get("/api/observability", HTTP_X_FORWARDED_FOR=" 9.9.9.9 , 10.0.0.1")
        request.META["REMOTE_ADDR"] = "127.0.0.1"
        with mock.patch.object(access_logger, "info") as info_mock:
            _ = middleware(request)

        extra = info_mock.call_args.kwargs.get("extra", {})
        self.assertEqual(extra["client_ip"], "9.9.9.9")

    @override_settings(TRUSTED_PROXY_IPS=[])
    def test_remote_untrusted_ignore_forwarded_header(self):
        middleware = self._build_middleware()
        request = self.factory.get("/api/observability", HTTP_X_FORWARDED_FOR=" 9.9.9.9 , 10.0.0.1")
        request.META["REMOTE_ADDR"] = "8.8.8.8"
        with mock.patch.object(access_logger, "info") as info_mock:
            _ = middleware(request)

        extra = info_mock.call_args.kwargs.get("extra", {})
        self.assertEqual(extra["client_ip"], "8.8.8.8")

    @override_settings(DEBUG=True)
    def test_large_payload_is_truncated(self):
        middleware = self._build_middleware()
        payload_body = json.dumps({"value": "ok"}) + (" " * 5000)
        request = self.factory.post(
            "/api/observability",
            data=payload_body,
            content_type="application/json",
        )
        with mock.patch.object(access_logger, "info") as info_mock:
            _ = middleware(request)

        extra = info_mock.call_args.kwargs.get("extra", {})
        self.assertIn("payload", extra)
        self.assertTrue(extra.get("payload_truncated"))

    @override_settings(DEBUG=True)
    def test_non_json_payload_is_skipped(self):
        middleware = self._build_middleware()
        request = self.factory.post(
            "/api/observability",
            data="plain text body",
            content_type="text/plain",
        )
        with mock.patch.object(access_logger, "info") as info_mock:
            _ = middleware(request)

        extra = info_mock.call_args.kwargs.get("extra", {})
        self.assertNotIn("payload", extra)
        self.assertNotIn("payload_truncated", extra)
