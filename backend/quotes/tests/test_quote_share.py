import base64
from datetime import timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase


TINY_PNG = (
    # El fixture anterior tenía un checksum inválido y PIL lo rechazaba (bad header checksum en IDAT).
    # Usamos un PNG rojo 1x1 generado correctamente para no relajar DataURLImageField en producción.
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)


class QuoteShareTests(APITestCase):
    def _valid_payload(self, photos, expires_at=None):
        payload = {
            "plan_code": "TEST",
            "plan_name": "Test Plan",
            "phone": "123456789",
            "make": "VW",
            "model": "Gol",
            "version": "1.6",
            "year": 2020,
            "city": "La Plata",
            "has_garage": True,
            "is_zero_km": False,
            "usage": "privado",
            "has_gnc": False,
            "photos": photos,
        }
        if expires_at is not None:
            payload["expires_at"] = expires_at
        return payload

    def _create_share(self, expires_at=None):
        payload = self._valid_payload(
            {
                "front": TINY_PNG,
                "back": TINY_PNG,
                "right": TINY_PNG,
                "left": TINY_PNG,
            },
            expires_at=expires_at,
        )
        res = self.client.post("/api/quotes/share", payload, format="json")
        self.assertEqual(res.status_code, 201)
        return res.data["token"]

    def test_quote_share_upload_ok(self):
        payload = self._valid_payload(
            {"front": TINY_PNG, "back": TINY_PNG, "right": TINY_PNG, "left": TINY_PNG}
        )
        res = self.client.post("/api/quotes/share", payload, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertIn("token", res.data)

    def test_quote_share_rejects_oversized_image(self):
        big_bytes = b"a" * (6 * 1024 * 1024)  # 6MB
        big_b64 = base64.b64encode(big_bytes).decode()
        big_data_url = f"data:image/png;base64,{big_b64}"
        payload = self._valid_payload(
            {"front": big_data_url, "back": TINY_PNG, "right": TINY_PNG, "left": TINY_PNG}
        )
        res = self.client.post("/api/quotes/share", payload, format="json")
        self.assertEqual(res.status_code, 400)

    def test_quote_share_detail_returns_410_when_expired(self):
        expires_at = timezone.now() - timedelta(minutes=5)
        token = self._create_share(expires_at=expires_at)

        res = self.client.get(f"/api/quotes/share/{token}")
        self.assertEqual(res.status_code, status.HTTP_410_GONE)

    def test_quote_share_detail_returns_200_when_valid(self):
        expires_at = timezone.now() + timedelta(days=1)
        token = self._create_share(expires_at=expires_at)

        res = self.client.get(f"/api/quotes/share/{token}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["token"], token)

    def test_quote_share_detail_works_with_null_expiration(self):
        token = self._create_share()

        res = self.client.get(f"/api/quotes/share/{token}")
        self.assertEqual(res.status_code, 200)
