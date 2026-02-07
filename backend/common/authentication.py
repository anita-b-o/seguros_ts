from django.conf import settings
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError


class CookieJWTAuthentication(JWTAuthentication):
    """
    JWTAuthentication that also supports access tokens in HttpOnly cookies.
    """

    def get_header(self, request):
        header = super().get_header(request)
        if header:
            return header

        cookie_name = getattr(settings, "JWT_ACCESS_COOKIE", None)
        if not cookie_name:
            return None
        token = request.COOKIES.get(cookie_name)
        if not token:
            return None
        return f"Bearer {token}".encode()


class StrictJWTAuthentication(CookieJWTAuthentication):
    """Explicit reference to the default JWT guard so intent is clear in PRIVATE endpoints."""


class SoftJWTAuthentication(CookieJWTAuthentication):
    """
    Like JWTAuthentication but never raises InvalidToken/ExpiredToken for requests that
    have been marked as PUBLIC/HYBRID by the authenticator mixins.
    """

    PURPOSE_PUBLIC = "public"
    PURPOSE_HYBRID = "hybrid"
    ALLOWED_PURPOSES = {PURPOSE_PUBLIC, PURPOSE_HYBRID}

    def __init__(self, *, purpose: str):
        if purpose not in self.ALLOWED_PURPOSES:
            raise ValueError("SoftJWTAuthentication requires a validated purpose.")
        self.purpose = purpose
        super().__init__()

    def authenticate(self, request):
        header = self.get_header(request)
        if not header:
            return None

        try:
            return super().authenticate(request)
        except (InvalidToken, TokenError, AuthenticationFailed, UnicodeError, ValueError):
            return None


class PublicUserProxy:
    """Guard object returned by PUBLIC endpoints so request.user can't be used accidentally."""

    is_authenticated = False
    is_anonymous = True

    def __bool__(self):
        return False

    def __getattr__(self, name):
        raise RuntimeError(
            "Public endpoints must not access request.user directly. "
            "Switch to a HYBRID/private endpoint if you need the authenticated user."
        )



class OptionalAuthenticationMixin:
    """
    For views that are mostly public but optionally consume a JWT when provided.
    The view must explicitly opt-in by overriding should_use_optional_authentication().
    """

    optional_soft_purpose = SoftJWTAuthentication.PURPOSE_HYBRID

    def should_use_optional_authentication(self):
        """
        Override this method to limit when SoftJWTAuthentication kicks in.
        """
        return True

    def get_authenticators(self):
        if self.should_use_optional_authentication():
            return [SoftJWTAuthentication(purpose=self.optional_soft_purpose)]
        return super().get_authenticators()
