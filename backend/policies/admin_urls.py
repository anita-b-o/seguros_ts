# backend/policies/admin_urls.py
from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AdminPolicyViewSet

# =========================
# Router canónico (SIN slash final)
# Base (según include): /api/admin/policies/
# Endpoints canónicos:
#   /api/admin/policies/policies
#   /api/admin/policies/policies/<pk>
#   /api/admin/policies/policies/<pk>/<action>
#
# NOTA:
# - trailing_slash=False: rutas canónicas sin "/" final
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

# List / Create (alias con slash)
admin_policies_list_view = AdminPolicyViewSet.as_view({"get": "list", "post": "create"})

# Detail CRUD (alias con slash)
admin_policies_detail_view = AdminPolicyViewSet.as_view(
    {
        "get": "retrieve",
        "put": "update",
        "patch": "partial_update",
        "delete": "destroy",
    }
)

# Actions custom (alias con slash)
admin_policies_deleted_view = AdminPolicyViewSet.as_view({"get": "deleted"})
admin_policies_restore_view = AdminPolicyViewSet.as_view({"post": "restore"})
admin_policies_mark_paid_view = AdminPolicyViewSet.as_view({"post": "mark_paid"})

# ✅ NUEVAS (las que te estaban tirando 404 desde el FE con slash final)
admin_policies_adjustment_count_view = AdminPolicyViewSet.as_view({"get": "adjustment_count"})
admin_policies_stats_view = AdminPolicyViewSet.as_view({"get": "stats"})

urlpatterns = (
    router.urls
    + [
        # =========================
        # Aliases legacy CON slash
        # (compat con FE que consume con / final)
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

        # Deleted
        path(
            "policies/deleted/",
            admin_policies_deleted_view,
            name="admin-policies-deleted-slash",
        ),

        # Restore
        path(
            "policies/<int:pk>/restore/",
            admin_policies_restore_view,
            name="admin-policies-restore-slash",
        ),

        # Mark paid (manual/admin)
        path(
            "policies/<int:pk>/mark-paid/",
            admin_policies_mark_paid_view,
            name="admin-policies-mark-paid-slash",
        ),

        # ✅ Adjustment count (lo usa AdminHome)
        path(
            "policies/adjustment-count/",
            admin_policies_adjustment_count_view,
            name="admin-policies-adjustment-count-slash",
        ),

        # ✅ Stats (lo usa AdminPoliciesPage)
        path(
            "policies/stats/",
            admin_policies_stats_view,
            name="admin-policies-stats-slash",
        ),
    ]
)
