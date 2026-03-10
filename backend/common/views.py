from rest_framework import permissions, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from common.authentication import OptionalAuthenticationMixin, SoftJWTAuthentication
from .models import ContactInfo, AppSettings, Announcement
from .serializers import ContactInfoSerializer, AppSettingsSerializer, AnnouncementSerializer


class ContactInfoView(OptionalAuthenticationMixin, APIView):
    """PUBLIC ENDPOINT: acepta SoftJWT opcional y no depende de request.user."""

    permission_classes = [permissions.AllowAny]
    optional_soft_purpose = SoftJWTAuthentication.PURPOSE_PUBLIC

    def get(self, request):
        obj = ContactInfo.get_solo()
        data = ContactInfoSerializer(obj).data
        return Response(data)

    def patch(self, request):
        obj = ContactInfo.get_solo()
        serializer = ContactInfoSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    put = patch


class AppSettingsView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        obj = AppSettings.get_solo()
        return Response(AppSettingsSerializer(obj).data)

    def patch(self, request):
        obj = AppSettings.get_solo()
        serializer = AppSettingsSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(serializer.data)

    put = patch


class AnnouncementViewSet(OptionalAuthenticationMixin, viewsets.ModelViewSet):
    """
    CRUD admin + listado público de anuncios.
    """
    queryset = Announcement.objects.all().order_by("order", "-created_at")
    serializer_class = AnnouncementSerializer
    PUBLIC_ACTIONS = {"list", "retrieve"}

    def _resolve_action(self):
        action = getattr(self, "action", None)
        if action:
            return action

        req = getattr(self, "request", None)
        if req is None:
            return None

        method = req.method.lower()
        action_map = getattr(self, "action_map", None)
        if action_map:
            mapped = action_map.get(method)
            if mapped:
                return mapped

        if method == "get":
            kwargs = getattr(self, "kwargs", None) or {}
            lookup_field = getattr(self, "lookup_field", "pk")
            if kwargs.get(lookup_field) is not None or kwargs.get("pk") is not None:
                return "retrieve"
            return "list"

        return None

    def get_permissions(self):
        action = self._resolve_action()
        if action in self.PUBLIC_ACTIONS:
            return [permissions.AllowAny()]
        return super().get_permissions()

    def should_use_optional_authentication(self):
        return self._resolve_action() in self.PUBLIC_ACTIONS

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            return qs.filter(is_active=True)
        if self.action == "retrieve":
            user = getattr(self.request, "user", None)
            if user and user.is_authenticated and user.is_staff:
                return qs
            return qs.filter(is_active=True)
        return qs
