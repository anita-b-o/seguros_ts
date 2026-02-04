from django.contrib import admin
from .models import BillingNotification, BillingPeriod, Payment, Receipt

admin.site.register(BillingPeriod)
admin.site.register(BillingNotification)
admin.site.register(Payment)
admin.site.register(Receipt)
