from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import ProductAdminViewSet

# trailing_slash=False para aceptar /api/admin/insurance-types sin barra final
router = DefaultRouter(trailing_slash=False)
router.register(r"insurance-types", ProductAdminViewSet, basename="admin-insurance-types")

admin_insurance_list_view = ProductAdminViewSet.as_view(
    {"get": "list", "post": "create"}
)

admin_insurance_detail_view = ProductAdminViewSet.as_view(
    {
        "get": "retrieve",
        "put": "update",
        "patch": "partial_update",
        "delete": "destroy",
    }
)
admin_insurance_deleted_view = ProductAdminViewSet.as_view({"get": "deleted"})
admin_insurance_restore_view = ProductAdminViewSet.as_view({"post": "restore"})

urlpatterns = router.urls + [
    path(
        "insurance-types/",
        admin_insurance_list_view,
        name="admin-insurance-types-list-slash",
    ),
    path(
        "insurance-types/<int:pk>/",
        admin_insurance_detail_view,
        name="admin-insurance-types-detail-slash",
    ),
    path(
        "insurance-types/<int:pk>/restore/",
        admin_insurance_restore_view,
        name="admin-insurance-types-restore-slash",
    ),
    path(
        "insurance-types/<int:pk>/restore",
        admin_insurance_restore_view,
        name="admin-insurance-types-restore-noslash",
    ),
    path(
        "insurance-types/deleted/",
        admin_insurance_deleted_view,
        name="admin-insurance-types-deleted-slash",
    ),
    path(
        "insurance-types/deleted",
        admin_insurance_deleted_view,
        name="admin-insurance-types-deleted-noslash",
    ),
]
