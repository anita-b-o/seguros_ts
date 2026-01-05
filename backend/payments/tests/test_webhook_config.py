from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase

from payments.webhook_config import ensure_mp_webhook_configuration


class MpWebhookConfigTests(TestCase):
    def test_missing_secret_in_production_raises(self):
        with self.assertRaises(ImproperlyConfigured) as ctx:
            ensure_mp_webhook_configuration(
                debug=False,
                webhook_secret="",
                allow_no_secret=False,
                allow_fake_preferences=False,
                running_tests=False,
            )
        self.assertIn("MP_WEBHOOK_SECRET is required when DEBUG=False", str(ctx.exception))

    def test_allow_no_secret_flag_forbidden_in_production(self):
        with self.assertRaises(ImproperlyConfigured) as ctx:
            ensure_mp_webhook_configuration(
                debug=False,
                webhook_secret="foo",
                allow_no_secret=True,
                allow_fake_preferences=False,
                running_tests=False,
            )
        self.assertIn("MP_ALLOW_WEBHOOK_NO_SECRET cannot be True when DEBUG=False", str(ctx.exception))

    def test_fake_preferences_flag_forbidden_in_production(self):
        with self.assertRaises(ImproperlyConfigured) as ctx:
            ensure_mp_webhook_configuration(
                debug=False,
                webhook_secret="foo",
                allow_no_secret=False,
                allow_fake_preferences=True,
                running_tests=False,
            )
        self.assertIn("MP_ALLOW_FAKE_PREFERENCES cannot be True when DEBUG=False", str(ctx.exception))

    def test_no_errors_in_debug_or_tests(self):
        # Should not raise when DEBUG=True or running_tests=True
        ensure_mp_webhook_configuration(
            debug=True,
            webhook_secret="",
            allow_no_secret=True,
            allow_fake_preferences=True,
            running_tests=False,
        )
        ensure_mp_webhook_configuration(
            debug=False,
            webhook_secret="",
            allow_no_secret=False,
            allow_fake_preferences=False,
            running_tests=True,
        )
