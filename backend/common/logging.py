import contextvars
import logging
from typing import Optional

request_id_ctx_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "request_id", default=None
)


def get_request_id() -> Optional[str]:
    """Return the current request_id captured in contextvars."""
    return request_id_ctx_var.get()


class RequestIDFilter(logging.Filter):
    """Attach the request_id from the contextvar to every log record."""

    def filter(self, record: logging.LogRecord) -> bool:  # pragma: no cover - trivial
        record.request_id = get_request_id()
        return True
