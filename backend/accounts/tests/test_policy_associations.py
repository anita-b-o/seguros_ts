from datetime import date

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase, APIClient

from policies.models import Policy

User = get_user_model()


class AdminPolicyUserAssociationTests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            dni="90000010",
            email="admin-policy-user@example.com",
            password="AdminPass123",
            is_staff=True,
        )
        self.user_one = User.objects.create_user(
            dni="90000011",
            email="user-one@example.com",
            password="UserPass123",
        )
        self.user_two = User.objects.create_user(
            dni="90000012",
            email="user-two@example.com",
            password="UserPass123",
        )
        self.policy = Policy.objects.create(
            number="SC-ADMIN-001",
            premium=12000,
            status="active",
            start_date=date.today(),
            end_date=date.today(),
        )

    def test_admin_patch_policy_user_id_and_null(self):
        self.client.force_authenticate(user=self.admin)
        url = f"/api/admin/policies/policies/{self.policy.id}/"

        resp = self.client.patch(url, {"user_id": self.user_one.id}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.policy.refresh_from_db()
        self.assertEqual(self.policy.user_id, self.user_one.id)

        resp = self.client.patch(url, {"user_id": None}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.policy.refresh_from_db()
        self.assertIsNone(self.policy.user_id)


class AdminUserPoliciesEndpointsTests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            dni="90000020",
            email="admin-users-policy@example.com",
            password="AdminPass123",
            is_staff=True,
        )
        self.user = User.objects.create_user(
            dni="90000021",
            email="client-a@example.com",
            password="UserPass123",
        )
        self.other_user = User.objects.create_user(
            dni="90000022",
            email="client-b@example.com",
            password="UserPass123",
        )
        self.policy_a = Policy.objects.create(
            number="SC-ADMIN-010",
            premium=10000,
            status="active",
            start_date=date.today(),
            end_date=date.today(),
            user=self.user,
            holder_dni=self.user.dni,
        )
        self.policy_b = Policy.objects.create(
            number="SC-ADMIN-011",
            premium=11000,
            status="active",
            start_date=date.today(),
            end_date=date.today(),
            user=self.other_user,
            holder_dni=self.other_user.dni,
        )

    def test_admin_user_policies_get_post_delete(self):
        self.client.force_authenticate(user=self.admin)

        list_url = f"/api/admin/accounts/users/{self.user.id}/policies/"
        resp = self.client.get(list_url)
        self.assertEqual(resp.status_code, 200)
        ids = [item.get("id") for item in resp.data]
        self.assertIn(self.policy_a.id, ids)
        self.assertNotIn(self.policy_b.id, ids)
        self.assertTrue(any(item.get("policy_number") == self.policy_a.number for item in resp.data))

        attach_resp = self.client.post(list_url, {"policy_id": self.policy_b.id}, format="json")
        self.assertEqual(attach_resp.status_code, 200)
        self.policy_b.refresh_from_db()
        self.assertEqual(self.policy_b.user_id, self.user.id)

        detach_url = f"/api/admin/accounts/users/{self.user.id}/policies/{self.policy_b.id}/"
        detach_resp = self.client.delete(detach_url)
        self.assertEqual(detach_resp.status_code, 204)
        self.policy_b.refresh_from_db()
        self.assertIsNone(self.policy_b.user_id)


class UserSelfAssociatePolicyTests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            dni="90000030",
            email="self-user@example.com",
            password="UserPass123",
        )
        self.other_user = User.objects.create_user(
            dni="90000031",
            email="other-user@example.com",
            password="UserPass123",
        )
        self.available_policy = Policy.objects.create(
            number="SC-ME-001",
            premium=9000,
            status="active",
            start_date=date.today(),
            end_date=date.today(),
            holder_dni=self.user.dni,
        )
        self.assigned_policy = Policy.objects.create(
            number="SC-ME-002",
            premium=9500,
            status="active",
            start_date=date.today(),
            end_date=date.today(),
            holder_dni=self.other_user.dni,
            user=self.other_user,
        )

    def test_associate_policy_success(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.post(
            "/api/accounts/users/me/policies/associate",
            {"policy_number": self.available_policy.number},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.available_policy.refresh_from_db()
        self.assertEqual(self.available_policy.user_id, self.user.id)
        self.assertIn("policy", resp.data)

    def test_associate_policy_conflict(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.post(
            "/api/accounts/users/me/policies/associate",
            {"policy_number": self.assigned_policy.number},
            format="json",
        )
        self.assertEqual(resp.status_code, 409)
