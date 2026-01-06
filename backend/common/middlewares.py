import ipaddress
import json
import logging
import re
import time
import uuid
from typing import Any, Dict, Iterable, List, Optional, Tuple

from django.conf import settings
from django.http import HttpRequest, HttpResponse

from .logging import get_request_id, request_id_ctx_var

access_logger = logging.getLogger("seguros.access")


DEFAULT_REDACTION_KEYWORDS = ("password", "token", "secret", "authorization", "access", "refresh")
DEFAULT_REDACTION_PATTERNS: Tuple[str, ...] = ()
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
MAX_PAYLOAD_BYTES = 4096


def _sensitive_keywords() -> Iterable[str]:
    """Normalize keywords used to redact request payloads."""
    configured = getattr(settings, "REQUEST_LOG_REDACTION_FIELDS", DEFAULT_REDACTION_KEYWORDS)
    return {keyword.strip().lower() for keyword in configured if isinstance(keyword, str) and keyword.strip()}


def _redaction_patterns() -> List[re.Pattern]:
    configured = getattr(settings, "REQUEST_LOG_REDACTION_PATTERNS", DEFAULT_REDACTION_PATTERNS)
    patterns: List[re.Pattern] = []
    for raw in configured:
        if not isinstance(raw, str):
            continue
        try:
            patterns.append(re.compile(raw, re.IGNORECASE))
        except re.error:
            continue
    return patterns


def _should_redact_key(key: str) -> bool:
    if not key:
        return False
    lowered = key.lower()
    if any(keyword in lowered for keyword in _sensitive_keywords()):
        return True
    for pattern in _redaction_patterns():
        if pattern.search(key):
            return True
    return False


def _redact_payload(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if _should_redact_key(key) else _redact_payload(subvalue)
            for key, subvalue in value.items()
        }
    if isinstance(value, list):
        return [_redact_payload(item) for item in value]
    return value


def _parse_json_body(request: HttpRequest) -> Tuple[Optional[Any], bool]:
    if not getattr(settings, "DEBUG", False):
        return None, False
    if request.method.upper() not in {"POST", "PUT", "PATCH", "DELETE"}:
        return None, False
    try:
        body_bytes = request.body
    except Exception:
        return None, False
    if not body_bytes:
        return None, False

    content_type = request.META.get("CONTENT_TYPE", "")
    if "application/json" not in content_type.lower():
        return None, False

    encoding = request.encoding or "utf-8"
    truncated = len(body_bytes) > MAX_PAYLOAD_BYTES
    limited_bytes = body_bytes[:MAX_PAYLOAD_BYTES] if truncated else body_bytes
    try:
        payload = json.loads(limited_bytes.decode(encoding))
    except (ValueError, UnicodeDecodeError):
        return None, False
    return _redact_payload(payload), truncated


def _client_ip(request: HttpRequest) -> Optional[str]:
    remote_addr = request.META.get("REMOTE_ADDR")
    use_xff = _is_trusted_proxy(remote_addr)
    if use_xff:
        header = request.META.get("HTTP_X_FORWARDED_FOR")
        if header:
            ip_list = [ip.strip() for ip in header.split(",") if ip.strip()]
            if ip_list:
                return ip_list[0]
    header = request.META.get("HTTP_X_REAL_IP")
    if header:
        return header.strip()
    return remote_addr


def _trusted_ips() -> Iterable[str]:
    configured = getattr(settings, "TRUSTED_PROXY_IPS", ())
    return [str(item).strip() for item in configured if str(item).strip()]


def _trusted_networks() -> Iterable[str]:
    configured = getattr(settings, "TRUSTED_PROXY_NETWORKS", ())
    return [str(item).strip() for item in configured if str(item).strip()]


def _is_trusted_proxy(remote_addr: Optional[str]) -> bool:
    if not remote_addr:
        return False
    try:
        remote_ip = ipaddress.ip_address(remote_addr)
    except ValueError:
        return False
    for ip in _trusted_ips():
        try:
            if remote_ip == ipaddress.ip_address(ip):
                return True
        except ValueError:
            continue
    for network in _trusted_networks():
        try:
            if remote_ip in ipaddress.ip_network(network, strict=False):
                return True
        except ValueError:
            continue
    return False


def _user_id(request: HttpRequest) -> Optional[int]:
    user = getattr(request, "user", None)
    if not user:
        return None
    if hasattr(user, "is_authenticated") and not user.is_authenticated:
        return None
    return getattr(user, "pk", None)


class RequestIDMiddleware:
    """Ensure every request/response carries a request_id and expose it via contextvars."""

    header_name = "HTTP_X_REQUEST_ID"

    def __init__(self, get_response):
        self.get_response = get_response

    @staticmethod
    def _is_valid_request_id(value: Optional[str]) -> bool:
        if not value or not isinstance(value, str):
            return False
        return bool(REQUEST_ID_PATTERN.fullmatch(value))

    def __call__(self, request: HttpRequest) -> HttpResponse:
        header_value = request.META.get(self.header_name)
        request_id = header_value if self._is_valid_request_id(header_value) else str(uuid.uuid4())
        request.request_id = request_id
        token = request_id_ctx_var.set(request_id)
        response = None
        try:
            response = self.get_response(request)
            return response
        finally:
            if response is not None:
                response["X-Request-ID"] = request_id
            request_id_ctx_var.reset(token)


class AccessLogMiddleware:
    """Log a single JSON-formatted line per request with correlation metadata."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        start = time.monotonic()
        response = None
        try:
            response = self.get_response(request)
            return response
        finally:
            duration_ms = round((time.monotonic() - start) * 1000, 2)
            status_code = getattr(response, "status_code", 500)
            self._log_request(request, status_code, duration_ms)

    def _log_request(self, request: HttpRequest, status_code: int, duration_ms: float) -> None:
        resolver_match = getattr(request, "resolver_match", None)
        route_value = None
        if resolver_match:
            route_value = getattr(resolver_match, "route", None) or getattr(resolver_match, "view_name", None)
        view_name = getattr(resolver_match, "view_name", None) if resolver_match else None
        payload, truncated = _parse_json_body(request)
        log_fields: Dict[str, Any] = {
            "request_id": get_request_id() or getattr(request, "request_id", None),
            "method": request.method,
            "path": request.get_full_path(),
            "status_code": status_code,
            "duration_ms": duration_ms,
            "user_id": _user_id(request),
            "client_ip": _client_ip(request),
            "user_agent": request.META.get("HTTP_USER_AGENT", ""),
            "route": route_value,
            "view": view_name,
        }
        if payload is not None:
            log_fields["payload"] = payload
            if truncated:
                log_fields["payload_truncated"] = True
        access_logger.info("http.request", extra=log_fields)
