from django.db import models


class AuditLog(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    actor_type = models.CharField(max_length=255, blank=True, null=True)
    actor_id = models.CharField(max_length=64, blank=True, null=True)
    actor_repr = models.CharField(max_length=255, blank=True, null=True)
    action = models.CharField(max_length=128)
    entity_type = models.CharField(max_length=255)
    entity_id = models.CharField(max_length=128, blank=True, null=True)
    before = models.JSONField(blank=True, null=True)
    after = models.JSONField(blank=True, null=True)
    request_id = models.CharField(max_length=64, blank=True, null=True)
    client_ip = models.CharField(max_length=64, blank=True, null=True)
    user_agent = models.CharField(max_length=512, blank=True, null=True)
    extra = models.JSONField(blank=True, null=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.action} {self.entity_type}#{self.entity_id or 'unknown'}"
