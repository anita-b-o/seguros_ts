from datetime import date

from django.test import TestCase

from accounts.models import User
from products.models import Product
from policies.models import Policy
from policies.serializers import PolicySerializer
from vehicles.models import Vehicle


class PolicyVehicleReferenceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(dni="70010000", email="vehref@example.com", password="Pass1234")
        self.other_user = User.objects.create_user(dni="70010001", email="other@example.com", password="Pass1234")
        self.product = Product.objects.create(
            code="REF",
            name="Ref Plan",
            vehicle_type="AUTO",
            plan_type="TR",
            min_year=1990,
            max_year=2100,
            base_price=10000,
            coverages="",
        )
        self.vehicle = Vehicle.objects.create(
            owner=self.user,
            license_plate="XYZ999",
            vtype="AUTO",
            brand="Marca",
            model="Modelo",
            year=2023,
            use="Particular",
            fuel="Nafta",
        )
        self.vehicle_alt = Vehicle.objects.create(
            owner=self.user,
            license_plate="ALT123",
            vtype="AUTO",
            brand="Otra",
            model="Modelo",
            year=2022,
            use="Particular",
            fuel="Nafta",
        )
        self.foreign_vehicle = Vehicle.objects.create(
            owner=self.other_user,
            license_plate="XYZ888",
            vtype="AUTO",
            brand="Otra",
            model="Auto",
            year=2022,
            use="Particular",
            fuel="Nafta",
        )

    def _policy_data(self):
        return {
            "number": "SC-REF-1",
            "user_id": self.user.id,
            "product_id": self.product.id,
            "premium": 12000,
            "start_date": date.today(),
            "end_date": date.today(),
        }

    def test_serializer_outputs_vehicle_info_from_snapshot(self):
        data = self._policy_data()
        data["vehicle_id"] = self.vehicle.id
        serializer = PolicySerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        policy = serializer.save()
        serialized = PolicySerializer(policy).data
        self.assertEqual(serialized["vehicle"]["plate"], "XYZ999")
        self.assertEqual(serialized["vehicle"]["make"], "Marca")

    def test_snapshot_does_not_change_when_vehicle_updates(self):
        data = self._policy_data()
        data["vehicle_id"] = self.vehicle.id
        serializer = PolicySerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        policy = serializer.save()
        self.vehicle.brand = "Marca Actualizada"
        self.vehicle.save()
        data = PolicySerializer(policy).data
        self.assertEqual(data["vehicle"]["make"], "Marca")

    def test_serializer_rejects_vehicle_from_other_user(self):
        data = self._policy_data()
        data["vehicle_id"] = self.foreign_vehicle.id
        serializer = PolicySerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn("vehicle", serializer.errors)

    def test_serializer_creates_vehicle_from_plate(self):
        data = self._policy_data()
        data["vehicle"] = {
            "plate": "abc123 ",
            "make": "Nueva",
            "model": "Modelo",
            "year": 2021,
        }
        serializer = PolicySerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        policy = serializer.save()
        self.assertIsNotNone(policy.vehicle)
        self.assertEqual(policy.vehicle.owner_id, self.user.id)
        self.assertEqual(policy.vehicle.license_plate, "ABC123")
        self.assertIsNotNone(policy.legacy_vehicle)
        self.assertEqual(policy.legacy_vehicle.plate, "ABC123")

    def test_update_vehicle_id_does_not_overwrite_snapshot_for_active_policy(self):
        data = self._policy_data()
        data["vehicle_id"] = self.vehicle.id
        serializer = PolicySerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        policy = serializer.save()

        update = PolicySerializer(
            policy,
            data={"vehicle_id": self.vehicle_alt.id},
            partial=True,
        )
        self.assertTrue(update.is_valid(), update.errors)
        updated = update.save()
        updated.refresh_from_db()
        self.assertEqual(updated.vehicle_id, self.vehicle_alt.id)
        self.assertEqual(updated.legacy_vehicle.plate, "XYZ999")
