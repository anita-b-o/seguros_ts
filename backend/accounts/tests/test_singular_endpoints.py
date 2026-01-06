import os

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

User = get_user_model()


class UsersMeSingularEndpointTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            dni="70000001",
            email="singular@example.com",
            password="UserPass321",
            first_name="Singular",
            last_name="User",
        )
        self.client.force_authenticate(user=self.user)

    def test_users_me_trailing_slash_matches_payload(self):
        base_url = "/api/accounts/users/me"
        with_slash = f"{base_url}/"

        response_base = self.client.get(base_url)
        response_slash = self.client.get(with_slash)

        self.assertEqual(response_base.status_code, 200)
        self.assertEqual(response_slash.status_code, 200)
        self.assertEqual(response_base.data, response_slash.data)
        self.assertEqual(response_base.data["id"], self.user.id)
        self.assertEqual(response_base.data["email"], self.user.email)


class GoogleLoginStatusSingularEndpointTests(APITestCase):
    def setUp(self):
        os.environ.setdefault("ENABLE_GOOGLE_LOGIN", "true")
        os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client")

    def tearDown(self):
        os.environ.pop("ENABLE_GOOGLE_LOGIN", None)
        os.environ.pop("GOOGLE_CLIENT_ID", None)

    def test_google_status_accepts_both_slashes(self):
        base_url = "/api/auth/google/status"
        with_slash = f"{base_url}/"

        response_base = self.client.get(base_url)
        response_slash = self.client.get(with_slash)

        self.assertEqual(response_base.status_code, 200)
        self.assertEqual(response_slash.status_code, 200)
        self.assertEqual(response_base.data, response_slash.data)
        self.assertTrue(response_base.data.get("google_login_enabled"))
        self.assertTrue(response_base.data.get("google_client_id_configured"))
