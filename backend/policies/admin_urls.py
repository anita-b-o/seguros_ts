from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import AdminPolicyViewSet

# trailing_slash=False para aceptar /api/admin/policies/policies sin barra final
router = DefaultRouter(trailing_slash=False)
router.register(r"policies", AdminPolicyViewSet, basename="admin-policies")

admin_policies_list_view = AdminPolicyViewSet.as_view(
    {"get": "list", "post": "create"}
)
admin_policies_detail_view = AdminPolicyViewSet.as_view(
    {
        "get": "retrieve",
        "put": "update",
        "patch": "partial_update",
        "delete": "destroy",
    }
)

urlpatterns = router.urls + [
    path("policies/", admin_policies_list_view, name="admin-policies-list-slash"),
    path("policies/<int:pk>/", admin_policies_detail_view, name="admin-policies-detail-slash"),
]
