from audit.helpers import AuditModelViewSetMixin
from rest_framework import viewsets, permissions, decorators, response, status, serializers
from django.shortcuts import get_object_or_404

from .models import User
from .serializers import UserSerializer
from policies.models import Policy


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


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(required=True, allow_blank=False, trim_whitespace=False)
    new_password = serializers.CharField(required=True, allow_blank=False, trim_whitespace=False)

    def validate_new_password(self, value):
        # Mantengo una regla mínima y coherente con FE (>= 8).
        if value is None:
            raise serializers.ValidationError("New password is required.")
        if len(value) < 8:
            raise serializers.ValidationError("La nueva contraseña debe tener al menos 8 caracteres.")
        return value


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by("-id")
    serializer_class = UserSerializer
    pagination_class = None  # el admin recibe todos los usuarios sin paginación

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        # Solo admins pueden manipular policy_ids; /me no debe permitirlo.
        ctx["allow_policy_ids"] = bool(self.request.user and self.request.user.is_staff and self.action != "me")
        # Solo admin (y en namespace admin) debería setear password directo.
        ctx["allow_password_set"] = False
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

    @decorators.action(
        detail=False,
        methods=["post"],
        url_path="me/change-password",
        permission_classes=[permissions.IsAuthenticated],
    )
    def change_password(self, request):
        """
        POST /api/accounts/users/me/change-password/
        body: { current_password, new_password }

        - Verifica la contraseña actual
        - Setea la nueva contraseña
        """
        user = request.user
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        current_password = serializer.validated_data["current_password"]
        new_password = serializer.validated_data["new_password"]

        if not user.check_password(current_password):
            return response.Response(
                {"detail": "Contraseña actual incorrecta."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_password)
        user.save(update_fields=["password"])

        return response.Response({"detail": "Contraseña actualizada."}, status=status.HTTP_200_OK)


class AdminUserViewSet(AuditModelViewSetMixin, UserViewSet):
    """Admin-only viewset for /api/admin/accounts/users.*

    We intentionally do not expose self-service semantics under the /api/admin namespace.
    """

    def get_permissions(self):
        return [permissions.IsAdminUser()]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        # En admin permitimos policy_ids (batch) y seteo de password si lo envían.
        ctx["allow_policy_ids"] = True
        ctx["allow_password_set"] = True
        return ctx

    @decorators.action(
        detail=False,
        methods=["get", "patch", "put"],
        url_path="me",
        permission_classes=[permissions.IsAdminUser],
    )
    def me(self, request):
        # Admin 'me' behaves like the regular one, but remains admin-only.
        return super().me(request)

    # =========================================================
    # Admin UserPolicies (para UserPoliciesModal.jsx)
    # =========================================================

    @decorators.action(detail=True, methods=["get"], url_path="policies")
    def policies(self, request, pk=None):
        """
        GET /api/admin/accounts/users/<id>/policies
        Devuelve pólizas asociadas al usuario.
        """
        user = self.get_object()
        qs = Policy.objects.filter(user=user).order_by("-id")
        data = [{"id": p.id, "number": p.number} for p in qs]
        return response.Response(data, status=status.HTTP_200_OK)

    @policies.mapping.post
    def attach_policy(self, request, pk=None):
        """
        POST /api/admin/accounts/users/<id>/policies
        body: { "policy_id": <int> }
        Asocia la póliza al usuario (policy.user = user)
        """
        user = self.get_object()
        policy_id = request.data.get("policy_id")

        if not policy_id or not str(policy_id).isdigit():
            return response.Response(
                {"detail": "policy_id es requerido"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        policy = get_object_or_404(Policy, id=int(policy_id))
        policy.user = user
        policy.save(update_fields=["user"])
        return response.Response({"ok": True}, status=status.HTTP_200_OK)

    @decorators.action(
        detail=True,
        methods=["delete"],
        url_path=r"policies/(?P<policy_id>\d+)",
    )
    def detach_policy(self, request, pk=None, policy_id=None):
        """
        DELETE /api/admin/accounts/users/<id>/policies/<policy_id>
        Desasocia la póliza del usuario (policy.user = null)
        """
        user = self.get_object()
        policy = get_object_or_404(Policy, id=int(policy_id))

        if policy.user_id != user.id:
            return response.Response(
                {"detail": "La póliza no pertenece a este usuario"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        policy.user = None
        policy.save(update_fields=["user"])
        return response.Response(status=status.HTTP_204_NO_CONTENT)
