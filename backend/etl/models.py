import uuid

from django.conf import settings
from django.db import models


def result_upload_path(instance, filename):
    return f"etl/{instance.owner_id}/{instance.pk}/result.parquet"


class ETLRun(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="etl_runs")
    name = models.CharField(max_length=120)
    configuration = models.JSONField()
    sources = models.JSONField()
    status = models.CharField(max_length=9, choices=Status.choices, default=Status.QUEUED)
    claim_token = models.UUIDField(null=True, editable=False)
    result = models.FileField(upload_to=result_upload_path, max_length=255, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    sha256 = models.CharField(max_length=64, blank=True)
    summary = models.JSONField(default=dict)
    error_code = models.CharField(max_length=64, blank=True)
    error_message = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["owner", "-created_at"], name="etl_owner_recent_idx"),
            models.Index(fields=["status", "created_at"], name="etl_queue_idx"),
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(status__in=["queued", "running", "succeeded", "failed"]), name="etl_status_valid"),
        ]
