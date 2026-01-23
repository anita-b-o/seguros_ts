from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework.permissions import AllowAny
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .views import UserViewSet, deprecated_lookup


class PublicTokenObtainPairView(TokenObtainPairView):
    """JWT login endpoint. Must be accessible without prior authentication."""
    permission_classes = (AllowAny,)


class PublicTokenRefreshView(TokenRefreshView):
    """JWT refresh endpoint. Must be accessible without prior authentication."""
    permission_classes = (AllowAny,)


router = DefaultRouter(trailing_slash=False)
router.register("users", UserViewSet)

urlpatterns = [
    path("users/lookup", deprecated_lookup, name="user-lookup-deprecated"),
    path("", include(router.urls)),

    # /users/me (compat con y sin slash)
    path(
        "users/me/",
        UserViewSet.as_view({"get": "me", "patch": "me", "put": "me"}),
        name="users-me-slash",
    ),
    path(
        "users/me",
        UserViewSet.as_view({"get": "me", "patch": "me", "put": "me"}),
        name="users-me",
    ),

    # /users/me/change-password (compat con y sin slash)
    path(
        "users/me/change-password/",
        UserViewSet.as_view({"post": "change_password"}),
        name="users-me-change-password-slash",
    ),
    path(
        "users/me/change-password",
        UserViewSet.as_view({"post": "change_password"}),
        name="users-me-change-password",
    ),

    path("jwt/create/", PublicTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("jwt/refresh/", PublicTokenRefreshView.as_view(), name="token_refresh"),
]
