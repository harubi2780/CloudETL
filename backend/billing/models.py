import uuid

from django.conf import settings
from django.db import models


class Subscription(models.Model):
    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="subscription")
    provider = models.CharField(max_length=20, default="demo")
    current_period_end = models.DateTimeField()
    updated_at = models.DateTimeField(auto_now=True)


class PaymentOrder(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"
        EXPIRED = "expired", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="payment_orders")
    provider = models.CharField(max_length=20, default="demo")
    plan_code = models.CharField(max_length=20, default="premium")
    plan_name = models.CharField(max_length=80, default="Premium")
    amount_vnd = models.PositiveIntegerField()
    currency = models.CharField(max_length=3, default="VND")
    period_days = models.PositiveIntegerField(default=30)
    storage_limit_bytes = models.PositiveBigIntegerField(default=2 * 1024**3)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["owner", "-created_at"], name="billing_owner_recent_idx")]
        constraints = [
            models.CheckConstraint(condition=models.Q(status__in=["pending", "succeeded", "failed", "cancelled", "expired"]), name="billing_order_status_valid"),
            models.CheckConstraint(condition=models.Q(amount_vnd__gt=0, period_days__gt=0, storage_limit_bytes__gt=0), name="billing_order_values_positive"),
            models.UniqueConstraint(fields=["owner"], condition=models.Q(status="pending", provider="demo"), name="billing_one_pending_demo_order"),
        ]
