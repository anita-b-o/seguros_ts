import logging

from audit.helpers import AuditModelViewSetMixin
from rest_framework import viewsets, permissions, decorators, response, status, serializers, filters
from rest_framework.pagination import PageNumberPagination
from django.shortcuts import get_object_or_404
from django.utils import timezone

from .models import User
from .serializers import UserSerializer
from policies.models import Policy
from policies.serializers import PolicySerializer

logger = logging.getLogger(__name__)


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
    filter_backends = [filters.SearchFilter]
    search_fields = ["dni", "email", "first_name", "last_name"]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        # Solo admins pueden manipular policy_ids; /me no debe permitirlo.
        ctx["allow_policy_ids"] = bool(self.request.user and self.request.user.is_staff and self.action != "me")
        # Permitir cambio de password en /me para el usuario autenticado.
        ctx["allow_password_set"] = bool(self.action == "me")
        return ctx

    def get_permissions(self):
        """
        - Acciones estándar (list, create, update, delete): solo admin.
        - retrieve/partial_update/update: admin o propio usuario.
        - Acción personalizada 'me': usuario autenticado.
        """
        if self.action in ("me", "change_password", "associate_policy", "detach_policy"):
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

    @decorators.action(
        detail=False,
        methods=["post"],
        url_path="me/policies/associate",
        permission_classes=[permissions.IsAuthenticated],
    )
    def associate_policy(self, request):
        """
        POST /api/accounts/users/me/policies/associate
        body: { "policy_number": "..." }
        """
        user = request.user
        policy_number = (request.data.get("policy_number") or request.data.get("number") or "").strip()

        if not policy_number:
            return response.Response(
                {"detail": "policy_number es requerido."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        policy = (
            Policy.objects.select_related("user", "product", "vehicle")
            .filter(number__iexact=policy_number, is_deleted=False)
            .first()
        )
        if not policy:
            return response.Response(
                {"detail": "Póliza no encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if policy.user_id:
            if policy.user_id == user.id:
                serializer = PolicySerializer(policy, context={"request": request})
                return response.Response(
                    {"message": "La póliza ya está asociada a tu cuenta.", "policy": serializer.data},
                    status=status.HTTP_200_OK,
                )
            logger.info(
                "policy_associate_conflict",
                extra={"policy_id": policy.id, "user_id": user.id, "policy_user_id": policy.user_id},
            )
            return response.Response(
                {"detail": "La póliza ya está asociada a otra cuenta."},
                status=status.HTTP_409_CONFLICT,
            )

        policy.user = user
        policy.save(update_fields=["user", "updated_at"])

        serializer = PolicySerializer(policy, context={"request": request})
        return response.Response(
            {"message": "¡Póliza asociada!", "policy": serializer.data},
            status=status.HTTP_200_OK,
        )

    @decorators.action(
        detail=False,
        methods=["post"],
        url_path=r"me/policies/(?P<policy_id>\d+)/detach",
        permission_classes=[permissions.IsAuthenticated],
    )
    def detach_policy(self, request, policy_id=None):
        """
        POST /api/accounts/users/me/policies/<policy_id>/detach
        """
        user = request.user
        policy = get_object_or_404(Policy, id=int(policy_id), user=user)
        policy.user = None
        policy.save(update_fields=["user", "updated_at"])
        return response.Response(status=status.HTTP_204_NO_CONTENT)


class AdminUserViewSet(AuditModelViewSetMixin, UserViewSet):
    """Admin-only viewset for /api/admin/accounts/users.*

    We intentionally do not expose self-service semantics under the /api/admin namespace.
    """

    def get_permissions(self):
        return [permissions.IsAdminUser()]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            return qs.filter(is_active=True)
        if self.action == "deleted":
            return qs.filter(is_active=False)
        return qs

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

    def destroy(self, request, *args, **kwargs):
        """
        Soft delete: desactivar usuario en lugar de borrarlo.
        """
        user = self.get_object()
        # Desasociar pólizas del usuario al eliminarlo
        Policy.objects.filter(user=user).update(user=None, updated_at=timezone.now())
        if user.is_active:
            user.is_active = False
            user.save(update_fields=["is_active"])
        return response.Response(status=status.HTTP_204_NO_CONTENT)

    @decorators.action(detail=True, methods=["post"], url_path="restore")
    def restore(self, request, pk=None):
        """
        POST /api/admin/accounts/users/<id>/restore
        Reactiva usuario desactivado.
        """
        user = self.get_object()
        if not user.is_active:
            user.is_active = True
            user.save(update_fields=["is_active"])
        serializer = self.get_serializer(user)
        return response.Response(serializer.data, status=status.HTTP_200_OK)

    @decorators.action(detail=False, methods=["get"], url_path="deleted")
    def deleted(self, request):
        """
        GET /api/admin/accounts/users/deleted
        Devuelve usuarios inactivos (soft deleted).
        """
        qs = self.filter_queryset(self.get_queryset().order_by("-id"))

        paginator = PageNumberPagination()
        page_size = request.query_params.get("page_size")
        if page_size and str(page_size).isdigit():
            paginator.page_size = int(page_size)
        else:
            paginator.page_size = 5

        page = paginator.paginate_queryset(qs, request)
        serializer = self.get_serializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

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
        qs = Policy.objects.filter(user=user).only("id", "number").order_by("-id")
        data = [{"id": p.id, "number": p.number, "policy_number": p.number} for p in qs]
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
        previous_user_id = policy.user_id
        policy.user = user
        policy.save(update_fields=["user", "updated_at"])
        if previous_user_id and previous_user_id != user.id:
            logger.info(
                "admin_policy_reassigned",
                extra={"policy_id": policy.id, "from_user_id": previous_user_id, "to_user_id": user.id},
            )
        serializer = PolicySerializer(policy, context={"request": request})
        return response.Response({"policy": serializer.data}, status=status.HTTP_200_OK)

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
        policy.save(update_fields=["user", "updated_at"])
        return response.Response(status=status.HTTP_204_NO_CONTENT)
