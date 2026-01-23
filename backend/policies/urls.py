from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import PolicyViewSet

# =========================
# Router público (cliente)
# /api/policies/...
# =========================
policies_router = DefaultRouter(trailing_slash=False)
policies_router.register(r"", PolicyViewSet, basename="policies")

# =========================
# Actions legacy
# =========================
# El frontend histórico llama receipts con slash explícito
receipts_view = PolicyViewSet.as_view({"get": "receipts"})

urlpatterns = (
    policies_router.urls
    + [
        # Mantener receipts con slash (legacy FE)
        path(
            "<int:pk>/receipts/",
            receipts_view,
            name="policies-receipts-slash",
        ),
    ]
)
