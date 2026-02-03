# backend/products/urls.py
from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ProductViewSet, HomeProductsListView, ProductAdminViewSet

# =========================
# Admin router:
# /api/admin/products/insurance-types/...
# =========================
admin_router = DefaultRouter(trailing_slash=False)
admin_router.register(r"insurance-types", ProductAdminViewSet, basename="admin-insurance-types")

# =========================
# Público:
# /api/products/...
# =========================
list_view = ProductViewSet.as_view({"get": "list"})
detail_view = ProductViewSet.as_view({"get": "retrieve"})
admin_deleted_view = ProductAdminViewSet.as_view({"get": "deleted"})

urlpatterns = [
    path("", list_view, name="products-list"),
    path("<int:pk>/", detail_view, name="products-detail"),
    path("<int:pk>", detail_view, name="products-detail-noslash"),

    path("home/", HomeProductsListView.as_view(), name="products-home"),
    path("home", HomeProductsListView.as_view(), name="products-home-noslash"),
]

# Admin endpoints
urlpatterns += admin_router.urls
urlpatterns += [
    path("insurance-types/deleted/", admin_deleted_view, name="admin-insurance-types-deleted-slash"),
    path("insurance-types/deleted", admin_deleted_view, name="admin-insurance-types-deleted-noslash"),
]
