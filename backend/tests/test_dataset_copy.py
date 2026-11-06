import hashlib
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from datasets.models import Dataset, dataset_upload_path


class CopyDatasetObjectsTests(TestCase):
    def setUp(self):
        temporary = TemporaryDirectory(prefix="cloudetl-copy-test-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.source = root / "source"
        self.source.mkdir()
        self.target = FileSystemStorage(location=root / "target")
        self.user = get_user_model().objects.create_user(username="copy-owner")
        self.content = b"id,value\n1,original\n"
        self.dataset = Dataset(owner=self.user, filename="original.csv", format="csv",
                               size_bytes=len(self.content), sha256=hashlib.sha256(self.content).hexdigest())
        self.name = dataset_upload_path(self.dataset, "original.csv")
        self.dataset.file.name = self.name
        self.dataset.save()
        self.path = self.source / self.name
        self.path.parent.mkdir(parents=True)
        self.path.write_bytes(self.content)
        target_patch = patch("datasets.management.commands.copy_dataset_objects.Command.get_target_storage", return_value=self.target)
        target_patch.start()
        self.addCleanup(target_patch.stop)

    def copy(self, *args):
        output = StringIO()
        call_command("copy_dataset_objects", "--source-root", str(self.source), *args, stdout=output)
        return output.getvalue()

    def test_default_dry_run_checks_source_without_writing(self):
        self.assertIn("1 would copy", self.copy())
        self.assertFalse(self.target.exists(self.name))
        self.assertEqual(self.path.read_bytes(), self.content)

    def test_apply_preserves_key_bytes_and_metadata_and_can_be_repeated(self):
        metadata = Dataset.objects.values().get(pk=self.dataset.pk)
        self.assertIn("1 copied", self.copy("--apply"))
        with self.target.open(self.name) as stored:
            self.assertEqual(stored.read(), self.content)
        self.assertEqual(self.path.read_bytes(), self.content)
        self.assertEqual(Dataset.objects.values().get(pk=self.dataset.pk), metadata)
        self.assertIn("1 already verified", self.copy("--apply"))

    def test_different_target_is_never_overwritten(self):
        self.target.save(self.name, ContentFile(b"different"))
        with self.assertRaisesMessage(CommandError, "does not match metadata"):
            self.copy("--apply")
        with self.target.open(self.name) as stored:
            self.assertEqual(stored.read(), b"different")

    def test_changed_source_is_not_copied(self):
        self.path.write_bytes(b"changed")
        with self.assertRaisesMessage(CommandError, "does not match metadata"):
            self.copy("--apply")
        self.assertFalse(self.target.exists(self.name))

    def test_arbitrary_database_path_is_rejected_before_reading(self):
        self.dataset.file.name = "../outside.csv"
        self.dataset.save(update_fields=["file"])
        with self.assertRaisesMessage(CommandError, "unexpected storage key"):
            self.copy("--apply")

    def test_storage_error_is_safe_and_keeps_sources_and_metadata(self):
        with patch.object(self.target, "exists", side_effect=OSError("private credential detail")):
            with self.assertRaisesMessage(CommandError, "copy failed") as raised:
                self.copy("--apply")
        self.assertNotIn("private credential", str(raised.exception))
        self.assertTrue(Dataset.objects.filter(pk=self.dataset.pk).exists())
        self.assertEqual(self.path.read_bytes(), self.content)

    def test_racing_target_is_preserved_and_only_new_alternate_is_removed(self):
        original_save = self.target.save

        def race(name, source, **kwargs):
            original_save(name, ContentFile(self.content))
            return original_save(name, source, **kwargs)

        with patch.object(self.target, "save", side_effect=race):
            with self.assertRaisesMessage(CommandError, "target changed during copy"):
                self.copy("--apply")
        target_root = Path(self.target.location)
        self.assertEqual([str(path.relative_to(target_root)).replace("\\", "/") for path in target_root.rglob("*") if path.is_file()], [self.name])
        self.assertEqual(self.path.read_bytes(), self.content)
