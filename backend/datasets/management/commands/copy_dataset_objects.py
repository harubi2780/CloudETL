"""Copy verified legacy uploads into the configured private object store."""

import hashlib
from pathlib import Path

from django.core.files import File
from django.core.files.storage import storages
from django.core.management.base import BaseCommand, CommandError

from datasets.models import Dataset, dataset_upload_path


def verify_content(source, dataset):
    """Bound reads by the recorded size; never accept changed source bytes."""
    digest = hashlib.sha256()
    size = 0
    while chunk := source.read(min(1024 * 1024, dataset.size_bytes - size + 1)):
        size += len(chunk)
        if size > dataset.size_bytes:
            raise CommandError(f"Dataset {dataset.pk}: file size does not match metadata.")
        digest.update(chunk)
    if size != dataset.size_bytes or digest.hexdigest() != dataset.sha256:
        raise CommandError(f"Dataset {dataset.pk}: file size or checksum does not match metadata.")


class Command(BaseCommand):
    help = "Copy legacy dataset files into S3 without changing metadata or deleting sources. Defaults to dry-run."

    def add_arguments(self, parser):
        parser.add_argument("--source-root", required=True, help="Root of the existing filesystem uploads.")
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument("--apply", action="store_true", help="Copy missing objects and verify their contents.")
        mode.add_argument("--dry-run", action="store_true", help="Check sources and targets without writing (default).")

    def get_target_storage(self):
        from storages.backends.s3 import S3Storage

        target = storages["default"]
        if not isinstance(target, S3Storage) or target.file_overwrite:
            raise CommandError("Configure S3 dataset storage with file_overwrite=False before copying.")
        return target

    def handle(self, *args, **options):
        try:
            root = Path(options["source_root"]).resolve(strict=True)
            if not root.is_dir():
                raise OSError("Not a directory")
        except OSError as error:
            raise CommandError("The source root must be an existing readable directory.") from error

        target = self.get_target_storage()
        apply = options["apply"]
        copied = pending = existing = 0
        for dataset in Dataset.objects.order_by("pk").iterator(chunk_size=200):
            name = dataset.file.name
            # Only copy the generated owner/UUID keys. Never follow arbitrary DB paths.
            if name != dataset_upload_path(dataset, dataset.filename):
                raise CommandError(f"Dataset {dataset.pk}: unexpected storage key; no copy attempted.")
            try:
                path = (root / name).resolve(strict=True)
                if not path.is_relative_to(root) or not path.is_file():
                    raise CommandError(f"Dataset {dataset.pk}: source is outside the upload root or is not a file.")
                with path.open("rb") as source:
                    verify_content(source, dataset)
                    if target.exists(name):
                        with target.open(name, "rb") as stored:
                            verify_content(stored, dataset)
                        existing += 1
                        continue
                    if not apply:
                        pending += 1
                        self.stdout.write(f"Would copy dataset {dataset.pk}.")
                        continue
                    source.seek(0)
                    saved_name = target.save(name, File(source), max_length=255)
                    if saved_name != name:
                        # An object appeared between exists/save. Storage must not
                        # overwrite it; remove only the alternate object just created.
                        target.delete(saved_name)
                        raise CommandError(f"Dataset {dataset.pk}: target changed during copy; retry after stopping uploads.")
                    with target.open(name, "rb") as stored:
                        verify_content(stored, dataset)
                    copied += 1
            except CommandError:
                raise
            except Exception as error:
                # SDK exceptions can contain endpoint/credential details.
                raise CommandError(f"Dataset {dataset.pk}: copy failed; check storage access and retry. Source and metadata are unchanged.") from error

        self.stdout.write(self.style.SUCCESS(
            f"{'Copy complete' if apply else 'Dry-run complete'}: "
            f"{copied} copied, {pending} would copy, {existing} already verified. "
            "Source files and metadata are unchanged."
        ))
