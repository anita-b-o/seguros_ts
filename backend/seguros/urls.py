import os
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse
from django.shortcuts import redirect
from django_prometheus import exports

from accounts.auth_views import (
    EmailLoginView,
    PasswordResetRequestView,
    PasswordResetConfirmView,
    RegisterView,
    LogoutView,
    GoogleLoginView,
    GoogleLoginStatusView,
    ResendOnboardingView,
)
from accounts.views import deprecated_lookup
from accounts.urls import PublicTokenRefreshView
from .legacy_views import legacy_announcements_list, legacy_announcements_detail
from common.views import AppSettingsView


# === Healthcheck ===
def healthcheck(request):
    """
    Endpoint simple para verificar el estado del servidor.
    Útil para monitoreo o comprobaciones automáticas.
    """
    return JsonResponse({"status": "ok"}, status=200)


def _env_bool(val):
    return str(val).strip().lower() in ("1", "true", "t", "yes", "y", "on") if val is not None else False


urlpatterns = [
    path("metrics/", exports.ExportToDjangoView, name="prometheus-metrics-slash"),
    path("metrics", exports.ExportToDjangoView, name="prometheus-metrics"),

    # Admin — configurable por .env
    path(settings.ADMIN_URL, admin.site.urls),

    # (Opcional) redirect desde /admin/ → ADMIN_URL
    path("admin/", lambda r: redirect("/" + settings.ADMIN_URL, permanent=True)),

    # Healthcheck
    path("healthz/", healthcheck, name="healthcheck"),
    path("healthz", healthcheck, name="healthcheck-noslash"),

    # API common
    path("api/common/", include("common.urls")),
    path("api/common", include("common.urls")),

    # lookup legacy
    path("api/users/lookup", deprecated_lookup, name="user-lookup-deprecated"),
    path("api/users/lookup/", deprecated_lookup, name="user-lookup-deprecated-slash"),

    # Accounts
    path("api/accounts/", include("accounts.urls")),
    path("api/accounts", include("accounts.urls")),

    # Auth alias compatible con el frontend
    path("api/auth/login", EmailLoginView.as_view(), name="auth-login"),
    path("api/auth/login/", EmailLoginView.as_view(), name="auth-login-slash"),
    path("api/auth/refresh", PublicTokenRefreshView.as_view(), name="auth-refresh"),
    path("api/auth/refresh/", PublicTokenRefreshView.as_view(), name="auth-refresh-slash"),
    path("api/auth/logout", LogoutView.as_view(), name="auth-logout"),
    path("api/auth/logout/", LogoutView.as_view(), name="auth-logout-slash"),
    path("api/auth/register", RegisterView.as_view(), name="auth-register"),
    path("api/auth/register/", RegisterView.as_view(), name="auth-register-slash"),
    path("api/auth/google", GoogleLoginView.as_view(), name="auth-google"),
    path("api/auth/google/", GoogleLoginView.as_view(), name="auth-google-slash"),
    path("api/auth/google/status", GoogleLoginStatusView.as_view(), name="auth-google-status"),
    path("api/auth/google/status/", GoogleLoginStatusView.as_view(), name="auth-google-status-slash"),
    path("api/auth/password/reset", PasswordResetRequestView.as_view(), name="auth-password-reset"),
    path("api/auth/password/reset/", PasswordResetRequestView.as_view(), name="auth-password-reset-slash"),
    path("api/auth/password/reset/confirm", PasswordResetConfirmView.as_view(), name="auth-password-reset-confirm"),
    path("api/auth/password/reset/confirm/", PasswordResetConfirmView.as_view(), name="auth-password-reset-confirm-slash"),
    path("api/auth/onboarding/resend", ResendOnboardingView.as_view(), name="auth-onboarding-resend"),
    path("api/auth/onboarding/resend/", ResendOnboardingView.as_view(), name="auth-onboarding-resend-slash"),

    # Public apps
    path("api/products/", include("products.urls")),
    path("api/products", include("products.urls")),
    path("api/policies/", include("policies.urls")),
    path("api/policies", include("policies.urls")),
    path("api/payments/", include("payments.urls")),
    path("api/payments", include("payments.urls")),
    path("api/quotes/", include("quotes.urls")),
    path("api/quotes", include("quotes.urls")),
    path("api/vehicles/", include("vehicles.urls")),
    path("api/vehicles", include("vehicles.urls")),

    # Legacy announcements
    path("api/announcements/", legacy_announcements_list, name="legacy-announcements-list"),
    path("api/announcements", legacy_announcements_list, name="legacy-announcements-list-noslash"),
    path("api/announcements/<int:pk>/", legacy_announcements_detail, name="legacy-announcements-detail"),
    path("api/announcements/<int:pk>", legacy_announcements_detail, name="legacy-announcements-detail-noslash"),

    # =========================
    # Admin API (lo que espera el front)
    # =========================
    # policies
    path("api/admin/policies/", include("policies.admin_urls")),
    path("api/admin/policies", include("policies.admin_urls")),

    # accounts (users)
    path("api/admin/accounts/", include("accounts.admin_urls")),
    path("api/admin/accounts", include("accounts.admin_urls")),

    # products (insurance-types)
    path("api/admin/products/", include("products.admin_urls")),
    path("api/admin/products", include("products.admin_urls")),

    # payments (si tu app tiene admin_urls, preferible usarlo; si no, se mantiene payments.urls)
    path("api/admin/payments/", include("payments.urls")),
    path("api/admin/payments", include("payments.urls")),

    # Admin settings
    path("api/admin/settings", AppSettingsView.as_view(), name="admin-settings"),
    path("api/admin/settings/", AppSettingsView.as_view(), name="admin-settings-slash"),
]

# Nota: removí duplicados peligrosos:
# - path("api/admin/", include("accounts.admin_urls"))
# - path("api/admin", include("accounts.admin_urls"))
# Porque pisan/ensucian el namespace /api/admin y pueden generar ruteos inesperados.


# === Archivos estáticos y media ===
if getattr(settings, "SERVE_MEDIA_FILES", False):
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)


# === Root amigable (en lugar del 404) ===
urlpatterns += [
    path(
        "",
        lambda r: JsonResponse(
            {
                "message": "San Cayetano API 🚗✅",
                "endpoints": [
                    "/api/accounts",
                    "/api/vehicles",
                    "/api/products",
                    "/api/policies",
                    "/api/payments",
                    "/api/quotes",
                    "/healthz/",
                    f"/{settings.ADMIN_URL}",
                    "/api/admin/accounts/users",
                    "/api/admin/policies/policies",
                    "/api/admin/products/insurance-types",
                    "/api/admin/settings",
                ],
            },
            status=200,
        ),
        name="api-root",
    ),
]
