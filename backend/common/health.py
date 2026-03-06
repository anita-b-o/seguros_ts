import time
from typing import Dict, Tuple

from django.conf import settings
from django.core.cache import caches
from django.db import connections
from django.utils import timezone


def _check_database() -> Dict[str, object]:
    started = time.monotonic()
    connection = connections["default"]
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        cursor.fetchone()
    duration_ms = round((time.monotonic() - started) * 1000, 2)
    return {"status": "ok", "latency_ms": duration_ms}


def _check_cache() -> Dict[str, object]:
    backend_name = str(settings.CACHES.get("default", {}).get("BACKEND", "")).lower()
    if "redis" not in backend_name:
        return {"status": "skipped", "detail": "cache backend is not redis"}

    started = time.monotonic()
    key = "_healthcheck_ready"
    cache = caches["default"]
    cache.set(key, "ok", timeout=5)
    value = cache.get(key)
    if value != "ok":
        raise RuntimeError("redis roundtrip failed")
    duration_ms = round((time.monotonic() - started) * 1000, 2)
    return {"status": "ok", "latency_ms": duration_ms}


def build_readiness_payload(include_details: bool = True) -> Tuple[Dict[str, object], bool]:
    checks: Dict[str, Dict[str, object]] = {}
    failures = False

    try:
        checks["database"] = _check_database()
    except Exception as exc:  # pragma: no cover - defensive fallback
        checks["database"] = {"status": "error", "detail": str(exc)}
        failures = True

    try:
        checks["cache"] = _check_cache()
    except Exception as exc:  # pragma: no cover - defensive fallback
        checks["cache"] = {"status": "error", "detail": str(exc)}
        failures = True

    payload: Dict[str, object] = {
        "service": "securests-api",
        "timestamp": timezone.now().isoformat(),
        "status": "ok" if not failures else "degraded",
    }
    if include_details:
        payload["checks"] = checks
    return payload, failures


def build_liveness_payload() -> Dict[str, object]:
    return {
        "service": "securests-api",
        "timestamp": timezone.now().isoformat(),
        "status": "ok",
    }
