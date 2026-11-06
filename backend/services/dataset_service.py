import hashlib
import logging
import uuid

from django.core.paginator import EmptyPage, Paginator
from django.db import transaction

from dao.dataset_dao import datasets_for_user, insert_dataset, owned_dataset
from datasets.errors import DatasetError
from datasets.models import Dataset
from datasets.validators import limits, validate_upload

logger = logging.getLogger(__name__)


def require_dataset(user, dataset_id, *, lock=False):
    try:
        return owned_dataset(user, dataset_id, lock=lock)
    except Dataset.DoesNotExist as error:
        raise DatasetError("Dataset not found.", code="dataset_not_found", status=404) from error


def cleanup_object(storage, name):
    try:
        storage.delete(name)
    except Exception:
        logger.exception("Failed to remove dataset object %s; storage reconciliation required", name)
        return "The dataset was updated, but stored file cleanup failed. Contact support to complete cleanup."
    return None


def replace_dataset(user, dataset_id, upload):
    require_dataset(user, dataset_id)
    filename, extension = validate_upload(upload)
    digest = hashlib.sha256()
    for chunk in upload.chunks():
        digest.update(chunk)
    upload.seek(0)
    storage = Dataset._meta.get_field("file").storage
    new_name = None
    try:
        # A fresh key preserves the old bytes even on overwrite-enabled stores.
        new_name = storage.save(f"datasets/{user.pk}/{dataset_id}/{uuid.uuid4()}.{extension}", upload)
        with transaction.atomic(durable=True):
            dataset = require_dataset(user, dataset_id, lock=True)
            old_name = dataset.file.name
            dataset.file.name = new_name
            dataset.filename = filename
            dataset.format = extension
            dataset.size_bytes = upload.size
            dataset.sha256 = digest.hexdigest()
            dataset.save(update_fields=["file", "filename", "format", "size_bytes", "sha256"])
    except Exception as error:
        if new_name:
            cleanup_object(storage, new_name)
        if isinstance(error, DatasetError):
            raise
        logger.exception("Dataset replacement failed")
        raise DatasetError("We could not replace the file. Please try again.", code="replace_failed", status=503) from error
    result = {"dataset": public_dataset(dataset)}
    warning = cleanup_object(storage, old_name)
    if warning:
        result["warning"] = warning
    return result


def delete_dataset(user, dataset_id):
    try:
        with transaction.atomic(durable=True):
            dataset = require_dataset(user, dataset_id, lock=True)
            storage, name = dataset.file.storage, dataset.file.name
            dataset.delete()
    except DatasetError:
        raise
    except Exception as error:
        logger.exception("Dataset deletion failed")
        raise DatasetError("We could not delete the dataset. Please try again.", code="delete_failed", status=503) from error
    result = {"deleted": True}
    warning = cleanup_object(storage, name)
    if warning:
        result["warning"] = "The dataset was removed from your list, but stored file cleanup failed. Contact support to complete cleanup."
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
            "total_pages": paginator.num_pages, "total_count": paginator.count, "limits": limits()}


def upload_dataset(user, upload):
    filename, extension = validate_upload(upload)
    digest = hashlib.sha256()
    for chunk in upload.chunks():
        digest.update(chunk)
    upload.seek(0)
    dataset = Dataset(owner=user, filename=filename, format=extension,
                      size_bytes=upload.size, sha256=digest.hexdigest())
    stored = False
    try:
        dataset.file.save(filename, upload, save=False)
        stored = True
        with transaction.atomic():
            insert_dataset(dataset)
    except Exception as error:
        if stored:
            try:
                dataset.file.delete(save=False)
            except Exception:
                logger.exception("Failed to clean up new upload after dataset insert failure")
        logger.exception("Dataset save failed")
        raise DatasetError("We could not save the file. Please try again.", code="upload_failed", status=503) from error
    return public_dataset(dataset)
