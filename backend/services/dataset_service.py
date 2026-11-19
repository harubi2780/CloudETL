import hashlib
import logging
import uuid

from django.core.paginator import EmptyPage, Paginator

from dao.dataset_dao import datasets_for_user, insert_dataset, owned_dataset
from datasets.errors import DatasetError
from accounts.models import StorageReservation
from datasets.models import Dataset, dataset_upload_path
from datasets.validators import limits, validate_upload
from services.storage_service import (
    abandon_reservation, cleanup_reservation, ensure_target_idle_locked,
    mark_cleanup_locked, owner_storage_lock, reserve_locked, storage_usage,
)

logger = logging.getLogger(__name__)


def require_dataset(user, dataset_id, *, lock=False):
    try:
        return owned_dataset(user, dataset_id, lock=lock)
    except Dataset.DoesNotExist as error:
        raise DatasetError("Dataset not found.", code="dataset_not_found", status=404) from error


def _abandon(reservation, storage, name):
    try:
        abandon_reservation(reservation, storage, object_key=name)
    except Exception:
        # A durable reservation remains charged if reconciliation itself fails.
        logger.exception("Dataset write cleanup failed; reservation %s requires reconciliation", reservation.pk)


def _cleanup_warning(reservation, storage):
    if not cleanup_reservation(reservation, storage):
        logger.error("Dataset cleanup pending for reservation %s", reservation.pk)
        return "Stored file cleanup is pending. Its space remains counted until cleanup succeeds. Contact support."
    return None


def replace_dataset(user, dataset_id, upload):
    require_dataset(user, dataset_id)
    filename, extension = validate_upload(upload)
    digest = hashlib.sha256()
    for chunk in upload.chunks():
        digest.update(chunk)
    upload.seek(0)
    storage = Dataset._meta.get_field("file").storage
    reservation = None
    new_name = None
    try:
        with owner_storage_lock(user):
            dataset = require_dataset(user, dataset_id, lock=True)
            old_name, old_size = dataset.file.name, dataset.size_bytes
            key = f"datasets/{user.pk}/{dataset_id}/{uuid.uuid4()}.{extension}"
            reservation = reserve_locked(user, target=f"dataset:{dataset_id}", object_key=key,
                                         size_bytes=upload.size, credit_bytes=old_size)
        # A fresh key preserves the old bytes even on overwrite-enabled stores.
        new_name = storage.save(key, upload)
        with owner_storage_lock(user):
            dataset = require_dataset(user, dataset_id, lock=True)
            if dataset.file.name != old_name or dataset.size_bytes != old_size:
                raise DatasetError("The source file changed. Please try again.", code="file_changed", status=409)
            dataset.file.name = new_name
            dataset.filename = filename
            dataset.format = extension
            dataset.size_bytes = upload.size
            dataset.sha256 = digest.hexdigest()
            dataset.save(update_fields=["file", "filename", "format", "size_bytes", "sha256"])
            # Transfer the old object into charged cleanup in the same commit.
            mark_cleanup_locked(reservation, object_key=old_name, size_bytes=old_size)
    except Exception as error:
        if reservation:
            _abandon(reservation, storage, new_name or key)
        if isinstance(error, DatasetError):
            raise
        logger.exception("Dataset replacement failed")
        raise DatasetError("We could not replace the file. Please try again.", code="replace_failed", status=503) from error
    result = {"dataset": public_dataset(dataset)}
    warning = _cleanup_warning(reservation, storage)
    if warning:
        result["warning"] = warning
    return result


def delete_dataset(user, dataset_id):
    try:
        with owner_storage_lock(user):
            dataset = require_dataset(user, dataset_id, lock=True)
            target = f"dataset:{dataset_id}"
            ensure_target_idle_locked(user, target)
            storage, name = dataset.file.storage, dataset.file.name
            reservation = StorageReservation.objects.create(
                owner=user, target=target, object_key=name, size_bytes=dataset.size_bytes,
                reserved_bytes=0, state=StorageReservation.State.CLEANUP,
            )
            dataset.delete()
    except DatasetError:
        raise
    except Exception as error:
        logger.exception("Dataset deletion failed")
        raise DatasetError("We could not delete the dataset. Please try again.", code="delete_failed", status=503) from error
    result = {"deleted": True}
    warning = _cleanup_warning(reservation, storage)
    if warning:
        result["warning"] = warning
    return result


def public_dataset(dataset):
    # Storage references/hashes stay internal; originals are not publicly served.
    return {"id": str(dataset.pk), "filename": dataset.filename, "format": dataset.format,
            "size_bytes": dataset.size_bytes, "uploaded_at": dataset.uploaded_at.isoformat()}


def list_datasets(user, page):
    paginator = Paginator(datasets_for_user(user), 20)
    try:
        result = paginator.page(page)
    except EmptyPage as error:
        raise DatasetError("This dataset page does not exist.", code="invalid_page", status=400) from error
    return {"datasets": [public_dataset(dataset) for dataset in result], "page": result.number,
            "total_pages": paginator.num_pages, "total_count": paginator.count, "limits": limits(),
            "storage": storage_usage(user)}


def upload_dataset(user, upload):
    filename, extension = validate_upload(upload)
    digest = hashlib.sha256()
    for chunk in upload.chunks():
        digest.update(chunk)
    upload.seek(0)
    dataset = Dataset(owner=user, filename=filename, format=extension,
                      size_bytes=upload.size, sha256=digest.hexdigest())
    storage = dataset.file.storage
    key = dataset_upload_path(dataset, filename)
    reservation = None
    try:
        with owner_storage_lock(user):
            reservation = reserve_locked(user, target=f"dataset:{dataset.pk}", object_key=key, size_bytes=upload.size)
        dataset.file.save(filename, upload, save=False)
        with owner_storage_lock(user):
            insert_dataset(dataset)
            StorageReservation.objects.filter(pk=reservation.pk).delete()
    except Exception as error:
        if reservation:
            _abandon(reservation, storage, dataset.file.name or key)
        if isinstance(error, DatasetError):
            raise
        logger.exception("Dataset save failed")
        raise DatasetError("We could not save the file. Please try again.", code="upload_failed", status=503) from error
    return public_dataset(dataset)
