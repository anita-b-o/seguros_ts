from rest_framework.test import APITestCase


class HealthcheckSingularEndpointTests(APITestCase):
    def test_healthz_accepts_slash_and_no_slash(self):
        response_with_slash = self.client.get("/healthz/")
        response_without_slash = self.client.get("/healthz")

        self.assertEqual(response_with_slash.status_code, 200)
        self.assertEqual(response_without_slash.status_code, 200)
        self.assertEqual(
            response_with_slash.json(), response_without_slash.json()
        )
        self.assertEqual(response_with_slash.json(), {"status": "ok"})
