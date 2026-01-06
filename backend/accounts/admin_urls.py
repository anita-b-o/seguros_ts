from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import AdminUserViewSet

# trailing_slash=False para aceptar /api/admin/accounts/users sin barra final
router = DefaultRouter(trailing_slash=False)
router.register(r"users", AdminUserViewSet, basename="admin-users")

urlpatterns = router.urls + [
    path(
        "users/me/",
        AdminUserViewSet.as_view({"get": "me", "patch": "me", "put": "me"}),
        name="admin-users-me-slash",
    ),
]
