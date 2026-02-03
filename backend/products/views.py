# backend/products/views.py
from django.db import models
from django.db.models import Count
from rest_framework import viewsets, permissions, status, response
from rest_framework import decorators
from rest_framework.pagination import PageNumberPagination
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
    queryset = Product.objects.filter(is_active=True, is_deleted=False).order_by("id")
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
        qs = Product.objects.filter(is_active=True, published_home=True, is_deleted=False)

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
    pagination_class = PageNumberPagination

    def _apply_deleted_filters(self, qs):
        include_deleted = (self.request.query_params.get("include_deleted") or "").lower() in (
            "1",
            "true",
            "yes",
        )
        deleted_only = (self.request.query_params.get("deleted_only") or "").lower() in (
            "1",
            "true",
            "yes",
        )
        if deleted_only:
            return qs.filter(is_deleted=True)
        if not include_deleted:
            return qs.filter(is_deleted=False)
        return qs

    def _apply_search(self, qs):
        q = (self.request.query_params.get("q") or "").strip()
        if not q:
            return qs
        return qs.filter(models.Q(name__icontains=q) | models.Q(code__icontains=q))

    def get_queryset(self):
        # Ojo: Count("policies") requiere que Policy.product tenga related_name="policies"
        # Si no lo tiene, reemplazá por Count("policy") correcto según tu related_name real.
        qs = Product.objects.all().annotate(policy_count=Count("policies")).order_by("id")
        action = getattr(self, "action", None)
        if action != "restore":
            qs = self._apply_deleted_filters(qs)
        qs = self._apply_search(qs)
        return qs

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self._detach_policies(instance)
        instance.soft_delete()
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

    @decorators.action(detail=False, methods=["get"], url_path="deleted")
    def deleted(self, request):
        qs = Product.objects.all().annotate(policy_count=Count("policies")).order_by("-id")
        qs = qs.filter(is_deleted=True)
        qs = self._apply_search(qs)
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(qs, many=True)
        return response.Response(serializer.data)

    @decorators.action(detail=True, methods=["post"], url_path="restore")
    def restore(self, request, pk=None):
        instance = Product.objects.all().get(pk=pk)
        instance.restore()
        serializer = self.get_serializer(instance)
        return response.Response(serializer.data, status=status.HTTP_200_OK)
