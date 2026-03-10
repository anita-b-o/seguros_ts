from datetime import date

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase
from rest_framework.test import APITestCase, APIClient

from policies.billing import compute_term_end_date
from policies.models import Policy

from common.models import ContactInfo, AppSettings


User = get_user_model()


class ContactInfoViewTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            dni="90000000",
            email="admin-contact@example.com",
            password="AdminContact123",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_patch_contact_info_updates_fields_without_terms(self):
        payload = {"whatsapp": "new-whatsapp"}
        res = self.client.patch("/api/common/contact-info/", payload, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(ContactInfo.get_solo().whatsapp, "new-whatsapp")


class AppSettingsDefaultTermTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            dni="91000000",
            email="admin-settings@example.com",
            password="AdminSettings123",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)
        self.active_policy = Policy.objects.create(
            number="POL-TERM-1",
            start_date=date(2023, 1, 1),
            end_date=compute_term_end_date(date(2023, 1, 1), 3),
            status="active",
            default_term_months_snapshot=3,
        )
        self.cancelled_policy = Policy.objects.create(
            number="POL-TERM-2",
            start_date=date(2023, 1, 1),
            end_date=compute_term_end_date(date(2023, 1, 1), 3),
            status="cancelled",
            default_term_months_snapshot=3,
        )
        AppSettings.get_solo().default_term_months = 3
        AppSettings.get_solo().save()

    def test_default_term_change_does_not_recalculate_existing_policies(self):
        res = self.client.patch(
            "/api/common/admin/settings",
            {"default_term_months": 6},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.active_policy.refresh_from_db()
        self.cancelled_policy.refresh_from_db()
        self.assertEqual(self.active_policy.end_date, compute_term_end_date(self.active_policy.start_date, 3))
        self.assertEqual(self.cancelled_policy.end_date, compute_term_end_date(self.cancelled_policy.start_date, 3))
        self.assertEqual(self.active_policy.default_term_months_snapshot, 3)

    def test_admin_managed_policies_are_also_left_unchanged(self):
        res = self.client.patch(
            "/api/common/admin/settings",
            {"default_term_months": 4},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.cancelled_policy.refresh_from_db()
        self.active_policy.refresh_from_db()
        self.assertEqual(self.cancelled_policy.end_date, compute_term_end_date(self.cancelled_policy.start_date, 3))
        self.assertEqual(self.active_policy.end_date, compute_term_end_date(self.active_policy.start_date, 3))


class SingletonModelTests(TestCase):
    def test_contact_info_get_solo_is_idempotent(self):
        first = ContactInfo.get_solo()
        self.assertEqual(first.pk, ContactInfo.get_solo().pk)

    def test_contact_info_rejects_second_instance(self):
        ContactInfo.get_solo()
        with self.assertRaises(IntegrityError):
            ContactInfo.objects.create()

    def test_appsettings_get_solo_is_idempotent(self):
        first = AppSettings.get_solo()
        self.assertEqual(first.pk, AppSettings.get_solo().pk)

    def test_appsettings_rejects_second_instance(self):
        AppSettings.get_solo()
        with self.assertRaises(IntegrityError):
            AppSettings.objects.create()
