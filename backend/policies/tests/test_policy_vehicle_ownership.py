from datetime import date

from django.urls import reverse
from rest_framework.test import APIClient, APITestCase

from accounts.models import User
from products.models import Product
from policies.models import Policy
from policies.serializers import VEHICLE_OWNER_MISMATCH_ERROR
from vehicles.models import Vehicle


class PolicyVehicleOwnershipAPITests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            dni="80000001",
            email="admin@example.com",
            password="AdminPass123",
            is_staff=True,
            is_superuser=True,
        )
        self.user_a = User.objects.create_user(
            dni="80000002",
            email="owner@example.com",
            password="OwnerPass123",
        )
        self.user_b = User.objects.create_user(
            dni="80000003",
            email="other@example.com",
            password="OtherPass123",
        )
        self.product = Product.objects.create(
            code="OWNPRO",
            name="Ownership Plan",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=2000,
            max_year=2100,
            base_price=10000,
            coverages="Coberturas varias",
        )
        self.vehicle_a = Vehicle.objects.create(
            owner=self.user_a,
            license_plate="AAA111",
            vtype="AUTO",
            brand="Marca A",
            model="Modelo A",
            year=2022,
            use="Particular",
        )
        self.vehicle_b = Vehicle.objects.create(
            owner=self.user_b,
            license_plate="BBB222",
            vtype="AUTO",
            brand="Marca B",
            model="Modelo B",
            year=2021,
            use="Particular",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)
        self._sequence = 1

    def _next_number(self):
        number = f"SC-OWN-{self._sequence}"
        self._sequence += 1
        return number

    def _base_payload(self, overrides=None):
        payload = {
            "number": self._next_number(),
            "product_id": self.product.id,
            "premium": 15000,
            "start_date": date.today().isoformat(),
            "end_date": date.today().isoformat(),
        }
        if overrides:
            payload.update(overrides)
        return payload

    def test_create_policy_rejects_foreign_vehicle(self):
        payload = self._base_payload(
            {"user_id": self.user_a.id, "vehicle_id": self.vehicle_b.id}
        )
        response = self.client.post(reverse("policies-list"), payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("vehicle", response.data)
        self.assertEqual(
            response.data["vehicle"][0],
            VEHICLE_OWNER_MISMATCH_ERROR,
        )

    def test_update_policy_rejects_foreign_vehicle(self):
        policy = Policy.objects.create(
            number=self._next_number(),
            user=self.user_a,
            product=self.product,
            premium=11000,
            start_date=date.today(),
            end_date=date.today(),
            vehicle=self.vehicle_a,
        )
        response = self.client.patch(
            reverse("policies-detail", args=[policy.id]),
            {"vehicle_id": self.vehicle_b.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("vehicle", response.data)
        self.assertEqual(
            response.data["vehicle"][0],
            VEHICLE_OWNER_MISMATCH_ERROR,
        )

    def test_create_policy_allows_owned_vehicle(self):
        payload = self._base_payload(
            {"user_id": self.user_a.id, "vehicle_id": self.vehicle_a.id}
        )
        response = self.client.post(reverse("policies-list"), payload, format="json")
        self.assertEqual(response.status_code, 201)
        policy = Policy.objects.get(id=response.data["id"])
        self.assertEqual(policy.vehicle.owner_id, policy.user_id)
        self.assertIsNotNone(policy.legacy_vehicle)
        self.assertEqual(policy.legacy_vehicle.plate, self.vehicle_a.license_plate)

    def test_create_policy_without_user_id_rejects_foreign_vehicle(self):
        self.user_a.is_staff = True
        self.user_a.save(update_fields=["is_staff"])
        self.client.force_authenticate(user=self.user_a)
        payload = self._base_payload({"vehicle_id": self.vehicle_b.id})
        response = self.client.post(reverse("policies-list"), payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("vehicle", response.data)
        self.assertEqual(response.data["vehicle"][0], VEHICLE_OWNER_MISMATCH_ERROR)
