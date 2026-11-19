"""Quota admissions serialize on each owner's row, not a process-local counter."""
from queue import Queue
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier, Event, Thread

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, connections
from django.test import TransactionTestCase, override_settings, skipUnlessDBFeature

from accounts.models import StorageReservation
from datasets.errors import DatasetError
from datasets.models import Dataset
from services.dataset_service import upload_dataset
from services.storage_service import owner_storage_lock, reserve_locked, storage_usage


@skipUnlessDBFeature("has_select_for_update")
@override_settings(ACCOUNT_STORAGE_LIMIT_BYTES=100)
class StorageQuotaConcurrencyTests(TransactionTestCase):
    wait_seconds = 10

    def setUp(self):
        self.user = get_user_model().objects.create_user(username="quota-owner")
        self.other = get_user_model().objects.create_user(username="quota-other")
        Dataset.objects.create(owner=self.user, filename="legacy.csv", format="csv", file="private/legacy.csv",
                               size_bytes=40, sha256="a" * 64)

    def concurrent_reservations(self, *, same_target=False):
        barrier = Barrier(3)
        outcomes, errors, pids = Queue(), Queue(), Queue()
        owner_id = self.user.pk

        def reserve(index):
            try:
                connections.close_all()
                user = get_user_model().objects.get(pk=owner_id)
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    pids.put(cursor.fetchone()[0])
                barrier.wait(timeout=self.wait_seconds)
                try:
                    with owner_storage_lock(user):
                        reservation = reserve_locked(user, target="dataset:shared" if same_target else f"upload:{index}",
                                                     object_key=f"private/new-{index}.csv", size_bytes=40)
                except DatasetError as error:
                    outcomes.put(("rejected", error.code, error.status))
                else:
                    outcomes.put(("accepted", str(reservation.pk), reservation.reserved_bytes))
            except BaseException as error:
                errors.put(error)
                barrier.abort()
            finally:
                connections.close_all()

        workers = [Thread(target=reserve, args=(index,), daemon=True, name=f"quota-admission-{index}") for index in range(2)]
        for worker in workers:
            worker.start()
        try:
            barrier.wait(timeout=self.wait_seconds)
        finally:
            for worker in workers:
                worker.join(self.wait_seconds)
        self.assertTrue(all(not worker.is_alive() for worker in workers), "Quota admission threads did not finish.")
        if not errors.empty():
            raise errors.get_nowait()
        self.assertEqual(pids.qsize(), 2)
        self.assertNotEqual(pids.get_nowait(), pids.get_nowait())
        self.assertEqual(outcomes.qsize(), 2)
        return [outcomes.get_nowait() for _ in range(2)]

    def test_concurrent_writes_cannot_reserve_more_than_the_remaining_allowance(self):
        outcomes = self.concurrent_reservations()
        accepted = [item for item in outcomes if item[0] == "accepted"]
        self.assertEqual(len(accepted), 1, outcomes)
        self.assertEqual(accepted[0][2], 40)
        self.assertEqual([item for item in outcomes if item[0] == "rejected"], [("rejected", "storage_quota_exceeded", 413)])
        self.assertEqual(StorageReservation.objects.filter(owner=self.user).count(), 1)
        usage = storage_usage(self.user)
        self.assertEqual(usage["used_bytes"], 40)
        self.assertEqual(usage["reserved_bytes"], 40)
        self.assertEqual(usage["available_bytes"], 20)

    def test_two_writers_for_the_same_target_are_rejected_as_busy(self):
        outcomes = self.concurrent_reservations(same_target=True)
        self.assertEqual(len([item for item in outcomes if item[0] == "accepted"]), 1, outcomes)
        self.assertEqual([item for item in outcomes if item[0] == "rejected"], [("rejected", "file_busy", 409)])
        self.assertEqual(StorageReservation.objects.filter(owner=self.user, target="dataset:shared").count(), 1)

    def test_simultaneous_upload_services_publish_only_one_file_within_quota(self):
        content = b"name\n" + b"x" * 44 + b"\n"
        self.assertEqual(len(content), 50)
        owner_id = self.user.pk
        barrier = Barrier(3)
        outcomes, errors, pids = Queue(), Queue(), Queue()

        def upload(index):
            try:
                connections.close_all()
                user = get_user_model().objects.get(pk=owner_id)
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    pids.put(cursor.fetchone()[0])
                file = SimpleUploadedFile(f"upload-{index}.csv", content, content_type="text/csv")
                barrier.wait(timeout=self.wait_seconds)
                try:
                    result = upload_dataset(user, file)
                except DatasetError as error:
                    outcomes.put(("rejected", error.code, error.status))
                else:
                    outcomes.put(("accepted", result["id"], result["size_bytes"]))
            except BaseException as error:
                errors.put(error)
                barrier.abort()
            finally:
                connections.close_all()

        with TemporaryDirectory(prefix="cloudetl-quota-concurrency-") as directory:
            with override_settings(MEDIA_ROOT=directory, STORAGES={
                "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
            }):
                workers = [Thread(target=upload, args=(index,), daemon=True, name=f"quota-upload-{index}") for index in range(2)]
                for worker in workers:
                    worker.start()
                try:
                    barrier.wait(timeout=self.wait_seconds)
                finally:
                    for worker in workers:
                        worker.join(self.wait_seconds)
                self.assertTrue(all(not worker.is_alive() for worker in workers), "Upload service threads did not finish.")
                if not errors.empty():
                    raise errors.get_nowait()
                self.assertEqual(pids.qsize(), 2)
                self.assertNotEqual(pids.get_nowait(), pids.get_nowait())
                self.assertEqual(outcomes.qsize(), 2)
                results = [outcomes.get_nowait() for _ in range(2)]
                accepted = [item for item in results if item[0] == "accepted"]
                self.assertEqual(len(accepted), 1, results)
                self.assertEqual(accepted[0][2], 50)
                self.assertEqual([item for item in results if item[0] == "rejected"], [("rejected", "storage_quota_exceeded", 413)])
                self.assertEqual(Dataset.objects.filter(owner=self.user).count(), 2)
                published = Dataset.objects.get(pk=accepted[0][1])
                self.assertEqual(published.size_bytes, 50)
                files = [path for path in Path(directory).rglob("*") if path.is_file()]
                self.assertEqual(files, [Path(directory) / published.file.name])
                self.assertEqual(files[0].read_bytes(), content)
                self.assertFalse(StorageReservation.objects.filter(owner=self.user).exists())
                usage = storage_usage(self.user)
                self.assertEqual(usage["used_bytes"], 90)
                self.assertEqual(usage["reserved_bytes"], 0)
                self.assertEqual(usage["available_bytes"], 10)

    def test_one_owners_lock_does_not_block_another_owners_admission(self):
        locked, release = Event(), Event()
        errors = Queue()
        owner_id = self.user.pk

        def hold_lock():
            try:
                connections.close_all()
                user = get_user_model().objects.get(pk=owner_id)
                with owner_storage_lock(user):
                    locked.set()
                    if not release.wait(self.wait_seconds):
                        raise AssertionError("Timed out waiting to release the first owner's lock.")
            except BaseException as error:
                errors.put(error)
                locked.set()
            finally:
                connections.close_all()

        worker = Thread(target=hold_lock, daemon=True, name="quota-owner-isolation")
        worker.start()
        try:
            self.assertTrue(locked.wait(self.wait_seconds))
            if not errors.empty():
                raise errors.get_nowait()
            with owner_storage_lock(self.other):
                reservation = reserve_locked(self.other, target="upload:other", object_key="private/other.csv", size_bytes=100)
            self.assertEqual(reservation.owner_id, self.other.pk)
            self.assertEqual(storage_usage(self.other)["available_bytes"], 0)
        finally:
            release.set()
            worker.join(self.wait_seconds)
        self.assertFalse(worker.is_alive(), "The owner-lock thread did not finish.")
        if not errors.empty():
            raise errors.get_nowait()
        self.assertEqual(storage_usage(self.user)["available_bytes"], 60)
