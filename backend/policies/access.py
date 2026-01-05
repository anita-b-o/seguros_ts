from django.shortcuts import get_object_or_404

from policies.models import Policy


def policy_scope_queryset(queryset, request):
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        return queryset.none()
    if user.is_staff or user.is_superuser:
        return queryset
    return queryset.filter(user=user)


def get_scoped_policy_or_404(request, **lookup):
    base_qs = policy_scope_queryset(Policy.objects.all(), request)
    return get_object_or_404(base_qs, **lookup)
