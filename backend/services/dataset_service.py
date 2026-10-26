import hashlib
import logging

from django.core.paginator import EmptyPage, Paginator
from django.db import transaction

from dao.dataset_dao import datasets_for_user, insert_dataset
from datasets.errors import DatasetError
from datasets.models import Dataset
from datasets.validators import limits, validate_upload

logger = logging.getLogger(__name__)


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
