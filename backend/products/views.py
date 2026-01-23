# backend/products/views.py
from django.db.models import Count
from rest_framework import viewsets, permissions, status, response
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAdminUser

from audit.helpers import AuditModelViewSetMixin
from common.authentication import OptionalAuthenticationMixin
from common.security import PublicEndpointMixin

from .models import Product
from .serializers import ProductSerializer, HomeProductSerializer, AdminProductSerializer
from policies.models import Policy


class ProductViewSet(OptionalAuthenticationMixin, viewsets.ReadOnlyModelViewSet):
    """
    GET /api/products/
    Devuelve productos activos (público).
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


class HomeProductsListView(PublicEndpointMixin, ListAPIView):
    """
    GET /api/products/home
    Devuelve productos activos y publicados en Home, en formato liviano para Home.
    """
    serializer_class = HomeProductSerializer
    pagination_class = None  # típico para Home

    def get_queryset(self):
        qs = Product.objects.filter(is_active=True, published_home=True)

        # Incluimos campos que usa el serializer para evitar hits extra
        qs = qs.only("id", "code", "name", "subtitle", "bullets", "coverages", "plan_type", "home_order")

        # Orden
        qs = qs.order_by("home_order", "id")
        return qs


class ProductAdminViewSet(AuditModelViewSetMixin, viewsets.ModelViewSet):
    """
    CRUD admin para productos/planes:
    /api/admin/products/insurance-types/...
    """
    serializer_class = AdminProductSerializer
    permission_classes = [IsAdminUser]
    pagination_class = None

    def get_queryset(self):
        # Ojo: Count("policies") requiere que Policy.product tenga related_name="policies"
        # Si no lo tiene, reemplazá por Count("policy") correcto según tu related_name real.
        return Product.objects.all().annotate(policy_count=Count("policies")).order_by("id")

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self._detach_policies(instance)
        self.perform_destroy(instance)
        return response.Response(status=status.HTTP_204_NO_CONTENT)

    def perform_update(self, serializer):
        instance = serializer.save()
        # Si lo desactivan, por tu regla actual, desasociás pólizas
        if not getattr(instance, "is_active", True):
            self._detach_policies(instance)
        return instance

    def _detach_policies(self, instance):
        # Requiere Policy.product null=True. Si no, esto falla.
        Policy.objects.filter(product=instance).update(product=None)
