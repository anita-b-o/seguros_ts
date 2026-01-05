from datetime import date

from django.core.management import call_command
from django.test import TestCase

from accounts.models import User
from products.models import Product
from policies.models import Policy, PolicyVehicle
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

    def test_serializer_outputs_vehicle_info_from_vehicle_fk(self):
        policy = Policy.objects.create(
            user=self.user,
            number="SC-OUT-1",
            product=self.product,
            premium=12000,
            start_date=date.today(),
            end_date=date.today(),
            vehicle=self.vehicle,
        )
        serialized = PolicySerializer(policy).data
        self.assertEqual(serialized["vehicle"]["plate"], "XYZ999")
        self.assertEqual(serialized["vehicle"]["make"], "Marca")

    def test_serializer_reflects_vehicle_changes(self):
        policy = Policy.objects.create(
            user=self.user,
            number="SC-OUT-2",
            product=self.product,
            premium=12000,
            start_date=date.today(),
            end_date=date.today(),
            vehicle=self.vehicle,
        )
        self.vehicle.brand = "Marca Actualizada"
        self.vehicle.save()
        data = PolicySerializer(policy).data
        self.assertEqual(data["vehicle"]["make"], "Marca Actualizada")

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

    def test_seed_policies_links_vehicles_and_skips_policyvehicle(self):
        call_command("seed_policies", "--reset")
        self.assertEqual(PolicyVehicle.objects.count(), 0)
        self.assertTrue(Policy.objects.filter(vehicle__isnull=False).exists())
