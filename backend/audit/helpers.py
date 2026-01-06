from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Iterable, Optional, Sequence, Tuple, Union

from django.conf import settings
from django.db.models import Model
from django.db.models.fields.files import FieldFile
from django.http import HttpRequest

from common.logging import get_request_id

from .models import AuditLog

DEFAULT_SENSITIVE_KEYWORDS = (
    "password",
    "token",
    "secret",
    "secret_key",
    "jwt",
    "otp",
    "ssn",
    "credit",
    "card",
    "passport",
)


def _sensitive_keywords() -> Sequence[str]:
    configured = getattr(settings, "AUDIT_LOG_SENSITIVE_KEYWORDS", DEFAULT_SENSITIVE_KEYWORDS)
    return [keyword.lower() for keyword in configured if isinstance(keyword, str) and keyword]


def _should_redact_key(key: str) -> bool:
    if not key:
        return False
    lowered = key.lower()
    return any(keyword in lowered for keyword in _sensitive_keywords())


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized = {}
        for key, subvalue in value.items():
            if _should_redact_key(str(key)):
                continue
            sanitized[key] = _sanitize_value(subvalue)
        return sanitized
    if isinstance(value, (list, tuple)):
        return [_sanitize_value(item) for item in value]
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Model):
        return _snapshot_entity(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, FieldFile):
        return value.name
    if isinstance(value, (int, float, bool, str)):
        return value
    return str(value)


def _snapshot_entity(instance: Model) -> Dict[str, Any]:
    data = {}
    for field in instance._meta.concrete_fields:
        key = field.name
        if _should_redact_key(key):
            continue
        attr_name = getattr(field, "attname", field.name)
        try:
            value = getattr(instance, attr_name)
        except AttributeError:
            continue
        data[key] = _sanitize_value(value)
    return data


def snapshot_entity(instance: Optional[Model]) -> Optional[Dict[str, Any]]:
    if not instance:
        return None
    return _snapshot_entity(instance)


def _normalize_payload(value: Any) -> Optional[Union[Dict[str, Any], Sequence[Any], str]]:
    if value is None:
        return None
    if isinstance(value, dict):
        return {k: _sanitize_value(v) for k, v in value.items() if not _should_redact_key(str(k))}
    if isinstance(value, (list, tuple)):
        return [_sanitize_value(item) for item in value]
    return _sanitize_value(value)


def _client_ip_from_request(request: HttpRequest) -> Optional[str]:
    header = request.META.get("HTTP_X_FORWARDED_FOR")
    if header:
        ip_list = [ip.strip() for ip in header.split(",") if ip.strip()]
        if ip_list:
            return ip_list[0]
    header = request.META.get("HTTP_X_REAL_IP")
    if header:
        return header.strip()
    return request.META.get("REMOTE_ADDR")


def _extract_actor_info(actor: Any) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    if actor is None:
        return None, None, None
    actor_type = getattr(actor, "_meta", None)
    if actor_type:
        actor_type = actor_type.label
        actor_id = getattr(actor, "pk", None)
    else:
        actor_type = actor.__class__.__name__
        actor_id = getattr(actor, "id", None) if hasattr(actor, "id") else None
    actor_repr = str(actor)
    return actor_type, str(actor_id) if actor_id is not None else None, actor_repr


def audit_log(
    action: str,
    entity_type: str,
    *,
    entity_id: Optional[str] = None,
    before: Optional[Any] = None,
    after: Optional[Any] = None,
    actor: Any = None,
    request: Optional[HttpRequest] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    actor_type, actor_id, actor_repr = _extract_actor_info(actor or (request.user if request else None))
    request_id = get_request_id()
    if request:
        request_id = request_id or request.headers.get("X-Request-ID")
    before_data = _normalize_payload(before) if not isinstance(before, Model) else snapshot_entity(before)
    after_data = _normalize_payload(after) if not isinstance(after, Model) else snapshot_entity(after)
    client_ip = _client_ip_from_request(request) if request else None
    user_agent = request.headers.get("User-Agent") if request else None
    AuditLog.objects.create(
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        actor_type=actor_type,
        actor_id=actor_id,
        actor_repr=actor_repr,
        before=before_data,
        after=after_data,
        request_id=request_id,
        client_ip=client_ip,
        user_agent=user_agent,
        extra=_normalize_payload(extra) if extra else None,
    )


class AuditModelViewSetMixin:
    def _entity_type(self) -> str:
        queryset = self.get_queryset()
        model = getattr(queryset, "model", None)
        if model is None and hasattr(self, "serializer_class"):
            model = getattr(self.serializer_class.Meta, "model", None)
        return model.__name__ if model else "Entity"

    def _entity_id(self, instance: Model) -> Optional[str]:
        return str(getattr(instance, "pk", None)) if instance else None

    def _audit_action(self, verb: str, instance: Model, *, before: Optional[Any] = None, after: Optional[Any] = None) -> None:
        audit_log(
            action=f"{self._entity_type().lower()}_{verb}",
            entity_type=self._entity_type(),
            entity_id=self._entity_id(instance),
            before=before,
            after=after,
            actor=self.request.user if hasattr(self, "request") else None,
            request=self.request if hasattr(self, "request") else None,
        )

    def perform_create(self, serializer):
        result = super().perform_create(serializer)
        self._audit_action("created", serializer.instance, after=snapshot_entity(serializer.instance))
        return result

    def perform_update(self, serializer):
        before = snapshot_entity(serializer.instance)
        result = super().perform_update(serializer)
        after = snapshot_entity(serializer.instance)
        self._audit_action("updated", serializer.instance, before=before, after=after)
        return result

    def perform_destroy(self, instance):
        before = snapshot_entity(instance)
        result = super().perform_destroy(instance)
        self._audit_action("deleted", instance, before=before, after=None)
        return result
