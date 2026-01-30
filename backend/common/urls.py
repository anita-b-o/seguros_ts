from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ContactInfoView, AppSettingsView, AnnouncementViewSet

# ======================================================
# Router CANÓNICO (sin slash final)
# Base según include: /api/common/
#
# Endpoints:
#   /api/common/announcements
#   /api/common/announcements/<pk>
# ======================================================
router = DefaultRouter(trailing_slash=False)
router.register(r"announcements", AnnouncementViewSet, basename="announcements")

urlpatterns = [
    # ==================================================
    # Contact Info (público)
    # ==================================================
    # Canónico sin slash (alineado con router)
    path("contact-info", ContactInfoView.as_view(), name="contact-info"),
    # Alias legacy con slash
    path("contact-info/", ContactInfoView.as_view(), name="contact-info-slash"),

    # ==================================================
    # Admin Settings
    # OJO: esto NO va bajo /api/common/admin,
    # sino que se monta desde ROOT en /api/admin/settings
    # pero dejamos esto por compatibilidad interna
    # ==================================================
    path("admin/settings", AppSettingsView.as_view(), name="app-settings"),
    path("admin/settings/", AppSettingsView.as_view(), name="app-settings-slash"),
]

# ======================================================
# Router endpoints (sin slash)
# ======================================================
urlpatterns += router.urls

# ======================================================
# Aliases legacy CON slash para announcements
# (para FE viejo que llama con / final)
# ======================================================
urlpatterns += [
    path(
        "announcements/",
        AnnouncementViewSet.as_view(
            {"get": "list", "post": "create"}
        ),
        name="announcements-list-slash",
    ),
    path(
        "announcements/<int:pk>/",
        AnnouncementViewSet.as_view(
            {
                "get": "retrieve",
                "put": "update",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="announcements-detail-slash",
    ),
]
