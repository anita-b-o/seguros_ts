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

# UserPolicies (compat con y sin slash)
admin_user_policies_view = AdminUserViewSet.as_view(
    {"get": "policies", "post": "attach_policy"}  # policies.GET + policies.POST
)
admin_user_policy_detach_view = AdminUserViewSet.as_view(
    {"delete": "detach_policy"}
)

urlpatterns = router.urls + [
    # compat legacy con slash
    path("users/", admin_users_list_view, name="admin-users-list-slash"),
    path("users/<int:pk>/", admin_users_detail_view, name="admin-users-detail-slash"),
    path("users/me/", admin_users_me_view, name="admin-users-me-slash"),

    # sin slash
    path("users/me", admin_users_me_view, name="admin-users-me"),

    # policies (con y sin slash)
    path("users/<int:pk>/policies/", admin_user_policies_view, name="admin-users-policies-slash"),
    path("users/<int:pk>/policies", admin_user_policies_view, name="admin-users-policies"),

    path(
        "users/<int:pk>/policies/<int:policy_id>/",
        admin_user_policy_detach_view,
        name="admin-users-policy-detach-slash",
    ),
    path(
        "users/<int:pk>/policies/<int:policy_id>",
        admin_user_policy_detach_view,
        name="admin-users-policy-detach",
    ),
]
