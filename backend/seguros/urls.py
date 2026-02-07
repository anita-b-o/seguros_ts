# backend/urls.py (o backend/seguros/urls.py)
import os
from urllib.parse import urlencode

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse, HttpResponseRedirect
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
    CookieTokenRefreshView,
)
from accounts.views import deprecated_lookup, AdminUserViewSet
from .legacy_views import legacy_announcements_list, legacy_announcements_detail
from common.views import AppSettingsView


# === Healthcheck ===
def healthcheck(request):
    """
    Endpoint simple para verificar el estado del servidor.
    Útil para monitoreo o comprobaciones automáticas.
    """
    return JsonResponse({"status": "ok"}, status=200)


def _env_bool(val, default=False):
    if val is None:
        return default
    return str(val).strip().lower() in ("1", "true", "t", "yes", "y", "on")


def _admin_redirect(request):
    # evita // si ADMIN_URL ya trae slash final
    target = "/" + str(settings.ADMIN_URL).lstrip("/")
    return redirect(target, permanent=True)


def _redirect_to(path_with_slash: str):
    """
    Redirige preservando querystring.
    Ej: /api/policies?x=1 -> /api/policies/?x=1
    """
    def view(request):
        qs = request.META.get("QUERY_STRING", "")
        target = path_with_slash + (f"?{qs}" if qs else "")
        return HttpResponseRedirect(target)
    return view


urlpatterns = [
    # Django admin — configurable por .env
    path(settings.ADMIN_URL, admin.site.urls),

    # (Opcional) redirect desde /admin/ → ADMIN_URL
    path("admin/", _admin_redirect),

    # Healthcheck
    path("healthz/", healthcheck, name="healthcheck"),
    path("healthz", healthcheck, name="healthcheck-noslash"),

    # =========================
    # API common ✅
    # CANÓNICO: include CON "/" final
    # LEGACY: redirect SIN slash -> CON slash
    # =========================
    path("api/common/", include("common.urls")),
    path("api/common", _redirect_to("/api/common/")),

    # lookup legacy
    path("api/users/lookup", deprecated_lookup, name="user-lookup-deprecated"),
    path("api/users/lookup/", deprecated_lookup, name="user-lookup-deprecated-slash"),

    # =========================
    # Accounts ✅
    # CANÓNICO: include CON "/" final
    # LEGACY: redirect SIN slash -> CON slash
    # =========================
    path("api/accounts/", include("accounts.urls")),
    path("api/accounts", _redirect_to("/api/accounts/")),

    # =========================
    # Auth alias compatible con el frontend
    # (no es include, así que OK)
    # =========================
    path("api/auth/login", EmailLoginView.as_view(), name="auth-login"),
    path("api/auth/login/", EmailLoginView.as_view(), name="auth-login-slash"),

    path("api/auth/refresh", CookieTokenRefreshView.as_view(), name="auth-refresh"),
    path("api/auth/refresh/", CookieTokenRefreshView.as_view(), name="auth-refresh-slash"),

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

    # =========================
    # Public apps ✅
    # CANÓNICO: include CON "/" final
    # LEGACY: redirect SIN slash -> CON slash
    # =========================
    path("api/products/", include("products.urls")),
    path("api/products", _redirect_to("/api/products/")),

    path("api/policies/", include("policies.urls")),
    path("api/policies", _redirect_to("/api/policies/")),

    path("api/payments/", include("payments.urls")),
    path("api/payments", _redirect_to("/api/payments/")),

    path("api/quotes/", include("quotes.urls")),
    path("api/quotes", _redirect_to("/api/quotes/")),

    path("api/vehicles/", include("vehicles.urls")),
    path("api/vehicles", _redirect_to("/api/vehicles/")),

    # Legacy announcements (views explícitas, ok)
    path("api/announcements/", legacy_announcements_list, name="legacy-announcements-list"),
    path("api/announcements", legacy_announcements_list, name="legacy-announcements-list-noslash"),
    path("api/announcements/<int:pk>/", legacy_announcements_detail, name="legacy-announcements-detail"),
    path("api/announcements/<int:pk>", legacy_announcements_detail, name="legacy-announcements-detail-noslash"),

    # =========================
    # Admin API ✅
    # CANÓNICO: include CON "/" final
    # LEGACY: redirect SIN slash -> CON slash
    # =========================
    # Legacy alias: /api/admin/users (compat)
    path("api/admin/users", AdminUserViewSet.as_view({"get": "list", "post": "create"})),
    path("api/admin/users/", AdminUserViewSet.as_view({"get": "list", "post": "create"})),
    path(
        "api/admin/users/<int:pk>",
        AdminUserViewSet.as_view({"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"}),
    ),
    path(
        "api/admin/users/<int:pk>/",
        AdminUserViewSet.as_view({"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"}),
    ),

    path("api/admin/policies/", include("policies.admin_urls")),
    path("api/admin/policies", _redirect_to("/api/admin/policies/")),

    path("api/admin/accounts/", include("accounts.admin_urls")),
    path("api/admin/accounts", _redirect_to("/api/admin/accounts/")),

    path("api/admin/products/", include("products.admin_urls")),
    path("api/admin/products", _redirect_to("/api/admin/products/")),

    path("api/admin/payments/", include("payments.urls")),
    path("api/admin/payments", _redirect_to("/api/admin/payments/")),

    # Admin settings (views explícitas, ok)
    path("api/admin/settings", AppSettingsView.as_view(), name="admin-settings"),
    path("api/admin/settings/", AppSettingsView.as_view(), name="admin-settings-slash"),
]

# Prometheus (solo si se habilita explícitamente o en DEBUG)
if settings.DEBUG or _env_bool(os.getenv("ALLOW_METRICS_PUBLIC"), False):
    urlpatterns = [
        path("metrics/", exports.ExportToDjangoView, name="prometheus-metrics-slash"),
        path("metrics", exports.ExportToDjangoView, name="prometheus-metrics"),
    ] + urlpatterns


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
                    "/api/accounts/",
                    "/api/vehicles/",
                    "/api/products/",
                    "/api/policies/",
                    "/api/payments/",
                    "/api/quotes/",
                    "/healthz/",
                    f"/{str(settings.ADMIN_URL).lstrip('/')}",
                    "/api/admin/accounts/users",
                    "/api/admin/policies/policies",
                    "/api/admin/products/insurance-types",
                    "/api/admin/settings/",
                ],
            },
            status=200,
        ),
        name="api-root",
    ),
]
