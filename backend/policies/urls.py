# backend/policies/urls.py
from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import PolicyViewSet

# ======================================================
# Router público (cliente)
# Base: /api/policies/  (montado en backend/urls.py)
#
# NOTAS:
# - trailing_slash=False → endpoints SIN slash final
#   (alineado con el frontend actual)
# - El router se monta con "/" en el include para evitar
#   concatenaciones raras en reverses/routing.
# ======================================================
policies_router = DefaultRouter(trailing_slash=False)
policies_router.register(r"", PolicyViewSet, basename="policies")

# ======================================================
# Actions legacy / compatibilidad
# ======================================================
# El frontend histórico llama receipts con slash explícito:
# /api/policies/<pk>/receipts/
receipts_view = PolicyViewSet.as_view({"get": "receipts"})

urlpatterns = (
    policies_router.urls
    + [
        # Mantener receipts con slash (legacy FE)
        path("<int:pk>/receipts/", receipts_view, name="policies-receipts-slash"),
    ]
)
