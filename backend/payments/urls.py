from rest_framework.routers import DefaultRouter
from django.urls import path
from django.conf import settings

from .views import PaymentViewSet, mp_webhook, manual_payment
# Si en el futuro agregás debug views, importalas explícitamente aquí.

router = DefaultRouter(trailing_slash=False)
router.register(r'', PaymentViewSet, basename='payments')

urlpatterns = router.urls + [
    path('webhook', mp_webhook, name='mp_webhook'),
    path('webhook/', mp_webhook, name='mp_webhook_legacy'),
    path('manual/<int:policy_id>', manual_payment, name='manual_payment'),
    path('manual/<int:policy_id>/', manual_payment, name='manual_payment_legacy'),
]

# Debug endpoints: SOLO en DEBUG=True
if settings.DEBUG:
    urlpatterns += [
        # Ejemplo futuro:
        # path("debug/...", debug_view, name="payments_debug_..."),
    ]
