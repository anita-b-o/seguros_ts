# backend/products/views.py
from audit.helpers import AuditModelViewSetMixin
from rest_framework import viewsets, permissions, status, response
from rest_framework.permissions import IsAdminUser
from rest_framework.generics import ListAPIView
from common.authentication import OptionalAuthenticationMixin
from common.security import PublicEndpointMixin
from .models import Product
from .serializers import ProductSerializer, HomeProductSerializer, AdminProductSerializer
from policies.models import Policy
from django.db.models import Count


# 🔹 ViewSet general (ya existente)
class ProductViewSet(OptionalAuthenticationMixin, viewsets.ReadOnlyModelViewSet):
    """
    GET /api/products/
    Devuelve productos activos para consumo público.
    """
    queryset = Product.objects.filter(is_active=True).order_by("id")
    serializer_class = ProductSerializer
    PUBLIC_ACTIONS = {"list", "retrieve"}

    def _resolve_action(self):
        if getattr(self, "action", None):
            return self.action
        request = getattr(self, "request", None)
        if request:
            return self.action_map.get(request.method.lower())
        return None

    def get_permissions(self):
        if self._resolve_action() in self.PUBLIC_ACTIONS:
            return [permissions.AllowAny()]
        return [permissions.IsAdminUser()]

    def should_use_optional_authentication(self):
        return self._resolve_action() in self.PUBLIC_ACTIONS


# 🔹 Vista optimizada para el Home
class HomeProductsListView(PublicEndpointMixin, ListAPIView):
    """
    GET /api/products/home
    Devuelve una versión liviana para el carrusel del Home.
    Incluye solo: id, name, plan_type, vehicle_type, franchise, coverages_lite.
    """
    serializer_class = HomeProductSerializer

    def get_queryset(self):
        # Solo productos activos y marcados para mostrarse en el Home
        qs = Product.objects.filter(is_active=True, published_home=True)

        # Campos mínimos para optimizar consulta
        qs = qs.only("id", "name", "plan_type", "vehicle_type", "franchise")

        # Orden por home_order si existe, si no por nombre
        if hasattr(Product, "home_order"):
            qs = qs.order_by("home_order", "id")
        else:
            qs = qs.order_by("name", "id")

        return qs


class ProductAdminViewSet(AuditModelViewSetMixin, viewsets.ModelViewSet):
    """
    CRUD admin para productos/planes
    Endpoints esperados por el front: /api/admin/insurance-types
    """
    serializer_class = AdminProductSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        return (
            Product.objects.all()
            .annotate(policy_count=Count("policies"))
            .order_by("id")
        )

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        # Desasociar pólizas antes de eliminar el seguro
        self._detach_policies(instance)
        self.perform_destroy(instance)
        return response.Response(status=status.HTTP_204_NO_CONTENT)

    def perform_update(self, serializer):
        instance = serializer.save()
        if not getattr(instance, "is_active", True):
            self._detach_policies(instance)
        return instance

    def _detach_policies(self, instance):
        Policy.objects.filter(product=instance).update(product=None)
