from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AdminPolicyViewSet

# =========================
# Router canónico (SIN slash final)
# /api/admin/policies/policies
# =========================
router = DefaultRouter(trailing_slash=False)
router.register(
    r"policies",
    AdminPolicyViewSet,
    basename="admin-policies",
)

# =========================
# Views explícitas (aliases con slash)
# =========================
admin_policies_list_view = AdminPolicyViewSet.as_view(
    {
        "get": "list",
        "post": "create",
    }
)

admin_policies_detail_view = AdminPolicyViewSet.as_view(
    {
        "get": "retrieve",
        "put": "update",
        "patch": "partial_update",
        "delete": "destroy",
    }
)

# Actions custom
admin_policies_deleted_view = AdminPolicyViewSet.as_view({"get": "deleted"})
admin_policies_restore_view = AdminPolicyViewSet.as_view({"post": "restore"})
admin_policies_mark_paid_view = AdminPolicyViewSet.as_view({"post": "mark_paid"})

urlpatterns = (
    router.urls
    + [
        # =========================
        # Aliases legacy CON slash
        # =========================

        # List / Create
        path(
            "policies/",
            admin_policies_list_view,
            name="admin-policies-list-slash",
        ),

        # Detail
        path(
            "policies/<int:pk>/",
            admin_policies_detail_view,
            name="admin-policies-detail-slash",
        ),

        # Deleted (FIX CRÍTICO)
        # El frontend llama /api/admin/policies/policies/deleted/
        path(
            "policies/deleted/",
            admin_policies_deleted_view,
            name="admin-policies-deleted-slash",
        ),

        # Restore (consistente con deleted)
        path(
            "policies/<int:pk>/restore/",
            admin_policies_restore_view,
            name="admin-policies-restore-slash",
        ),

        # Mark paid (manual/admin) - alias con slash
        # Frontend recomendado: POST /api/admin/policies/policies/<id>/mark-paid/
        path(
            "policies/<int:pk>/mark-paid/",
            admin_policies_mark_paid_view,
            name="admin-policies-mark-paid-slash",
        ),
    ]
)
