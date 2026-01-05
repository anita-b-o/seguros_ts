from django.core.exceptions import ImproperlyConfigured


def ensure_mp_webhook_configuration(
    debug,
    webhook_secret,
    allow_no_secret,
    allow_fake_preferences,
    running_tests=False,
):
    """
    Enforce strict MercadoPago webhook configuration when not in debug/test mode.
    """
    if debug or running_tests:
        return

    if not webhook_secret:
        raise ImproperlyConfigured("MP_WEBHOOK_SECRET is required when DEBUG=False")

    if allow_no_secret:
        raise ImproperlyConfigured(
            "MP_ALLOW_WEBHOOK_NO_SECRET cannot be True when DEBUG=False"
        )

    if allow_fake_preferences:
        raise ImproperlyConfigured(
            "MP_ALLOW_FAKE_PREFERENCES cannot be True when DEBUG=False"
        )
