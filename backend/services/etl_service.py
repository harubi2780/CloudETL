"""Ownership, queue lifecycle, storage and execution orchestration."""
import hashlib
import logging
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.paginator import EmptyPage, Paginator
from django.db import transaction
from django.utils import timezone

from accounts.models import StorageReservation
from datasets.errors import DatasetError
from etl import adapter
from etl.errors import ETLError
from etl.models import ETLRun
from etl.serializers import MAX_MEMORY_BYTES, MAX_RESULT_BYTES, PipelineSerializer, source_ids
from services.dataset_service import public_dataset, require_dataset
from services.storage_service import (
    abandon_reservation, cleanup_reservation, ensure_target_idle_locked,
    owner_storage_lock, reserve_locked,
)

logger = logging.getLogger(__name__)


def source_metadata(user, dataset_id):
    return public_dataset(require_dataset(user, dataset_id))


def list_runs(user, page, status=""):
    if status and status not in ETLRun.Status.values:
        raise ETLError("Choose a supported run status.")
    queryset = ETLRun.objects.filter(owner=user)
    if status:
        queryset = queryset.filter(status=status)
    paginator = Paginator(queryset, 20)
    try:
        result = paginator.page(page)
    except EmptyPage as error:
        raise ETLError("This run page does not exist.", code="invalid_page") from error
    runs = []
    for run in result:
        data = public_run(run)
        if data["summary"]:
            data["summary"] = {"final_rows": run.summary["final_rows"], "column_count": len(run.summary["columns"])}
        runs.append(data)
    return {"runs": runs, "page": result.number, "total_pages": paginator.num_pages, "total_count": paginator.count}


def owned_run(user, run_id):
    try:
        return ETLRun.objects.get(owner=user, pk=run_id)
    except ETLRun.DoesNotExist as error:
        raise ETLError("ETL run not found.", code="run_not_found", status=404) from error


def public_run(run):
    return {
        "id": str(run.pk), "name": run.name, "status": run.status,
        "created_at": run.created_at.isoformat(),
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "summary": run.summary if run.status == ETLRun.Status.SUCCEEDED else None,
        "error": {"code": run.error_code, "message": run.error_message} if run.status == ETLRun.Status.FAILED else None,
        "result_available": run.status == ETLRun.Status.SUCCEEDED and bool(run.result),
        "download_url": f"/api/etl/runs/{run.pk}/download/" if run.status == ETLRun.Status.SUCCEEDED and run.result else None,
    }


def submit_run(user, payload):
    serializer = PipelineSerializer(payload)
    serializer.is_valid(raise_exception=True)
    config = serializer.validated_data
    snapshots = {}
    total_size = 0
    for dataset_id in source_ids(config):
        dataset = require_dataset(user, dataset_id)
        if dataset.format not in ("csv", "tsv"):
            raise ETLError("This ETL tool supports CSV and TSV inputs only.", code="unsupported_input")
        total_size += dataset.size_bytes
        snapshots[dataset_id] = {"sha256": dataset.sha256, "key": dataset.file.name,
                                 "format": dataset.format, "size_bytes": dataset.size_bytes}
    if total_size > settings.DATASET_MAX_FILE_SIZE_BYTES:
        raise ETLError("Combined ETL input size exceeds the upload size limit.", code="resource_limit")
    # Serialize queue admission per owner so concurrent requests cannot exceed the cap.
    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=user.pk)
        pending = ETLRun.objects.filter(owner=user, status__in=[ETLRun.Status.QUEUED, ETLRun.Status.RUNNING]).count()
        if pending >= 10:
            raise ETLError("You already have 10 pending ETL runs.", code="queue_limit", status=429)
        run = ETLRun.objects.create(owner=user, name=config["name"], configuration=config, sources=snapshots)
    return public_run(run)


def dataset_preview(user, dataset_id):
    dataset = require_dataset(user, dataset_id)
    try:
        return adapter.preview(adapter.extract_dataset(dataset))
    except ETLError:
        raise
    except Exception as error:
        logger.exception("Dataset ETL preview failed")
        raise ETLError("We could not preview this dataset.", code="preview_failed", status=503) from error


def claim_next_run():
    with transaction.atomic():
        run = ETLRun.objects.select_for_update(skip_locked=True).filter(status=ETLRun.Status.QUEUED).order_by("created_at", "id").first()
        if run is None:
            return None
        run.status = ETLRun.Status.RUNNING
        run.started_at = timezone.now()
        run.claim_token = uuid.uuid4()
        run.save(update_fields=["status", "started_at", "claim_token"])
        return run


def fail_run(run_id, claim_token, code, message):
    return ETLRun.objects.filter(pk=run_id, status=ETLRun.Status.RUNNING, claim_token=claim_token).update(
        status=ETLRun.Status.FAILED, error_code=code, error_message=message[:255], finished_at=timezone.now())


def expire_stale_runs():
    # A crashed worker has no lease heartbeat. Fence old jobs before releasing capacity.
    return ETLRun.objects.filter(status=ETLRun.Status.RUNNING,
                                 started_at__lt=timezone.now() - timedelta(seconds=settings.ETL_RUN_TIMEOUT_SECONDS + 60)).update(
        status=ETLRun.Status.FAILED, error_code="worker_interrupted",
        error_message="The ETL worker was interrupted. Submit a new run.", finished_at=timezone.now())


def execute_run(run_id, claim_token):
    """Execute a claimed run; token-guarded publication prevents stale success."""
    run = ETLRun.objects.select_related("owner").get(pk=run_id)
    if run.status != ETLRun.Status.RUNNING or str(run.claim_token) != str(claim_token):
        return
    storage = ETLRun._meta.get_field("result").storage
    stored_name = None
    reservation = None
    try:
        # Validate persisted data too, including commands executed outside the API.
        serializer = PipelineSerializer(run.configuration)
        serializer.is_valid(raise_exception=True)
        config = serializer.validated_data
        frames = {}
        for dataset_id in source_ids(config):
            dataset = require_dataset(run.owner, dataset_id)
            snapshot = run.sources.get(dataset_id)
            if not snapshot:
                raise ETLError("The run has no input snapshot.", code="input_changed")
            frames[dataset_id] = adapter.extract_dataset(dataset, snapshot)
            if sum(frame.memory_usage(index=True, deep=True).sum() for frame in frames.values()) > MAX_MEMORY_BYTES:
                raise ETLError("Combined inputs exceed the ETL memory limit.", code="resource_limit")
        frame, initial_rows = adapter.execute_pipeline(config, frames)
        content = adapter.serialize_result(frame, "parquet")
        report = adapter.preview(frame, initial_rows)
        # Use an attempt-specific key so even stale executions never overwrite a result.
        key = f"etl/{run.owner_id}/{run.pk}/{run.claim_token}.parquet"
        with owner_storage_lock(run.owner):
            current = ETLRun.objects.select_for_update().get(pk=run.pk)
            if current.status != ETLRun.Status.RUNNING or str(current.claim_token) != str(claim_token):
                return
            reservation = reserve_locked(run.owner, target=f"run:{run.pk}", object_key=key, size_bytes=len(content))
        stored_name = storage.save(key, ContentFile(content))
        with owner_storage_lock(run.owner):
            published = ETLRun.objects.filter(pk=run.pk, status=ETLRun.Status.RUNNING, claim_token=claim_token).update(
                status=ETLRun.Status.SUCCEEDED, result=stored_name, size_bytes=len(content),
                sha256=hashlib.sha256(content).hexdigest(), summary=report, finished_at=timezone.now())
            if published:
                StorageReservation.objects.filter(pk=reservation.pk).delete()
        if published:
            reservation = None
    except (ETLError, DatasetError) as error:
        fail_run(run.pk, claim_token, error.code, error.message)
    except Exception:
        # Never return storage credentials, local paths or raw parser errors.
        logger.exception("ETL execution failed for run %s", run.pk)
        fail_run(run.pk, claim_token, "execution_failed", "ETL execution failed. Check the input data or contact support.")
    finally:
        if reservation:
            try:
                abandon_reservation(reservation, storage, object_key=stored_name or key)
            except Exception:
                logger.exception("ETL result reservation %s requires reconciliation", reservation.pk)


def delete_result(user, run_id):
    with owner_storage_lock(user):
        try:
            run = ETLRun.objects.select_for_update().get(owner=user, pk=run_id)
        except ETLRun.DoesNotExist as error:
            raise ETLError("ETL run not found.", code="run_not_found", status=404) from error
        if run.status != ETLRun.Status.SUCCEEDED:
            raise ETLError("This run has no completed result.", code="result_not_ready", status=409)
        if not run.result:
            return {"deleted": True}
        target = f"run:{run.pk}"
        ensure_target_idle_locked(user, target)
        storage = run.result.storage
        reservation = StorageReservation.objects.create(
            owner=user, target=target, object_key=run.result.name, size_bytes=run.size_bytes,
            reserved_bytes=0, state=StorageReservation.State.CLEANUP,
        )
        run.result = ""
        run.size_bytes = 0
        run.sha256 = ""
        run.save(update_fields=["result", "size_bytes", "sha256"])
    result = {"deleted": True}
    if not cleanup_reservation(reservation, storage):
        result["warning"] = "Stored result cleanup is pending. Its space remains counted until cleanup succeeds. Contact support."
    return result


def result_content(run):
    if run.status != ETLRun.Status.SUCCEEDED:
        raise ETLError("This run has no completed result.", code="result_not_ready", status=409)
    if not run.result:
        raise ETLError("This result file has been deleted. The run history is still available.", code="result_deleted", status=404)
    try:
        with run.result.open("rb") as source:
            content = source.read(MAX_RESULT_BYTES + 1)
        if len(content) > MAX_RESULT_BYTES:
            raise ETLError("The result exceeds the file size limit.", code="resource_limit")
        if len(content) != run.size_bytes or hashlib.sha256(content).hexdigest() != run.sha256:
            raise ETLError("The stored result failed its integrity check.", code="result_corrupt", status=503)
        return content
    except ETLError:
        raise
    except Exception as error:
        logger.exception("ETL result download failed for run %s", run.pk)
        raise ETLError("We could not export this result.", code="export_failed", status=503) from error


def download_result(user, run_id, file_format):
    content = result_content(owned_run(user, run_id))
    if file_format == "parquet":
        return content
    try:
        return adapter.serialize_result(adapter.read_result(content), file_format)
    except ETLError:
        raise
    except Exception as error:
        logger.exception("ETL export conversion failed")
        raise ETLError("We could not export this result.", code="export_failed", status=503) from error


def result_rows(user, run_id, page, page_size):
    content = result_content(owned_run(user, run_id))
    try:
        return adapter.paginate_result(content, page, page_size)
    except ETLError:
        raise
    except Exception as error:
        logger.exception("ETL result pagination failed")
        raise ETLError("We could not read these result rows.", code="result_unavailable", status=503) from error
