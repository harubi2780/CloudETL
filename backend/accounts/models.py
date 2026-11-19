"""Storage entitlements are independent of any future billing provider."""
import uuid

from django.conf import settings
from django.db import models


class AccountEntitlement(models.Model):
    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="entitlement")
    plan_code = models.SlugField(max_length=64, default="free")
    plan_name = models.CharField(max_length=80, default="Free")
    # NULL follows the configured default. A verified billing integration can
    # later set an explicit allowance without changing storage enforcement.
    storage_limit_bytes = models.PositiveBigIntegerField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.CheckConstraint(
            condition=models.Q(storage_limit_bytes__isnull=True) | models.Q(storage_limit_bytes__gt=0),
            name="account_storage_limit_positive",
        )]


class StorageReservation(models.Model):
    class State(models.TextChoices):
        WRITING = "writing", "Writing"
        CLEANUP = "cleanup", "Pending cleanup"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="storage_reservations")
    target = models.CharField(max_length=100)
    object_key = models.CharField(max_length=255)
    size_bytes = models.PositiveBigIntegerField()
    # Replacement staging only reserves positive growth over the current file.
    reserved_bytes = models.PositiveBigIntegerField()
    state = models.CharField(max_length=10, choices=State.choices, default=State.WRITING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["owner", "state"], name="storage_owner_state_idx")]
        constraints = [
            models.UniqueConstraint(fields=["owner", "target"], condition=models.Q(state="writing"),
                                    name="storage_one_writer_per_target"),
            models.CheckConstraint(condition=models.Q(state__in=["writing", "cleanup"]), name="storage_state_valid"),
            models.CheckConstraint(condition=models.Q(reserved_bytes__lte=models.F("size_bytes")),
                                   name="storage_reservation_within_size"),
        ]
