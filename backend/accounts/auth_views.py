import hashlib
import logging
import os
import re
try:
    import requests
except ImportError:
    requests = None
from rest_framework import permissions, status, views, response
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from django.core.validators import validate_email
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.contrib.auth import authenticate
from django.contrib.auth import get_user_model
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.mail import send_mail
from django.core.cache import cache
from django.conf import settings
from accounts.utils.otp import (
    build_otp_payload,
    constant_time_compare,
    generate_otp,
    get_payload_remaining_ttl,
    otp_hash,
)
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.permissions import IsAuthenticated
from .serializers import UserSerializer
from django.urls import reverse
from django.utils.crypto import get_random_string
from common.security import PublicEndpointMixin

logger = logging.getLogger(__name__)

GOOGLE_AUTH_AVAILABLE = False
google_auth_exceptions = None
google_auth_requests = None
google_id_token = None
try:
    from google.auth import exceptions as google_auth_exceptions
    from google.auth.transport import requests as google_auth_requests
    from google.oauth2 import id_token as google_id_token
    GOOGLE_AUTH_AVAILABLE = True
except ImportError:
    logger.debug("google-auth extras no disponibles; deshabilitando Google Login.")
    GOOGLE_AUTH_AVAILABLE = False

User = get_user_model()

def _bool(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "t", "yes", "y", "on")


def _mask_email(email: str):
    if not email or "@" not in email:
        return "correo desconocido"
    name, domain = email.split("@", 1)
    if len(name) <= 2:
        masked_name = name[0] + "***"
    else:
        masked_name = name[0] + "***" + name[-1]
    return f"{masked_name}@{domain}"


def _normalize_rate_identifier(value: str) -> str:
    """
    Normalize the identifier so the rate-limit key stays within sane character ranges.
    """
    normalized = (value or "").strip()
    normalized = re.sub(r"[^a-zA-Z0-9@._:=|-]", "_", normalized)
    return normalized or "unknown"


class CacheUnavailable(Exception):
    """Raised when the shared cache cannot be used for OTP/rate limiting."""


def _cache_failure(operation, exc):
    logger.critical(
        "cache_unavailable",
        extra={"cache_op": operation},
    )
    raise CacheUnavailable from exc


def _cache_get_safe(key, default=None):
    try:
        return cache.get(key, default)
    except Exception as exc:
        _cache_failure("cache_get", exc)


def _cache_set_safe(key, value, timeout=None):
    try:
        return cache.set(key, value, timeout=timeout)
    except Exception as exc:
        _cache_failure("cache_set", exc)


def _cache_add_safe(key, value, timeout=None):
    try:
        return cache.add(key, value, timeout=timeout)
    except Exception as exc:
        _cache_failure("cache_add", exc)


def _cache_delete_safe(key):
    try:
        return cache.delete(key)
    except Exception as exc:
        _cache_failure("cache_delete", exc)


def _cache_unavailable_response():
    return Response(
        {
            "detail": "Servicio temporalmente no disponible. Intentá nuevamente en unos minutos.",
            "require_otp": True,
        },
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


def _get_client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.META.get("REMOTE_ADDR") or "unknown"


def _build_rate_identifier(request=None, *, user=None, email=None, phone=None):
    parts = []
    if user:
        parts.append(f"uid={user.id}")
    if email:
        parts.append(f"email={email}")
    if phone:
        parts.append(f"phone={phone}")
    ip = _get_client_ip(request) if request else "unknown"
    parts.append(f"ip={ip}")
    joined = "|".join(parts)
    return _normalize_rate_identifier(joined)


def _rate_limit_key(action: str, identifier: str) -> str:
    return f"rl:{action}:{identifier}"


def _rate_limit_check(action: str, identifier: str, limit: int, window: int):
    key = _rate_limit_key(action, identifier)
    attempts = _increment_rate_counter(key, window)
    return attempts <= limit, attempts


def _normalize_origin(value: str) -> str:
    return value.rstrip("/") if value else value


def _resolve_frontend_origin(request=None):
    allowed = getattr(settings, "FRONTEND_ORIGINS", []) or []
    explicit = (getattr(settings, "FRONTEND_ORIGIN", "") or "").strip()
    request_origin = (request.META.get("HTTP_ORIGIN") or "").strip() if request else ""
    if request_origin:
        for candidate in allowed:
            if _normalize_origin(candidate) == _normalize_origin(request_origin):
                return _normalize_origin(request_origin)
    if explicit:
        return _normalize_origin(explicit)
    if allowed:
        return _normalize_origin(allowed[0])
    if settings.DEBUG:
        return "http://localhost:5173"
    logger.error("FRONTEND_ORIGINS/FRONTEND_ORIGIN missing while DEBUG=False.")
    raise ImproperlyConfigured(
        "FRONTEND_ORIGIN or FRONTEND_ORIGINS is required when DEBUG=False."
    )


def _derive_google_dni(sub: str):
    prefix = "g"
    raw = (sub or "").strip()
    if not raw:
        raw = get_random_string(16)
    candidate = f"{prefix}{raw}"
    if len(candidate) <= 20:
        return candidate
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()
    return f"{prefix}{digest[:19]}"


def _send_email_code(email: str, code: str):
    """
    Envía el código 2FA por email (ingresado en login).
    """
    if not email:
        logger.warning("No se pudo enviar código 2FA: email vacío.")
        return False
    subject = "Código de verificación - Acceso administrador"
    message = (
        f"Tu código de acceso es: {code}\n"
        "Tiene validez de 5 minutos.\n\n"
        "Si no solicitaste este ingreso, podés ignorar este mensaje."
    )
    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@sancayetano.com")
    try:
        send_mail(
            subject,
            message,
            from_email,
            [email],
            fail_silently=False,
        )
        return True
    except Exception as exc:  # pragma: no cover - side effect externo
        logger.warning("No se pudo enviar el código por email: %s", exc)
        return False


def _send_whatsapp_code(phone: str, code: str):
    """
    Envía (o al menos registra) el código 2FA por WhatsApp.
    Si se configura WHATSAPP_WEBHOOK_URL, intentamos hacer POST con {to, message}.
    Caso contrario, se loguea para entorno de pruebas.
    """
    message = f"Tu código de acceso (admin) es: {code}. Vence en 5 minutos."
    webhook = os.getenv("WHATSAPP_WEBHOOK_URL")
    if webhook:
        if not requests:
            logger.warning(
                "requests no instalado; no se puede enviar WhatsApp",
                extra={"phone": phone},
            )
            return False
        try:
            requests.post(
                webhook,
                json={"to": phone, "message": message},
                timeout=5,
            )
            return True
        except Exception as exc:  # pragma: no cover - side effect externo
            logger.warning("No se pudo enviar el código por WhatsApp: %s", exc)
            return False
    logger.info("[2FA admin] Enviar a %s: %s", phone or "(sin teléfono)", message)
    return True


def _build_reset_link(user, request=None):
    origin = _resolve_frontend_origin(request)
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = PasswordResetTokenGenerator().make_token(user)
    return f"{origin}/reset/confirm?uid={uid}&token={token}"


def _send_onboarding(user, request=None, *, send_otp: bool = True):
    """
    Envía link de acceso + OTP opcional por email y WhatsApp (si hay webhook).
    """
    link = _build_reset_link(user, request=request)
    otp = None
    if send_otp:
        otp = generate_otp()
        payload = build_otp_payload(otp)
        _cache_set_safe(f"onboarding_otp:{user.id}", payload, timeout=settings.OTP_TIMEOUT_SECONDS)

    # Email con link + OTP
    if user.email:
        parts = [
            "Bienvenido/a a San Cayetano Seguros.",
            f"Establecé tu contraseña acá: {link}",
        ]
        if otp:
            parts.append(f"Tu código de acceso es: {otp} (10 minutos de validez).")
        try:
            send_mail(
                "Accedé a tu cuenta",
                "\n".join(parts),
                None,
                [user.email],
                fail_silently=False,
            )
        except Exception as exc:
            logger.error("onboarding_email_failed", extra={"user_id": user.id, "email": user.email, "error": str(exc)})

    # WhatsApp opcional
    phone = getattr(user, "phone", "") or ""
    webhook = os.getenv("WHATSAPP_WEBHOOK_URL")
    if phone and webhook:
        if not requests:
            logger.warning("requests no está instalado; no se puede enviar WhatsApp.")
            return otp
        msg = f"Accedé a tu cuenta: {link}"
        if otp:
            msg += f" | Código: {otp}"
        try:
            requests.post(webhook, json={"to": phone, "message": msg}, timeout=5)
        except Exception as exc:  # pragma: no cover
            logger.warning("onboarding_whatsapp_failed", extra={"user_id": user.id, "phone": phone, "error": str(exc)})
    return otp


def _increment_rate_counter(rate_key, cooldown):
    _cache_add_safe(rate_key, 0, timeout=cooldown)
    try:
        return cache.incr(rate_key)
    except (ValueError, NotImplementedError):
        if not settings.DEBUG:
            raise
        current = _cache_get_safe(rate_key, 0)
        next_value = current + 1
        ttl = None
        ttl_func = getattr(cache, "ttl", None)
        if callable(ttl_func):
            try:
                ttl = ttl_func(rate_key)
            except Exception:
                ttl = None
        timeout = ttl if ttl and ttl > 0 else cooldown
        _cache_set_safe(rate_key, next_value, timeout=timeout)
        return next_value
    except Exception as exc:
        _cache_failure("cache_incr", exc)


class EmailLoginView(PublicEndpointMixin, APIView):
    """
    Endpoint de login compatible con el frontend mock (/auth/login).
    Permite iniciar sesión por email (o DNI como fallback) y devuelve access/refresh + datos de usuario.
    """
    permission_classes = [AllowAny]
    throttle_scope = "login"
    # Este POST expone un write público controlado (solo devuelve tokens).
    public_write_allowed = True

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        password = request.data.get("password") or ""
        otp = (request.data.get("otp") or "").strip()
        if not email or not password:
            return Response({"detail": "Email y contraseña requeridos."}, status=status.HTTP_400_BAD_REQUEST)

        # Buscamos usuario por email; si no, intentamos por DNI con el mismo valor
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            user = User.objects.filter(dni=email).first()
        if not user:
            return Response({"detail": "Credenciales inválidas."}, status=status.HTTP_401_UNAUTHORIZED)

        if not user.check_password(password):
            return Response({"detail": "Credenciales inválidas."}, status=status.HTTP_401_UNAUTHORIZED)
        if not user.is_active:
            return Response({"detail": "La cuenta está inactiva. Contactá al administrador."}, status=status.HTTP_403_FORBIDDEN)

        # Doble verificación para staff/admin
        if user.is_staff:
            try:
                cache_key = f"admin_otp:{user.id}"
                payload = _cache_get_safe(cache_key)
                rate_identifier = _build_rate_identifier(request, user=user, email=email)
                send_limit = settings.OTP_RATE_LIMIT_SEND_COUNT
                send_window = settings.OTP_RATE_LIMIT_SEND_WINDOW
                verify_limit = settings.OTP_RATE_LIMIT_VERIFY_COUNT
                verify_window = settings.OTP_RATE_LIMIT_VERIFY_WINDOW
                max_attempts = settings.OTP_VERIFY_MAX_ATTEMPTS
                otp_window = settings.OTP_TIMEOUT_SECONDS

                if otp:
                    allowed, _ = _rate_limit_check(
                        "otp_verify",
                        rate_identifier,
                        verify_limit,
                        verify_window,
                    )
                    if not allowed:
                        return Response(
                            {"detail": "Demasiados intentos. Esperá unos minutos e intentá nuevamente.", "require_otp": True},
                            status=status.HTTP_429_TOO_MANY_REQUESTS,
                        )
                    has_payload = bool(payload)
                    valid = False
                    if has_payload:
                        candidate_hash = otp_hash(otp, payload["salt"])
                        valid = constant_time_compare(payload["hash"], candidate_hash)
                    if not valid:
                        if payload:
                            attempts = payload.get("attempts", 0) + 1
                            remaining_ttl = get_payload_remaining_ttl(payload)
                            if remaining_ttl <= 0:
                                _cache_delete_safe(cache_key)
                            else:
                                payload["attempts"] = attempts
                                _cache_set_safe(cache_key, payload, timeout=max(remaining_ttl, 1))
                            if attempts >= max_attempts:
                                _cache_delete_safe(cache_key)
                                return Response(
                                    {
                                        "detail": "Demasiados intentos. Esperá unos minutos e intentá nuevamente.",
                                        "require_otp": True,
                                    },
                                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                                )
                        return Response(
                            {
                                "detail": "Código inválido o expirado.",
                                "require_otp": True,
                                "otp_sent_to": _mask_email(email),
                                "otp_ttl_seconds": otp_window,
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    _cache_delete_safe(cache_key)
                else:
                    allowed, _ = _rate_limit_check(
                        "otp_send",
                        rate_identifier,
                        send_limit,
                        send_window,
                    )
                    if not allowed:
                        return Response(
                            {
                                "detail": "Demasiados envíos de código. Esperá unos minutos e intentá nuevamente.",
                                "require_otp": True,
                            },
                            status=status.HTTP_429_TOO_MANY_REQUESTS,
                        )
                    code = generate_otp()
                    payload = build_otp_payload(code)
                    _cache_set_safe(cache_key, payload, timeout=otp_window)
                    _send_email_code(email, code)
                    return Response(
                        {
                            "detail": "Te enviamos un código a tu email. Ingresalo para continuar.",
                            "require_otp": True,
                            "otp_sent_to": _mask_email(email),
                            "otp_ttl_seconds": otp_window,
                        },
                        status=status.HTTP_202_ACCEPTED,
                    )
            except CacheUnavailable:
                return _cache_unavailable_response()

        refresh = RefreshToken.for_user(user)
        data = {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": UserSerializer(user).data,
        }
        return Response(data)


class PasswordResetRequestView(PublicEndpointMixin, views.APIView):
    """
    Recibe un email y genera un token de reseteo si el usuario existe.
    Devuelve 200 siempre para evitar enumeración de usuarios.
    """

    permission_classes = [AllowAny]
    throttle_scope = "reset"
    public_write_allowed = True  # POST intencional para solicitar reset

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        if not email:
            return response.Response({"detail": "Email requerido."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            # Respuesta ciega para no permitir enumeración de correos.
            return response.Response({"detail": "Te enviamos un correo con instrucciones."}, status=status.HTTP_200_OK)

        try:
            reset_link = _build_reset_link(user, request=request)
        except ImproperlyConfigured as exc:
            logger.error("password_reset_missing_origin", extra={"user_id": user.id, "error": str(exc)})
            return response.Response(
                {"detail": "No se pudo construir el enlace de reseteo. Revisá FRONTEND_ORIGIN/FRONTEND_ORIGINS."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Enviamos email con el link de reseteo (usa el backend configurado)
        subject = "Recuperá tu contraseña"
        message = (
            "Solicitaste restablecer tu contraseña.\n\n"
            f"Usá este enlace para continuar: {reset_link}\n\n"
            "Si no fuiste vos, ignorá este mensaje."
        )
        try:
            send_mail(
                subject,
                message,
                None,  # usa DEFAULT_FROM_EMAIL
                [user.email],
                fail_silently=False,
            )
        except Exception:
            return response.Response({"detail": "No se pudo enviar el email. Revisá la configuración SMTP."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return response.Response({"detail": "Te enviamos un correo con instrucciones."}, status=status.HTTP_200_OK)


class PasswordResetConfirmView(PublicEndpointMixin, views.APIView):
    """
    Confirma el reseteo de contraseña usando uid y token.
    """

    permission_classes = [AllowAny]
    throttle_scope = "reset"
    public_write_allowed = True  # POST obligatorio para confirmar el nuevo password

    def post(self, request):
        uidb64 = request.data.get("uid")
        token = request.data.get("token")
        new_password = request.data.get("new_password")

        if not uidb64 or not token or not new_password:
            return response.Response({"detail": "Datos incompletos."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=uid)
        except (User.DoesNotExist, ValueError, TypeError):
            return response.Response({"detail": "Enlace inválido o expirado."}, status=status.HTTP_400_BAD_REQUEST)

        if not PasswordResetTokenGenerator().check_token(user, token):
            return response.Response({"detail": "Enlace inválido o expirado."}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save(update_fields=["password"])
        return response.Response({"detail": "Contraseña actualizada."}, status=status.HTTP_200_OK)


class RegisterView(PublicEndpointMixin, APIView):
    """
    Registro público de usuarios.
    Devuelve access/refresh + datos del usuario.
    """

    permission_classes = [AllowAny]
    throttle_scope = "register"
    public_write_allowed = True  # POST público con validaciones explícitas

    def post(self, request):
        data = request.data or {}
        email = (data.get("email") or "").strip().lower()
        dni = (data.get("dni") or "").strip()
        password = data.get("password") or ""
        first_name = (data.get("first_name") or "").strip()
        last_name = (data.get("last_name") or "").strip()
        phone = (data.get("phone") or "").strip()
        birth_date = data.get("dob") or data.get("birth_date")

        if not email or not dni or not password:
            return Response({"detail": "Email, DNI y contraseña son obligatorios."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_email(email)
        except ValidationError:
            return Response({"detail": "Email inválido."}, status=status.HTTP_400_BAD_REQUEST)

        if len(password) < 8 or password.isalpha() or password.isdigit():
            return Response(
                {"detail": "La contraseña debe tener mínimo 8 caracteres e incluir letras y números."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(email__iexact=email).exists():
            return Response({"detail": "El email ya está registrado."}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(dni=dni).exists():
            return Response({"detail": "El DNI ya está registrado."}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.create_user(
            dni=dni,
            password=password,
            email=email,
            first_name=first_name,
            last_name=last_name,
            phone=phone,
            birth_date=birth_date or None,
        )

        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": UserSerializer(user).data,
            },
            status=status.HTTP_201_CREATED,
        )


class LogoutView(APIView):
    """
    Endpoint de logout para el front que invalida el refresh token (si se envía).
    Requiere el token para poder marcarlo en la blacklist.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        refresh_token = (
            request.data.get("refresh")
            or request.data.get("refresh_token")
        )
        if not refresh_token:
            return Response(
                {"detail": "El refresh token es requerido para cerrar sesión."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            RefreshToken(refresh_token).blacklist()
        except TokenError:
            return Response(
                {"detail": "Refresh token inválido o expirado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {"detail": "Sesión cerrada."},
            status=status.HTTP_205_RESET_CONTENT,
        )


class GoogleLoginView(PublicEndpointMixin, APIView):
    """
    Endpoint que valida un id_token de Google, sincroniza o crea el usuario y retorna los tokens JWT.
    Solo está disponible si ENABLE_GOOGLE_LOGIN está habilitado.
    """
    permission_classes = [AllowAny]

    public_write_allowed = True  # POST autorizado por estar detrás de google login
    def post(self, request):
        if not _bool(os.getenv("ENABLE_GOOGLE_LOGIN")):
            # Feature flag apaga el endpoint por completo para evitar surface attack.
            return Response(
                {"detail": "Google login no disponible."},
                status=status.HTTP_404_NOT_FOUND,
            )

        id_token = (request.data.get("id_token") or "").strip()
        if not id_token:
            return Response(
                {"detail": "Falta id_token de Google."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        client_id = os.getenv("GOOGLE_CLIENT_ID")
        if not client_id:
            return Response(
                {"detail": "GOOGLE_CLIENT_ID no está definido."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if not GOOGLE_AUTH_AVAILABLE:
            logger.warning("Google login habilitado pero google-auth no está instalado.")
            return Response(
                {"detail": "Google auth dependencies not installed"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            token_payload = google_id_token.verify_oauth2_token(
                id_token,
                google_auth_requests.Request(),
                audience=client_id,
            )
        except (ValueError, google_auth_exceptions.GoogleAuthError) as exc:
            return Response(
                {"detail": f"Token de Google inválido o expirado: {exc}"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        email = (token_payload.get("email") or "").strip().lower()
        email_verified = str(token_payload.get("email_verified", "")).strip().lower() in (
            "1",
            "true",
            "yes",
            "si",
        )
        if not email:
            return Response(
                {"detail": "Google no devolvió un email válido."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not email_verified:
            return Response(
                {"detail": "El email de Google no está verificado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        first_name = (token_payload.get("given_name") or token_payload.get("name") or "").strip()
        last_name = (token_payload.get("family_name") or "").strip()
        sub = (token_payload.get("sub") or "").strip()
        issuer = (token_payload.get("iss") or "").strip().lower()
        allowed_issuers = {"accounts.google.com", "https://accounts.google.com"}
        if issuer not in allowed_issuers:
            return Response(
                {"detail": "Issuer inválido en el token de Google."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        user = User.objects.filter(email__iexact=email).first()
        if not user:
            user = User.objects.create_user(
                dni=_derive_google_dni(sub),
                email=email,
                password=None,
                first_name=first_name,
                last_name=last_name,
            )
            # Password se deja unusable para evitar login con credenciales propias.
        else:
            updates = []
            if first_name and user.first_name != first_name:
                user.first_name = first_name
                updates.append("first_name")
            if last_name and user.last_name != last_name:
                user.last_name = last_name
                updates.append("last_name")
            if updates:
                user.save(update_fields=updates)

        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": UserSerializer(user).data,
            },
            status=status.HTTP_200_OK,
        )


class GoogleLoginStatusView(PublicEndpointMixin, APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        if not _bool(os.getenv("ENABLE_GOOGLE_LOGIN")):
            return Response(
                {"detail": "Google login no disponible."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(
            {
                "google_login_enabled": True,
                "google_client_id_configured": bool(os.getenv("GOOGLE_CLIENT_ID")),
                "google_auth_available": GOOGLE_AUTH_AVAILABLE,
            },
            status=status.HTTP_200_OK,
        )


class ResendOnboardingView(APIView):
    """
    Admin: reenvía link de acceso + OTP por email y opcional WhatsApp.
    Acepta user_id o email en el payload.
    """
    permission_classes = [permissions.IsAdminUser]

    def post(self, request):
        uid = request.data.get("user_id")
        email = (request.data.get("email") or "").strip().lower()
        user = None
        if uid:
            user = User.objects.filter(id=uid).first()
        if not user and email:
            user = User.objects.filter(email__iexact=email).first()
        if not user:
            return Response({"detail": "Usuario no encontrado."}, status=status.HTTP_404_NOT_FOUND)
        identifier = _build_rate_identifier(
            request,
            user=user,
            email=user.email,
            phone=(getattr(user, "phone", "") or ""),
        )
        try:
            allowed, _ = _rate_limit_check(
                "otp_send",
                identifier,
                settings.OTP_RATE_LIMIT_SEND_COUNT,
                settings.OTP_RATE_LIMIT_SEND_WINDOW,
            )
            if not allowed:
                return Response(
                    {
                        "detail": "Demasiados envíos de código. Esperá unos minutos e intentá nuevamente.",
                    },
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )
            otp = _send_onboarding(user, request=request, send_otp=True)
        except CacheUnavailable:
            return _cache_unavailable_response()
        except ImproperlyConfigured as exc:
            logger.error("resend_onboarding_missing_origin", extra={"user_id": user.id, "error": str(exc)})
            return Response(
                {
                    "detail": "No se pudo construir el enlace de acceso. Revisá FRONTEND_ORIGIN/FRONTEND_ORIGINS.",
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        detail = "Enviamos el link de acceso."
        if otp:
            detail += " Incluimos un código de 6 dígitos (10 minutos)."
        return Response({"detail": detail})
