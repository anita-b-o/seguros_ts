from unittest import mock

from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase, override_settings

from seguros.settings import (
    ensure_redis_cache_configuration,
    ensure_redis_cache_health,
)


class CacheConfigurationTests(TestCase):
    def test_missing_redis_url_raises_in_production(self):
        with self.assertRaises(ImproperlyConfigured):
            ensure_redis_cache_configuration(
                debug=False,
                caches_config={"default": {"BACKEND": "django_redis.cache.RedisCache"}},
                redis_url="",
                running_tests=False,
            )

    def test_nonredis_backend_raises_in_production(self):
        with self.assertRaises(ImproperlyConfigured):
            ensure_redis_cache_configuration(
                debug=False,
                caches_config={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
                redis_url="redis://localhost:6379/0",
                running_tests=False,
            )

    @override_settings(DEBUG=False)
    @mock.patch("seguros.settings.caches")
    def test_healthcheck_raises_when_redis_unavailable(self, mock_caches):
        cache_mock = mock.Mock()
        cache_mock.set.side_effect = Exception("boom")
        mock_caches.__getitem__.return_value = cache_mock
        with self.assertRaises(ImproperlyConfigured):
            ensure_redis_cache_health(debug=False, running_tests=False)

    def test_healthcheck_skips_in_tests_or_debug(self):
        # Should not raise when running tests regardless of cache behavior
        ensure_redis_cache_health(debug=False, running_tests=True)
        ensure_redis_cache_health(debug=True, running_tests=False)
