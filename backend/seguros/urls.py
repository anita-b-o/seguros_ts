import os
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse
from django.shortcuts import redirect
from accounts.auth_views import EmailLoginView, PasswordResetRequestView, PasswordResetConfirmView, RegisterView, LogoutView, GoogleLoginView, GoogleLoginStatusView, ResendOnboardingView
from accounts.views import deprecated_lookup
from rest_framework_simplejwt.views import TokenRefreshView
from .legacy_views import legacy_announcements_list, legacy_announcements_detail


# === Healthcheck ===
def healthcheck(request):
    """
    Endpoint simple para verificar el estado del servidor.
    Útil para monitoreo o comprobaciones automáticas.
    """
    return JsonResponse({"status": "ok"}, status=200)



# === URL patterns principales ===
def _env_bool(val):
    return str(val).strip().lower() in ("1", "true", "t", "yes", "y", "on") if val is not None else False

urlpatterns = [
    # Admin — configurable por .env
    path(settings.ADMIN_URL, admin.site.urls),

    # (Opcional) redirect desde /admin/ → ADMIN_URL
    path("admin/", lambda r: redirect("/" + settings.ADMIN_URL, permanent=True)),

    # Healthcheck
    path("healthz/", healthcheck, name="healthcheck"),

    # API
    path("api/common/", include("common.urls")),
    path("api/users/lookup", deprecated_lookup, name="user-lookup-deprecated"),
    path("api/accounts/", include("accounts.urls")),
    # Auth alias compatible con el frontend
    path("api/auth/login", EmailLoginView.as_view(), name="auth-login"),
    path("api/auth/refresh", TokenRefreshView.as_view(), name="auth-refresh"),
    path("api/auth/logout", LogoutView.as_view(), name="auth-logout"),
    path("api/auth/register", RegisterView.as_view(), name="auth-register"),
    path("api/auth/google", GoogleLoginView.as_view(), name="auth-google"),
    path("api/auth/google/status", GoogleLoginStatusView.as_view(), name="auth-google-status"),
    path("api/auth/password/reset", PasswordResetRequestView.as_view(), name="auth-password-reset"),
    path("api/auth/password/reset/confirm", PasswordResetConfirmView.as_view(), name="auth-password-reset-confirm"),
    path("api/auth/onboarding/resend", ResendOnboardingView.as_view(), name="auth-onboarding-resend"),
    path("api/products/", include("products.urls")),
    path("api/policies/", include("policies.urls")),
    path("api/payments/", include("payments.urls")),
    path("api/quotes/", include("quotes.urls")),
    path("api/vehicles/", include("vehicles.urls")),
    path("api/announcements/", legacy_announcements_list, name="legacy-announcements-list"),
    path("api/announcements/<int:pk>/", legacy_announcements_detail, name="legacy-announcements-detail"),
    # Rutas admin esperadas por el front
    path("api/admin/", include("policies.admin_urls")),
    path("api/admin/", include("accounts.admin_urls")),
    path("api/admin/", include("products.admin_urls")),
]


# === Archivos estáticos y media ===
# En entornos no DEBUG solo si el deploy lo habilita explícitamente (ver settings.SERVE_MEDIA_FILES)
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
                    f"/{settings.ADMIN_URL}",
                ],
            },
            status=200,
        ),
        name="api-root",
    ),
]
