import logging
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.utils.module_loading import import_string
from rest_framework import permissions
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import SAFE_METHODS

from .authentication import PublicUserProxy, SoftJWTAuthentication, StrictJWTAuthentication

logger = logging.getLogger(__name__)


def _resolve_authentication_class(auth_class):
    if isinstance(auth_class, str):
        return import_string(auth_class)
    if isinstance(auth_class, type):
        return auth_class
    if auth_class is None:
        return None
    return getattr(auth_class, "__class__", None)


def _handle_guard_violation(view, message, *, always_raise=False):
    if always_raise or settings.DEBUG:
        raise ImproperlyConfigured(message)
    logger.warning("%s", message, extra={"view": view.__class__.__name__})


class EndpointAccessGuardMixin:
    """
    Shared guard logic for PUBLIC/PRIVATE mixins; enforces classification.
    """

    endpoint_access = None  # type: ignore[assignment]
    public_write_allowed = False

    def initial(self, request, *args, **kwargs):
        drf_request = super().initial(request, *args, **kwargs)
        guard_request = request or drf_request
        self._enforce_guard_rules(guard_request)
        return drf_request

    def _enforce_guard_rules(self, request):
        access = self._normalize_endpoint_access()
        if access == "public":
            self._ensure_public_rules(request)
        elif access == "private":
            self._ensure_private_rules()

    def _normalize_endpoint_access(self):
        raw = getattr(self, "endpoint_access", None)
        if raw is None:
            return None
        if not isinstance(raw, str):
            raw = str(raw)
        normalized = raw.strip().lower()
        if normalized in {"private", "priv", "privado"}:
            return "private"
        if normalized in {"public", "pub", "publico"}:
            return "public"
        return normalized

    def _ensure_public_rules(self, request):
        method = getattr(request, "method", None)
        if not method and hasattr(request, "_request"):
            method = getattr(request._request, "method", None)
        method = (method or "GET").upper()
        if method not in SAFE_METHODS and not getattr(self, "public_write_allowed", False):
            msg = (
                f"{self.__class__.__name__} is marked as public but handles {method} "
                "without `public_write_allowed = True`. Make writes intentional."
            )
            _handle_guard_violation(self, msg)

    def _ensure_private_rules(self):
        for auth_cls in self._iter_authentication_classes():
            if self._is_soft_authentication(auth_cls):
                msg = (
                    f"{self.__class__.__name__} is private but uses SoftJWTAuthentication "
                    "which tolerates invalid tokens. Use StrictJWTAuthentication instead."
                )
                _handle_guard_violation(self, msg, always_raise=True)

    def _iter_authentication_classes(self):
        declared = getattr(self, "authentication_classes", None)
        sources = list(declared) if declared else []
        if not sources:
            defaults = getattr(settings, "REST_FRAMEWORK", {}).get("DEFAULT_AUTHENTICATION_CLASSES", [])
            sources.extend(defaults)
        resolved_classes = []
        for entry in sources:
            resolved = _resolve_authentication_class(entry)
            if resolved and resolved not in resolved_classes:
                resolved_classes.append(resolved)
        try:
            authenticators = self.get_authenticators()
        except Exception:
            authenticators = []
        for authenticator in authenticators:
            cls = _resolve_authentication_class(authenticator)
            if cls and cls not in resolved_classes:
                resolved_classes.append(cls)
        for cls in resolved_classes:
            yield cls

    def _is_soft_authentication(self, auth_cls):
        if auth_cls is None:
            return False
        try:
            if issubclass(auth_cls, SoftJWTAuthentication):
                return True
        except TypeError:
            pass
        name = getattr(auth_cls, "__name__", "")
        module = getattr(auth_cls, "__module__", "")
        if name == "SoftJWTAuthentication":
            return True
        if name.endswith("SoftJWTAuthentication") and module.endswith(".authentication"):
            return True
        return False


class PublicEndpointMixin(EndpointAccessGuardMixin):
    """
    Simplifica la definición de vistas públicas alineadas con SoftJWT + AllowAny.
    """

    endpoint_access = "public"
    permission_classes = [permissions.AllowAny]

    public_write_allowed = False

    def get_authenticators(self):
        return [SoftJWTAuthentication(purpose=SoftJWTAuthentication.PURPOSE_PUBLIC)]



class PrivateEndpointMixin(EndpointAccessGuardMixin):
    """
    Aplica StrictJWT + IsAuthenticated para garantizar endpoints protegidos.
    """

    endpoint_access = "private"
    permission_classes = [permissions.IsAuthenticated]
    authentication_classes = [StrictJWTAuthentication]


class DebugOnlyAdminMixin:
    """
    Helper para evitar que actions o views de debug salgan a producción.
    """

    def _require_debug_admin(self, request):
        if not settings.DEBUG:
            raise NotFound()
        if not (request.user and request.user.is_authenticated and request.user.is_staff):
            raise PermissionDenied()
