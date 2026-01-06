from rest_framework.test import APITestCase

from accounts.models import User


class JwtEmailLoginTests(APITestCase):
    def test_jwt_login_email_ok(self):
        User.objects.create_user(dni="99000002", email="user@seguros.test", password="User12345!")
        res = self.client.post(
            "/api/accounts/jwt/create/",
            {"email": "user@seguros.test", "password": "User12345!"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("access", res.data)
        self.assertIn("refresh", res.data)

    def test_jwt_login_dni_rejected(self):
        User.objects.create_user(dni="99000002", email="user@seguros.test", password="User12345!")
        res = self.client.post(
            "/api/accounts/jwt/create/",
            {"email": "99000002", "password": "User12345!"},
            format="json",
        )
        self.assertIn(res.status_code, (400, 401))
