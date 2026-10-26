import uuid

from django.conf import settings
from django.db import models


def dataset_upload_path(instance, filename):
    # Never use a client-supplied filename as a storage path.
    return f"datasets/{instance.owner_id}/{instance.pk}.{instance.format}"


class Dataset(models.Model):
    class Format(models.TextChoices):
        CSV = "csv", "CSV"
        TSV = "tsv", "TSV"
        JSON = "json", "JSON"
        XLSX = "xlsx", "XLSX"
        PARQUET = "parquet", "Parquet"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="datasets")
    filename = models.CharField(max_length=255)
    format = models.CharField(max_length=7, choices=Format.choices)
    file = models.FileField(upload_to=dataset_upload_path, max_length=255)
    size_bytes = models.PositiveBigIntegerField()
    sha256 = models.CharField(max_length=64)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at", "-id"]
        indexes = [models.Index(fields=["owner", "-uploaded_at", "-id"], name="dataset_owner_recent_idx")]
        constraints = [
            models.CheckConstraint(condition=models.Q(size_bytes__gt=0), name="dataset_size_positive"),
            models.CheckConstraint(condition=models.Q(format__in=["csv", "tsv", "json", "xlsx", "parquet"]), name="dataset_format_supported"),
        ]
