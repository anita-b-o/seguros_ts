from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import AdminUserViewSet

# trailing_slash=False para aceptar /api/admin/accounts/users sin barra final
router = DefaultRouter(trailing_slash=False)
router.register(r"users", AdminUserViewSet, basename="admin-users")

admin_users_list_view = AdminUserViewSet.as_view(
    {"get": "list", "post": "create"}
)
admin_users_detail_view = AdminUserViewSet.as_view(
    {
        "get": "retrieve",
        "put": "update",
        "patch": "partial_update",
        "delete": "destroy",
    }
)
admin_users_me_view = AdminUserViewSet.as_view(
    {"get": "me", "patch": "me", "put": "me"},
)

urlpatterns = router.urls + [
    path("users/", admin_users_list_view, name="admin-users-list-slash"),
    path("users/<int:pk>/", admin_users_detail_view, name="admin-users-detail-slash"),
    path("users/me/", admin_users_me_view, name="admin-users-me-slash"),
    path("users/me", admin_users_me_view, name="admin-users-me"),
]
