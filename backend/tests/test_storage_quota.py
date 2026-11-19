"""Exercise quota enforcement through real services, files, API and workers."""
import hashlib
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import IntegrityError
from django.test import Client, TestCase, override_settings

from accounts.models import StorageReservation
from datasets.errors import DatasetError
from datasets.models import Dataset
from etl.models import ETLRun
from services import etl_service
from services.dataset_service import delete_dataset, replace_dataset, upload_dataset
from services.storage_service import abandon_reservation, owner_storage_lock, reserve_locked, storage_usage
from tests.test_etl_api import ETLSetupMixin


@override_settings(ACCOUNT_STORAGE_LIMIT_BYTES=10)
class DatasetStorageQuotaTests(TestCase):
    def setUp(self):
        temporary = TemporaryDirectory(prefix="cloudetl-quota-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        media = override_settings(MEDIA_ROOT=temporary.name)
        media.enable()
        self.addCleanup(media.disable)
        self.user = get_user_model().objects.create_user(username="quota-owner")
        self.other = get_user_model().objects.create_user(username="quota-other")

    def upload(self, data=b"id\n1\n", owner=None):
        result = upload_dataset(owner or self.user, SimpleUploadedFile("data.csv", data))
        return Dataset.objects.get(pk=result["id"])

    def stored_files(self):
        return [path for path in self.root.rglob("*") if path.is_file()]

    def test_exact_combined_limit_and_server_rejection_before_storage(self):
        self.upload()
        self.upload()
        storage = Dataset._meta.get_field("file").storage
        with patch.object(storage, "save", wraps=storage.save) as save:
            with self.assertRaises(DatasetError) as failure:
                self.upload()
        self.assertEqual(failure.exception.code, "storage_quota_exceeded")
        self.assertEqual(failure.exception.status, 413)
        self.assertEqual(failure.exception.fields["storage"]["required_bytes"], 5)
        self.assertEqual(failure.exception.fields["storage"]["available_bytes"], 0)
        save.assert_not_called()
        self.assertEqual(storage_usage(self.user)["used_bytes"], 10)
        self.assertEqual(len(self.stored_files()), 2)
        self.assertFalse(StorageReservation.objects.exists())
        self.upload(owner=self.other)
        self.assertEqual(storage_usage(self.other)["used_bytes"], 5)

    def test_api_error_lists_quota_without_exposing_storage_keys(self):
        dataset = self.upload()
        self.upload()
        client = Client()
        client.force_login(self.user)
        response = client.post("/api/datasets/", {"file": SimpleUploadedFile("extra.csv", b"id\n1\n")})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["error"]["code"], "storage_quota_exceeded")
        self.assertNotIn(dataset.file.name, response.content.decode())
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(client.get("/api/datasets/").json()["storage"]["used_bytes"], 10)

    def test_replacement_uses_growth_and_allows_equal_or_smaller_over_limit(self):
        dataset = self.upload(b"id\n12345\n")  # 9 bytes
        replaced = replace_dataset(self.user, dataset.pk, SimpleUploadedFile("new.csv", b"id\n123456\n"))
        self.assertEqual(replaced["dataset"]["size_bytes"], 10)
        self.assertEqual(storage_usage(self.user)["used_bytes"], 10)
        self.assertEqual(len(self.stored_files()), 1)
        with self.assertRaises(DatasetError) as failure:
            replace_dataset(self.user, dataset.pk, SimpleUploadedFile("large.csv", b"id\n1234567\n"))
        self.assertEqual(failure.exception.code, "storage_quota_exceeded")
        with override_settings(ACCOUNT_STORAGE_LIMIT_BYTES=4):
            replace_dataset(self.user, dataset.pk, SimpleUploadedFile("same.csv", b"id\n123456\n"))
            replace_dataset(self.user, dataset.pk, SimpleUploadedFile("smaller.csv", b"id\n1\n"))
            self.assertEqual(storage_usage(self.user)["used_bytes"], 5)
            self.assertTrue(storage_usage(self.user)["over_limit"])
        self.assertEqual(len(self.stored_files()), 1)

    def test_delete_releases_space_and_failed_cleanup_remains_charged_until_retry(self):
        dataset = self.upload()
        old_name = dataset.file.name
        storage = dataset.file.storage
        with patch.object(storage, "delete", side_effect=OSError("private credentials")), self.assertLogs(level="ERROR"):
            result = delete_dataset(self.user, dataset.pk)
        self.assertTrue(result["deleted"])
        self.assertIn("warning", result)
        usage = storage_usage(self.user)
        self.assertEqual(usage["uploaded_bytes"], 0)
        self.assertEqual(usage["pending_cleanup_bytes"], 5)
        self.assertEqual(usage["available_bytes"], 5)
        self.assertTrue(storage.exists(old_name))
        output = StringIO()
        call_command("cleanup_storage_objects", stdout=output)
        self.assertIn("1 would clean", output.getvalue())
        self.assertTrue(storage.exists(old_name))
        call_command("cleanup_storage_objects", "--apply", stdout=StringIO())
        self.assertFalse(storage.exists(old_name))
        self.assertFalse(StorageReservation.objects.exists())
        self.assertEqual(storage_usage(self.user)["available_bytes"], 10)

    def test_failed_replacement_cleanup_charges_old_and_new_objects(self):
        dataset = self.upload()
        with patch.object(dataset.file.storage, "delete", side_effect=OSError("delete failed")), self.assertLogs(level="ERROR"):
            result = replace_dataset(self.user, dataset.pk, SimpleUploadedFile("same.csv", b"id\n2\n"))
        self.assertIn("warning", result)
        self.assertEqual(storage_usage(self.user)["used_bytes"], 10)
        self.assertEqual(storage_usage(self.user)["pending_cleanup_bytes"], 5)
        with self.assertRaises(DatasetError):
            self.upload()
        with self.assertRaises(DatasetError) as failure:
            replace_dataset(self.user, dataset.pk, SimpleUploadedFile("same-again.csv", b"id\n3\n"))
        self.assertEqual(failure.exception.code, "storage_quota_exceeded")
        call_command("cleanup_storage_objects", "--apply", stdout=StringIO())
        self.assertEqual(storage_usage(self.user)["used_bytes"], 5)
        replace_dataset(self.user, dataset.pk, SimpleUploadedFile("after-cleanup.csv", b"id\n3\n"))

    def test_partial_storage_failure_is_cleaned_even_if_save_never_returned(self):
        storage = Dataset._meta.get_field("file").storage
        original_save = storage.save

        def store_then_fail(key, content, **kwargs):
            original_save(key, content, **kwargs)
            raise OSError("private object store error")

        with patch.object(storage, "save", side_effect=store_then_fail), self.assertLogs(level="ERROR"):
            with self.assertRaises(DatasetError) as failure:
                self.upload()
        self.assertEqual(failure.exception.code, "upload_failed")
        self.assertEqual(self.stored_files(), [])
        self.assertFalse(StorageReservation.objects.exists())
        self.assertEqual(storage_usage(self.user)["used_bytes"], 0)

    def test_abandon_after_published_replacement_never_deletes_current_file(self):
        dataset = self.upload()
        storage = dataset.file.storage
        old_key = f"datasets/{self.user.pk}/detached.csv"
        storage.save(old_key, ContentFile(b"id\n0\n"))
        cleanup = StorageReservation.objects.create(
            owner=self.user, target=f"dataset:{dataset.pk}", object_key=old_key,
            size_bytes=5, reserved_bytes=0, state=StorageReservation.State.CLEANUP,
        )
        self.assertTrue(abandon_reservation(cleanup, storage, object_key=dataset.file.name))
        self.assertTrue(storage.exists(dataset.file.name))
        self.assertFalse(storage.exists(old_key))
        self.assertEqual(storage_usage(self.user)["used_bytes"], 5)

    def test_insert_and_cleanup_failure_keep_durable_charge_and_no_metadata(self):
        storage = Dataset._meta.get_field("file").storage
        with patch("services.dataset_service.insert_dataset", side_effect=IntegrityError("private db error")), patch.object(storage, "delete", side_effect=OSError("private key")), self.assertLogs(level="ERROR"):
            with self.assertRaises(DatasetError):
                self.upload()
        self.assertFalse(Dataset.objects.exists())
        self.assertEqual(storage_usage(self.user)["pending_cleanup_bytes"], 5)
        self.assertEqual(len(self.stored_files()), 1)

    def test_reserved_replacement_blocks_delete_and_second_replacement(self):
        dataset = self.upload()
        with owner_storage_lock(self.user):
            reserve_locked(self.user, target=f"dataset:{dataset.pk}", object_key=f"datasets/{self.user.pk}/stage.csv",
                           size_bytes=6, credit_bytes=dataset.size_bytes)
        with self.assertRaises(DatasetError) as failure:
            delete_dataset(self.user, dataset.pk)
        self.assertEqual(failure.exception.code, "file_busy")
        with self.assertRaises(DatasetError) as failure:
            replace_dataset(self.user, dataset.pk, SimpleUploadedFile("again.csv", b"id\n2\n"))
        self.assertEqual(failure.exception.code, "file_busy")
        self.assertTrue(dataset.file.storage.exists(dataset.file.name))
        self.assertEqual(storage_usage(self.user)["reserved_bytes"], 1)

    def test_cleanup_command_does_not_expire_live_writes_or_touch_other_owners(self):
        for owner in (self.user, self.other):
            key = f"datasets/{owner.pk}/pending.csv"
            storage = Dataset._meta.get_field("file").storage
            storage.save(key, ContentFile(b"id\n1\n"))
            StorageReservation.objects.create(owner=owner, target=key, object_key=key, size_bytes=5, reserved_bytes=0,
                                             state=StorageReservation.State.CLEANUP)
        with owner_storage_lock(self.user):
            reserve_locked(self.user, target="live-write", object_key=f"datasets/{self.user.pk}/live.csv", size_bytes=5)
        call_command("cleanup_storage_objects", "--apply", owner_id=self.user.pk, stdout=StringIO())
        self.assertEqual(StorageReservation.objects.filter(owner=self.other).count(), 1)
        self.assertTrue(StorageReservation.objects.filter(owner=self.user, state="writing").exists())
        self.assertEqual(storage_usage(self.user)["reserved_bytes"], 5)


class ETLStorageQuotaTests(ETLSetupMixin, TestCase):
    def delete_output(self, run):
        return self.client.delete(f"/api/etl/runs/{run.pk}/result/", HTTP_X_CSRFTOKEN=self.csrf)

    def test_worker_checks_remaining_space_before_object_write(self):
        with override_settings(ACCOUNT_STORAGE_LIMIT_BYTES=self.dataset.size_bytes):
            storage = ETLRun._meta.get_field("result").storage
            with patch.object(storage, "save", wraps=storage.save) as save:
                run = self.process()
            save.assert_not_called()
            self.assertEqual(run.status, "failed")
            self.assertEqual(run.error_code, "storage_quota_exceeded")
            self.assertFalse(run.result)
            self.assertFalse(StorageReservation.objects.exists())
            self.assertEqual(storage_usage(self.user)["used_bytes"], self.dataset.size_bytes)

    def test_exact_upload_plus_result_limit_and_exports_do_not_double_charge(self):
        first = self.process()
        result_size = first.size_bytes
        self.assertEqual(self.delete_output(first).status_code, 200)
        with override_settings(ACCOUNT_STORAGE_LIMIT_BYTES=self.dataset.size_bytes + result_size):
            run = self.process()
            self.assertEqual(run.status, "succeeded", run.error_message)
            self.assertEqual(storage_usage(self.user)["available_bytes"], 0)
            before = storage_usage(self.user)
            for file_format in ("parquet", "csv", "tsv", "json", "xlsx"):
                response = self.client.get(f"/api/etl/runs/{run.pk}/download/", {"format": file_format})
                self.assertEqual(response.status_code, 200)
            self.assertEqual(storage_usage(self.user), before)
            failed = self.process()
            self.assertEqual(failed.error_code, "storage_quota_exceeded")
            self.assertEqual(storage_usage(self.user), before)

    def test_output_deletion_reclaims_space_preserves_history_and_rejects_reads(self):
        run = self.process()
        key, size, report, config = run.result.name, run.size_bytes, run.summary, run.configuration
        self.assertTrue(etl_service.public_run(run)["result_available"])
        self.assertEqual(storage_usage(self.user)["result_bytes"], size)
        self.assertEqual(self.delete_output(run).json(), {"deleted": True})
        run.refresh_from_db()
        self.assertEqual(run.status, "succeeded")
        self.assertEqual(run.summary, report)
        self.assertEqual(run.configuration, config)
        self.assertFalse(run.result.storage.exists(key))
        self.assertEqual(storage_usage(self.user)["result_bytes"], 0)
        data = self.client.get(f"/api/etl/runs/{run.pk}/").json()["run"]
        self.assertFalse(data["result_available"])
        self.assertIsNone(data["download_url"])
        for suffix in ("download/", "rows/"):
            response = self.client.get(f"/api/etl/runs/{run.pk}/{suffix}")
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json()["error"]["code"], "result_deleted")
        self.assertEqual(self.delete_output(run).status_code, 200)

    def test_output_delete_requires_owner_csrf_and_finished_run(self):
        run = self.process()
        url = f"/api/etl/runs/{run.pk}/result/"
        self.assertEqual(self.client.delete(url).status_code, 403)
        self.client.force_login(self.other)
        self.assertEqual(self.client.delete(url, HTTP_X_CSRFTOKEN=self.csrf).status_code, 404)
        self.assertTrue(ETLRun.objects.get(pk=run.pk).result)
        self.client.force_login(self.user)
        queued = etl_service.submit_run(self.user, self.payload())
        response = self.client.delete(f"/api/etl/runs/{queued['id']}/result/", HTTP_X_CSRFTOKEN=self.csrf)
        self.assertEqual(response.status_code, 409)

    def test_failed_output_cleanup_keeps_charge_and_can_be_retried(self):
        run = self.process()
        size = run.size_bytes
        with patch.object(run.result.storage, "delete", side_effect=OSError("private secret")), self.assertLogs(level="ERROR"):
            response = self.delete_output(run)
        self.assertEqual(response.status_code, 200)
        self.assertIn("warning", response.json())
        self.assertNotIn("private secret", response.content.decode())
        self.assertEqual(storage_usage(self.user)["result_bytes"], 0)
        self.assertEqual(storage_usage(self.user)["pending_cleanup_bytes"], size)
        call_command("cleanup_storage_objects", "--apply", stdout=StringIO())
        self.assertEqual(storage_usage(self.user)["used_bytes"], self.dataset.size_bytes)

    def test_partial_output_save_failure_cleans_known_attempt_and_releases_reservation(self):
        storage = ETLRun._meta.get_field("result").storage
        original_save = storage.save

        def store_then_fail(key, content, **kwargs):
            original_save(key, content, **kwargs)
            raise OSError("private storage error")

        with patch.object(storage, "save", side_effect=store_then_fail), self.assertLogs(level="ERROR"):
            run = self.process()
        self.assertEqual(run.status, "failed")
        self.assertFalse(StorageReservation.objects.exists())
        self.assertEqual(storage_usage(self.user)["result_bytes"], 0)
        files = [path for path in Path(self.media_root).rglob("*") if path.is_file()]
        self.assertEqual(len(files), 1)
        self.assertEqual(hashlib.sha256(files[0].read_bytes()).hexdigest(), self.dataset.sha256)
