import logging
import os
import sys
from pathlib import Path
from datetime import timedelta
from dotenv import load_dotenv
from django.core.cache import caches
from django.core.exceptions import ImproperlyConfigured

from payments.webhook_config import ensure_mp_webhook_configuration
from pythonjsonlogger import jsonlogger

# === BASE DIR ===
BASE_DIR = Path(__file__).resolve().parent.parent


# === HELPERS ===
def _bool(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "t", "yes", "y", "on")


if not _bool(os.getenv("DJANGO_SKIP_DOTENV")):
    load_dotenv(BASE_DIR / ".env")


DEFAULT_REDIS_URL = "redis://localhost:6379/1"
CACHE_KEY_PREFIX = "seguros"
REDIS_URL = os.getenv("REDIS_URL")


def build_cache_settings(redis_url, debug):
    """
    Produce the standard CACHES config that prefers redis but falls back to LocMem.
    """
    normalized_url = (redis_url or "").strip()
    if normalized_url:
        return {
            "default": {
                "BACKEND": "django_redis.cache.RedisCache",
                "LOCATION": normalized_url,
                "OPTIONS": {
                    "CLIENT_CLASS": "django_redis.client.DefaultClient",
                },
                "KEY_PREFIX": CACHE_KEY_PREFIX,
            }
        }
    if debug:
        return {
            "default": {
                "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
                "LOCATION": f"{CACHE_KEY_PREFIX}-locmem",
                "TIMEOUT": None,
            }
        }
    raise ImproperlyConfigured(
        f"REDIS_URL is required when DEBUG=False (e.g. {DEFAULT_REDIS_URL})."
    )


logger = logging.getLogger(__name__)


def ensure_redis_cache_configuration(debug, caches_config, redis_url, running_tests=False):
    redis_backend = "redis" in caches_config.get("default", {}).get("BACKEND", "").lower()
    if debug or running_tests:
        if not redis_backend:
            logger.warning(
                "cache_non_redis",
                extra={"detail": "Cache backend is not Redis in DEBUG mode."},
            )
        return

    if not redis_url:
        raise ImproperlyConfigured("Redis cache is required in production for OTP and rate limiting.")

    if not redis_backend:
        raise ImproperlyConfigured("Redis cache is required in production for OTP and rate limiting.")


def ensure_redis_cache_health(debug, running_tests=False):
    if debug or running_tests:
        return
    health_cache = caches["default"]
    key = "_redis_healthcheck"
    try:
        health_cache.set(key, "ok", timeout=5)
        if health_cache.get(key) != "ok":
            raise ImproperlyConfigured("Redis cache is required in production for OTP and rate limiting.")
    except ImproperlyConfigured:
        raise
    except Exception as exc:
        logger.critical(
            "redis_cache_unavailable",
            extra={"error": str(exc)},
        )
        raise ImproperlyConfigured("Redis cache is required in production for OTP and rate limiting.") from exc
    logger.info("redis_cache_ready")


# === CORE ===
DEPLOYMENT_ENV = (
    os.getenv("DJANGO_ENV")
    or os.getenv("ENVIRONMENT")
    or os.getenv("ENV")
    or os.getenv("APP_ENV")
    or "development"
)
DEPLOYMENT_ENV = DEPLOYMENT_ENV.strip().lower()
RUNNING_TESTS = "test" in " ".join(sys.argv)
DEBUG = _bool(os.getenv("DJANGO_DEBUG") or os.getenv("DEBUG"), False)

# API policy: no forced redirects (APPEND_SLASH=False) while routers expose endpoints with optional trailing slashes via trailing_slash="/?"
APPEND_SLASH = False

if DEBUG and DEPLOYMENT_ENV in ("prod", "production"):
    raise ImproperlyConfigured(
        "DEBUG cannot be True when DJANGO_ENV=production."
    )

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY") or os.getenv("SECRET_KEY")
if not SECRET_KEY:
    if DEBUG or RUNNING_TESTS:
        SECRET_KEY = "dev-secret-key-change-me"
    else:
        raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY is required when DEBUG=False."
    )

SERVE_MEDIA_FILES = _bool(os.getenv("SERVE_MEDIA_FILES"), DEBUG)

MP_WEBHOOK_SECRET = (os.getenv("MP_WEBHOOK_SECRET") or "").strip()
MP_ALLOW_WEBHOOK_NO_SECRET = _bool(os.getenv("MP_ALLOW_WEBHOOK_NO_SECRET"), False)
MP_ALLOW_FAKE_PREFERENCES = _bool(os.getenv("MP_ALLOW_FAKE_PREFERENCES"), True)

ensure_mp_webhook_configuration(
    DEBUG,
    MP_WEBHOOK_SECRET,
    MP_ALLOW_WEBHOOK_NO_SECRET,
    MP_ALLOW_FAKE_PREFERENCES,
    running_tests=RUNNING_TESTS,
)

# Hosts permitidos
hosts_env = os.getenv("DJANGO_ALLOWED_HOSTS") or os.getenv("ALLOWED_HOSTS")
if hosts_env:
    ALLOWED_HOSTS = [h.strip() for h in hosts_env.split(",") if h.strip()]
else:
    if DEBUG:
        ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"]
    else:
        raise ImproperlyConfigured(
            "DJANGO_ALLOWED_HOSTS is required when DEBUG=False."
        )

AUTH_USER_MODEL = "accounts.User"

# === INSTALLED APPS ===
INSTALLED_APPS = [
    "django_prometheus",
    "audit",
    # Django apps
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Terceros
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",

    # Apps locales
    "common.apps.CommonConfig",
    "accounts.apps.AccountsConfig",
    "vehicles.apps.VehiclesConfig",
    "products.apps.ProductsConfig",
    "policies.apps.PoliciesConfig",
    "payments.apps.PaymentsConfig",
    "quotes.apps.QuotesConfig",
]

# === MIDDLEWARE ===
MIDDLEWARE = [
    "django_prometheus.middleware.PrometheusBeforeMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",  # CORS alto y antes de Common
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "common.middlewares.RequestIDMiddleware",
    "common.middlewares.AccessLogMiddleware",
    "django_prometheus.middleware.PrometheusAfterMiddleware",
]


# === CORS / CSRF ===
FRONTEND_ORIGINS_ENV = os.getenv("FRONTEND_ORIGINS", "")
FRONTEND_ORIGIN_ENV = os.getenv("FRONTEND_ORIGIN", "")
frontend_env = FRONTEND_ORIGINS_ENV or FRONTEND_ORIGIN_ENV
frontend_origins = [o.strip() for o in frontend_env.split(",") if o.strip()]
FRONTEND_ORIGINS = frontend_origins
FRONTEND_ORIGIN = FRONTEND_ORIGIN_ENV or (frontend_origins[0] if frontend_origins else "")

cors_env = os.getenv("CORS_ALLOWED_ORIGINS")
if cors_env:
    cors_allowed_origins = [o.strip() for o in cors_env.split(",") if o.strip()]
else:
    cors_allowed_origins = frontend_origins

CORS_ALLOWED_ORIGINS = cors_allowed_origins
CORS_ALLOW_CREDENTIALS = _bool(os.getenv("CORS_ALLOW_CREDENTIALS"), False)
cors_regex_env = os.getenv("CORS_ALLOWED_ORIGIN_REGEXES", "")
CORS_ALLOWED_ORIGIN_REGEXES = [r.strip() for r in cors_regex_env.split(",") if r.strip()]
CORS_ALLOW_ALL_ORIGINS = _bool(os.getenv("CORS_ALLOW_ALL_ORIGINS"), False)

if CORS_ALLOW_ALL_ORIGINS and not DEBUG:
    raise ImproperlyConfigured("CORS_ALLOW_ALL_ORIGINS cannot be True when DEBUG=False.")

if not CORS_ALLOWED_ORIGINS and not CORS_ALLOWED_ORIGIN_REGEXES and not DEBUG:
    raise ImproperlyConfigured(
        "CORS_ALLOWED_ORIGINS or CORS_ALLOWED_ORIGIN_REGEXES is required in production."
    )

CSRF_TRUSTED_ORIGINS = [
    o for o in CORS_ALLOWED_ORIGINS if o.startswith(("http://", "https://"))
]


# === URLS / WSGI ===
ROOT_URLCONF = "seguros.urls"

# 🔐 URL del panel de administración (configurable por .env)
ADMIN_URL = os.getenv("ADMIN_URL", "admin/")

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "seguros.wsgi.application"


# === DATABASE ===
DB_ENGINE = (os.getenv("DB_ENGINE") or "").strip()
if not DB_ENGINE and not DEBUG:
    raise ImproperlyConfigured("DB_ENGINE is required when DEBUG=False.")

if DB_ENGINE:
    DATABASES = {
        "default": {
            "ENGINE": DB_ENGINE,
            "NAME": os.getenv("DB_NAME"),
            "USER": os.getenv("DB_USER"),
            "PASSWORD": os.getenv("DB_PASSWORD"),
            "HOST": os.getenv("DB_HOST"),
            "PORT": os.getenv("DB_PORT"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }


# === CACHE ===
CACHES = build_cache_settings(REDIS_URL, DEBUG)

ensure_redis_cache_configuration(
    DEBUG,
    CACHES,
    REDIS_URL,
    running_tests=RUNNING_TESTS,
)
RUN_REDIS_HEALTHCHECK = _bool(os.getenv("RUN_REDIS_HEALTHCHECK"), False)
if RUN_REDIS_HEALTHCHECK:
    ensure_redis_cache_health(DEBUG, running_tests=RUNNING_TESTS)

# === OTP / RATE LIMIT ===
OTP_PEPPER = os.getenv("OTP_PEPPER")
OTP_TIMEOUT_SECONDS = int(os.getenv("OTP_TIMEOUT_SECONDS", "600"))
OTP_VERIFY_MAX_ATTEMPTS = int(os.getenv("OTP_VERIFY_MAX_ATTEMPTS", "5"))
OTP_RATE_LIMIT_SEND_COUNT = int(os.getenv("OTP_RATE_LIMIT_SEND_COUNT", "5"))
OTP_RATE_LIMIT_SEND_WINDOW = int(os.getenv("OTP_RATE_LIMIT_SEND_WINDOW", "600"))
OTP_RATE_LIMIT_VERIFY_COUNT = int(os.getenv("OTP_RATE_LIMIT_VERIFY_COUNT", "10"))
OTP_RATE_LIMIT_VERIFY_WINDOW = int(os.getenv("OTP_RATE_LIMIT_VERIFY_WINDOW", "600"))


# === AUTH ===


# === DRF / JWT ===
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "common.authentication.StrictJWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated"
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": int(os.getenv("API_PAGE_SIZE", "10")),
    # Permite al front solicitar tamaños personalizados (p. ej. page_size=200 en admin)
    "PAGE_SIZE_QUERY_PARAM": "page_size",
    "MAX_PAGE_SIZE": int(os.getenv("API_MAX_PAGE_SIZE", "500")),
    # Limitamos bursts básicos y un scope específico para /quotes/*
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.ScopedRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": os.getenv("API_THROTTLE_ANON", "60/hour"),
        "user": os.getenv("API_THROTTLE_USER", "120/hour"),
        "quotes": os.getenv("API_THROTTLE_QUOTES", "10/hour"),
        "login": os.getenv("API_THROTTLE_LOGIN", "20/hour"),
        "reset": os.getenv("API_THROTTLE_RESET", "10/hour"),
        "register": os.getenv("API_THROTTLE_REGISTER", "30/hour"),
        "claim": os.getenv("API_THROTTLE_CLAIM", "15/hour"),
    },
}

# En producción, solo JSON (sin UI browsable).
if not DEBUG:
    REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = (
        "rest_framework.renderers.JSONRenderer",
    )
# En desarrollo podés liberar permisos solo si lo pedís explícitamente.
if DEBUG and _bool(os.getenv("API_ALLOW_ANY_IN_DEBUG"), False):
    REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"] = [
        "rest_framework.permissions.AllowAny"
    ]

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=int(os.getenv("JWT_ACCESS_HOURS", "8"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(os.getenv("JWT_REFRESH_DAYS", "7"))),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "ALGORITHM": os.getenv("JWT_ALGORITHM", "HS256"),
    "SIGNING_KEY": os.getenv("JWT_SIGNING_KEY", SECRET_KEY),
    "TOKEN_OBTAIN_SERIALIZER": "accounts.jwt_serializers.EmailTokenObtainPairSerializer",
}


# === INTERNACIONALIZACIÓN ===
LANGUAGE_CODE = "es-ar"
TIME_ZONE = "America/Argentina/Buenos_Aires"
USE_I18N = True
USE_TZ = True


# === STATIC & MEDIA ===
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_ROOT = os.getenv("MEDIA_ROOT", BASE_DIR / "media")
MEDIA_URL = os.getenv("MEDIA_URL", "/media/")
# Límite de subida (aplica a uploads en memoria y data payloads)
MEDIA_MAX_UPLOAD_MB = int(os.getenv("MEDIA_MAX_UPLOAD_MB", "10"))
FILE_UPLOAD_MAX_MEMORY_SIZE = MEDIA_MAX_UPLOAD_MB * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = FILE_UPLOAD_MAX_MEMORY_SIZE

# Media: en prod deshabilitado por defecto (usar CDN/servidor de archivos).
# Si querés servir desde Django en prod, poné SERVE_MEDIA_FILES=true y ALLOW_SERVE_MEDIA_IN_PROD=true conscientemente.
SERVE_MEDIA_FILES = DEBUG or _bool(os.getenv("SERVE_MEDIA_FILES"), False)
if not DEBUG and SERVE_MEDIA_FILES and not _bool(os.getenv("ALLOW_SERVE_MEDIA_IN_PROD"), False):
    raise ImproperlyConfigured(
        "SERVE_MEDIA_FILES está habilitado en producción. Serví /media/ desde CDN/Nginx o define ALLOW_SERVE_MEDIA_IN_PROD=true bajo tu riesgo."
    )

# === ARCHIVOS PDF / REPORTES ===
RECEIPT_TEMPLATE_PDF = os.getenv(
    "RECEIPT_TEMPLATE_PDF",
    str(BASE_DIR / "static" / "receipts" / "COMPROBANTE.pdf"),
)
RECEIPT_DEBUG_GRID = _bool(os.getenv("RECEIPT_DEBUG_GRID"), False)

# === EMAIL ===
EMAIL_BACKEND = os.getenv(
    "DJANGO_EMAIL_BACKEND",
    os.getenv("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend"),
)
EMAIL_HOST = os.getenv("EMAIL_HOST", "smtp.gmail.com")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = _bool(os.getenv("EMAIL_USE_TLS"), True)
EMAIL_USE_SSL = _bool(os.getenv("EMAIL_USE_SSL"), False)
# Remitente por defecto para correos salientes (2FA, etc.)
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "no-reply@sancayetano.com")
# Bloqueamos el backend de consola en producción para garantizar entrega real,
# salvo que se explicite la excepción.
if (
    not DEBUG
    and EMAIL_BACKEND.endswith("console.EmailBackend")
    and not _bool(os.getenv("ALLOW_CONSOLE_EMAIL_IN_PROD"), False)
):
    raise ImproperlyConfigured(
        "EMAIL_BACKEND apunta a consola en producción. Configurá SMTP o define ALLOW_CONSOLE_EMAIL_IN_PROD=true solo para entornos controlados."
    )


# === LOGGING ESTRUCTURADO ===
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
REQUEST_LOG_REDACTION_FIELDS = (
    "password",
    "token",
    "secret",
    "authorization",
    "access",
    "refresh",
)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "request_id": {"()": "common.logging.RequestIDFilter"},
    },
    "formatters": {
        "json": {
            "()": "pythonjsonlogger.jsonlogger.JsonFormatter",
            "fmt": "%(asctime)s %(levelname)s %(name)s %(message)s %(request_id)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "stream": sys.stdout,
            "formatter": "json",
            "filters": ["request_id"],
        },
    },
    "root": {
        "handlers": ["console"],
        "level": LOG_LEVEL,
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        "django.request": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        "django.server": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
    },
}

# === SECURITY / COOKIES ===
# Ajustes pensados para producción; controlables por env.
SESSION_COOKIE_SECURE = _bool(os.getenv("SESSION_COOKIE_SECURE"), not DEBUG)
CSRF_COOKIE_SECURE = _bool(os.getenv("CSRF_COOKIE_SECURE"), not DEBUG)
SESSION_COOKIE_SAMESITE = os.getenv("SESSION_COOKIE_SAMESITE", "Lax")
CSRF_COOKIE_SAMESITE = os.getenv("CSRF_COOKIE_SAMESITE", "Lax")
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_SSL_REDIRECT = _bool(os.getenv("SECURE_SSL_REDIRECT"), not DEBUG)
SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "0" if DEBUG else "3600"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = _bool(os.getenv("SECURE_HSTS_INCLUDE_SUBDOMAINS"), True)
SECURE_HSTS_PRELOAD = _bool(os.getenv("SECURE_HSTS_PRELOAD"), False)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = False


# === DEFAULTS ===
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
