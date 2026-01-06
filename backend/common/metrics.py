from prometheus_client import Counter

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
