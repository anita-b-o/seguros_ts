# backend/accounts/views.py
from audit.helpers import AuditModelViewSetMixin
from rest_framework import viewsets, permissions, decorators, response, status
from .models import User
from .serializers import UserSerializer


@decorators.api_view(["GET"])
@decorators.permission_classes([permissions.AllowAny])
def deprecated_lookup(request):
    return response.Response(
        {"detail": "Endpoint deprecated."},
        status=status.HTTP_410_GONE,
    )


class IsSelfOrAdmin(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return bool(user.is_staff or obj.id == user.id)


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by("-id")
    serializer_class = UserSerializer
    pagination_class = None  # el admin recibe todos los usuarios sin paginación

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        # Solo admins pueden manipular policy_ids; /me no debe permitirlo.
        ctx["allow_policy_ids"] = bool(self.request.user and self.request.user.is_staff and self.action != "me")
        return ctx

    def get_permissions(self):
        """
        - Acciones estándar (list, create, update, delete): solo admin.
        - retrieve/partial_update/update: admin o propio usuario.
        - Acción personalizada 'me': usuario autenticado.
        """
        if self.action == "me":
            return [permissions.IsAuthenticated()]
        if self.action in ["retrieve", "partial_update", "update"]:
            return [IsSelfOrAdmin()]
        return [permissions.IsAdminUser()]

    @decorators.action(
        detail=False,
        methods=["get", "patch", "put"],
        url_path="me",
        permission_classes=[permissions.IsAuthenticated],
    )
    def me(self, request):
        """
        GET  → devuelve los datos del usuario autenticado.
        PATCH/PUT → permite actualizar parcialmente su perfil.
        """
        user = request.user

        if request.method.lower() == "get":
            serializer = self.get_serializer(user)
            return response.Response(serializer.data)

        # PATCH/PUT (actualización parcial o total, pero tratamos como parcial)
        serializer = self.get_serializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return response.Response(serializer.data, status=status.HTTP_200_OK)


class AdminUserViewSet(AuditModelViewSetMixin, UserViewSet):
    """Admin-only viewset for /api/admin/accounts/users.*

    We intentionally do not expose self-service semantics under the /api/admin namespace.
    """

    def get_permissions(self):
        return [permissions.IsAdminUser()]

    @decorators.action(
        detail=False,
        methods=["get", "patch", "put"],
        url_path="me",
        permission_classes=[permissions.IsAdminUser],
    )
    def me(self, request):
        # Admin 'me' behaves like the regular one, but remains admin-only.
        return super().me(request)
