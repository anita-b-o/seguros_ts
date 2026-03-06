from unittest import mock

from django.test import override_settings
from rest_framework.test import APITestCase


class HealthcheckSingularEndpointTests(APITestCase):
    def test_healthz_accepts_slash_and_no_slash(self):
        response_with_slash = self.client.get("/healthz/")
        response_without_slash = self.client.get("/healthz")

        self.assertEqual(response_with_slash.status_code, 200)
        self.assertEqual(response_without_slash.status_code, 200)
        body = response_with_slash.json()
        body_no_slash = response_without_slash.json()
        self.assertEqual(body.get("status"), "ok")
        self.assertEqual(body_no_slash.get("status"), "ok")
        self.assertEqual(body.get("service"), body_no_slash.get("service"))
        self.assertIn("service", body)
        self.assertIn("timestamp", body)

    def test_liveness_endpoint_is_available(self):
        response = self.client.get("/api/health/live")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    @override_settings(HEALTHCHECK_INCLUDE_DETAILS=True, HEALTHCHECK_FAIL_OPEN=False)
    @mock.patch("seguros.urls.build_readiness_payload")
    def test_readiness_returns_503_when_dependency_fails(self, readiness_mock):
        readiness_mock.return_value = (
            {
                "service": "securests-api",
                "status": "degraded",
                "checks": {
                    "database": {"status": "error"},
                    "cache": {"status": "ok"},
                },
            },
            True,
        )
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "degraded")

    @override_settings(HEALTHCHECK_INCLUDE_DETAILS=True, HEALTHCHECK_FAIL_OPEN=True)
    @mock.patch("seguros.urls.build_readiness_payload")
    def test_readiness_fail_open_keeps_200(self, readiness_mock):
        readiness_mock.return_value = (
            {"service": "securests-api", "status": "degraded"},
            True,
        )
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "degraded")
