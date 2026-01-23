from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ContactInfoView, AppSettingsView, AnnouncementViewSet

# Router sin trailing slash; agregamos aliases manuales para compatibilidad legacy.
router = DefaultRouter(trailing_slash=False)
router.register(r"announcements", AnnouncementViewSet, basename="announcements")

urlpatterns = [
    # -------------------------
    # Contact Info (público)
    # -------------------------
    path("contact-info", ContactInfoView.as_view(), name="contact-info-no-slash"),
    path("contact-info/", ContactInfoView.as_view(), name="contact-info"),

    # -------------------------
    # Admin Settings (admin)
    # Nota: definimos ambas variantes (con y sin slash) para compatibilidad.
    # Tu frontend hoy pega a /api/admin/settings/ (con slash).
    # -------------------------
    path("admin/settings", AppSettingsView.as_view(), name="app-settings"),
    path("admin/settings/", AppSettingsView.as_view(), name="app-settings-trailing-slash"),
]

# Router endpoints sin slash final:
#  - GET /announcements
#  - GET /announcements/<pk>
#  - etc.
urlpatterns += router.urls

# Aliases legacy con trailing slash explícito para announcements
urlpatterns += [
    path(
        "announcements/",
        AnnouncementViewSet.as_view({"get": "list", "post": "create"}),
        name="announcements-list-trailing-slash",
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
        name="announcements-detail-trailing-slash",
    ),
]
