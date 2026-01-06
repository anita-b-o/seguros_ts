from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import ContactInfoView, AppSettingsView, AnnouncementViewSet

# Router sin trailing slash; agregamos aliases manuales para compatibilidad legacy.
router = DefaultRouter(trailing_slash=False)
router.register(r"announcements", AnnouncementViewSet, basename="announcements")

urlpatterns = [
    path("contact-info/", ContactInfoView.as_view(), name="contact-info"),
    path("contact-info", ContactInfoView.as_view(), name="contact-info-no-slash"),  # alias for trailing slash compatibility
    path("admin/settings", AppSettingsView.as_view(), name="app-settings"),
    path(
        "admin/settings/",
        AppSettingsView.as_view(),
        name="app-settings-trailing-slash",
    ),  # alias for trailing slash compatibility
]

urlpatterns += router.urls
