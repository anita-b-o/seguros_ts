# backend/policies/permissions.py
from rest_framework import permissions


class IsOwnerOrAdmin(permissions.BasePermission):
    """
    Permite acceso si el usuario es admin/staff o si el objeto pertenece al usuario.
    Se asume que el objeto tiene un atributo `user_id` (FK a User) o `user` (relación).
    """

    message = "No tenés permisos para acceder a este recurso."

    def has_object_permission(self, request, view, obj):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False

        if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return True

        owner_id = getattr(obj, "user_id", None)
        if owner_id is not None:
            return owner_id == user.id

        owner = getattr(obj, "user", None)
        if owner is not None:
            return getattr(owner, "id", None) == user.id

        return False
