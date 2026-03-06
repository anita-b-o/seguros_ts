from prometheus_client import Counter, Histogram

webhooks_received_total = Counter(
    "webhooks_received_total",
    "Total number of requests that reached the Mercado Pago webhook endpoint.",
)
webhooks_processed_total = Counter(
    "webhooks_processed_total",
    "Number of webhook requests that entered business processing.",
)
webhooks_invalid_signature_total = Counter(
    "webhooks_invalid_signature_total",
    "Webhook calls rejected because the signature/auth header was invalid.",
)
webhooks_duplicate_total = Counter(
    "webhooks_duplicate_total",
    "Duplicate webhook events by external_event_id prevented from reprocessing.",
)
payments_created_total = Counter(
    "payments_created_total",
    "Number of payment records created when starting an online preference.",
)
payments_confirmed_total = Counter(
    "payments_confirmed_total",
    "Payments that reached confirmed/approved status via a webhook.",
)
payments_failed_total = Counter(
    "payments_failed_total",
    "Payments that failed (rejected) after being notified by the webhook.",
)

http_requests_app_total = Counter(
    "http_requests_app_total",
    "HTTP requests observed by application access middleware.",
    ["method", "route", "status_class"],
)

http_request_app_duration_seconds = Histogram(
    "http_request_app_duration_seconds",
    "Application-level HTTP request duration in seconds.",
    ["method", "route"],
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10),
)

http_5xx_app_total = Counter(
    "http_5xx_app_total",
    "Total number of HTTP responses with 5xx status.",
    ["method", "route", "status_code"],
)


def observe_http_request(method: str, route: str, status_code: int, duration_ms: float) -> None:
    method_label = (method or "UNKNOWN").upper()
    route_label = route or "unresolved"
    status_class = f"{int(status_code) // 100}xx"
    http_requests_app_total.labels(
        method=method_label, route=route_label, status_class=status_class
    ).inc()
    http_request_app_duration_seconds.labels(
        method=method_label, route=route_label
    ).observe(max(duration_ms, 0) / 1000.0)
    if int(status_code) >= 500:
        http_5xx_app_total.labels(
            method=method_label, route=route_label, status_code=str(status_code)
        ).inc()
