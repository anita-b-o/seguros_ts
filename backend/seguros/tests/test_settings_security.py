import importlib
import os
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

import seguros.settings as project_settings


def _reload_settings():
    return importlib.reload(project_settings)


class SettingsSecurityTests(SimpleTestCase):
    def setUp(self):
        self._env_backup = os.environ.copy()

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env_backup)
        _reload_settings()

    def _common_env(self, production=True):
        env = {
            "DJANGO_ENV": "production" if production else "development",
            "DJANGO_DEBUG": "False" if production else "True",
            "DJANGO_ALLOWED_HOSTS": "example.com",
            "FRONTEND_ORIGINS": "https://app.example.com",
            "DJANGO_SKIP_DOTENV": "true",
        }
        return env

    def test_production_requires_db_engine(self):
        env = self._common_env()
        env["DJANGO_SECRET_KEY"] = "super-secret"
        env.pop("DB_ENGINE", None)
        with patch.dict(os.environ, env, clear=False):
            with self.assertRaises(ImproperlyConfigured):
                _reload_settings()

    def test_debug_allows_sqlite_fallback(self):
        env = self._common_env(production=False)
        env["DJANGO_SECRET_KEY"] = "dev-secret"
        env.pop("DB_ENGINE", None)
        with patch.dict(os.environ, env, clear=False):
            settings = _reload_settings()
        self.assertEqual(
            settings.DATABASES["default"]["ENGINE"],
            "django.db.backends.sqlite3",
        )

    def test_production_rejects_weak_secret_key(self):
        env = self._common_env()
        env["DJANGO_SECRET_KEY"] = "super-secret"
        env["DB_ENGINE"] = "django.db.backends.postgresql"
        env["DB_NAME"] = "db"
        env["DB_USER"] = "user"
        env["DB_PASSWORD"] = "pass"
        env["DB_HOST"] = "localhost"
        env["DB_PORT"] = "5432"
        env["REDIS_URL"] = "redis://localhost:6379/1"
        env["EMAIL_BACKEND"] = "django.core.mail.backends.smtp.EmailBackend"
        with patch.dict(os.environ, env, clear=False):
            with self.assertRaises(ImproperlyConfigured):
                _reload_settings()

    def test_production_defaults_hsts_preload_true(self):
        env = self._common_env()
        env["DJANGO_SECRET_KEY"] = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789!@#$%^&*()-_=+[]{}"
        env["DB_ENGINE"] = "django.db.backends.postgresql"
        env["DB_NAME"] = "db"
        env["DB_USER"] = "user"
        env["DB_PASSWORD"] = "pass"
        env["DB_HOST"] = "localhost"
        env["DB_PORT"] = "5432"
        env["REDIS_URL"] = "redis://localhost:6379/1"
        env["EMAIL_BACKEND"] = "django.core.mail.backends.smtp.EmailBackend"
        env.pop("SECURE_HSTS_PRELOAD", None)
        with patch.dict(os.environ, env, clear=False):
            settings = _reload_settings()
        self.assertTrue(settings.SECURE_HSTS_PRELOAD)
