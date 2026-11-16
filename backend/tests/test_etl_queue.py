"""Exercise queue locking using committed rows and independent PostgreSQL sessions."""

from queue import Queue
from threading import Barrier, Event, Thread

from django.contrib.auth import get_user_model
from django.db import connection, connections, transaction
from django.test import TransactionTestCase, skipUnlessDBFeature
from django.utils import timezone

from datasets.models import Dataset
from etl.errors import ETLError
from etl.models import ETLRun
from services import etl_service


@skipUnlessDBFeature("has_select_for_update_skip_locked")
class EtlQueueConcurrencyTests(TransactionTestCase):
    """Do not run these against an application database; use config.test_settings."""

    wait_seconds = 10

    def setUp(self):
        super().setUp()
        self.user = get_user_model().objects.create_user(username="queue-owner")
        # Admission only reads metadata; no files or storage connections are needed.
        self.dataset = Dataset.objects.create(
            owner=self.user, filename="input.csv", format="csv",
            file="datasets/private-test-input.csv", size_bytes=4, sha256="a" * 64,
        )
        self.payload = {
            "name": "Concurrent admission", "datasetId": str(self.dataset.pk), "steps": [],
        }

    def create_run(self, **extra):
        return ETLRun.objects.create(
            owner=self.user, name="Queue locking", configuration={}, sources={}, **extra,
        )

    def test_claims_skip_locked_oldest_and_never_claim_same_job_twice(self):
        oldest, second, third = [self.create_run() for _ in range(3)]
        lock_held = Event()
        release_lock = Event()
        worker_errors = Queue()
        worker_pids = Queue()

        def hold_oldest_lock():
            try:
                # Django connections are thread-local; this opens a separate session.
                connections.close_all()
                with transaction.atomic():
                    ETLRun.objects.select_for_update().get(pk=oldest.pk)
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        worker_pids.put(cursor.fetchone()[0])
                    lock_held.set()
                    if not release_lock.wait(self.wait_seconds):
                        raise AssertionError("Timed out waiting to release the oldest queue row.")
            except BaseException as error:
                worker_errors.put(error)
                lock_held.set()
            finally:
                connections.close_all()

        worker = Thread(target=hold_oldest_lock, name="etl-test-row-lock", daemon=True)
        worker.start()
        try:
            self.assertTrue(lock_held.wait(self.wait_seconds), "The second connection never acquired its row lock.")
            if not worker_errors.empty():
                raise worker_errors.get_nowait()
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                main_pid = cursor.fetchone()[0]
            self.assertNotEqual(worker_pids.get_nowait(), main_pid)
            first_claim = etl_service.claim_next_run()
            second_claim = etl_service.claim_next_run()
            self.assertEqual(first_claim.pk, second.pk)
            self.assertEqual(second_claim.pk, third.pk)
            self.assertNotEqual(first_claim.claim_token, second_claim.claim_token)
            self.assertEqual(first_claim.status, ETLRun.Status.RUNNING)
            self.assertEqual(second_claim.status, ETLRun.Status.RUNNING)
            self.assertIsNone(etl_service.claim_next_run())
            oldest.refresh_from_db()
            self.assertEqual(oldest.status, ETLRun.Status.QUEUED)
        finally:
            release_lock.set()
            worker.join(self.wait_seconds)
        self.assertFalse(worker.is_alive(), "The row-lock thread did not finish.")
        if not worker_errors.empty():
            raise worker_errors.get_nowait()
        final_claim = etl_service.claim_next_run()
        self.assertEqual(final_claim.pk, oldest.pk)
        self.assertIsNone(etl_service.claim_next_run())
        self.assertEqual(ETLRun.objects.filter(status=ETLRun.Status.RUNNING).count(), 3)

    def test_simultaneous_admissions_cannot_exceed_ten_pending_per_owner(self):
        for _ in range(8):
            self.create_run()
        self.create_run(status=ETLRun.Status.RUNNING, started_at=timezone.now())
        # Completed work must not consume admission capacity.
        self.create_run(status=ETLRun.Status.SUCCEEDED, finished_at=timezone.now())
        barrier = Barrier(3)
        outcomes = Queue()
        worker_errors = Queue()
        worker_pids = Queue()
        owner_id = self.user.pk

        def submit_after_barrier():
            try:
                connections.close_all()
                user = get_user_model().objects.get(pk=owner_id)
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    worker_pids.put(cursor.fetchone()[0])
                barrier.wait(timeout=self.wait_seconds)
                try:
                    result = etl_service.submit_run(user, self.payload)
                except ETLError as error:
                    outcomes.put(("rejected", error.code, error.status))
                else:
                    outcomes.put(("accepted", result["status"], result["id"]))
            except BaseException as error:
                worker_errors.put(error)
                barrier.abort()
            finally:
                connections.close_all()

        workers = [Thread(target=submit_after_barrier, name=f"etl-test-admission-{index}", daemon=True) for index in range(2)]
        for worker in workers:
            worker.start()
        try:
            barrier.wait(timeout=self.wait_seconds)
        finally:
            for worker in workers:
                worker.join(self.wait_seconds)
        self.assertTrue(all(not worker.is_alive() for worker in workers), "A queue admission thread did not finish.")
        if not worker_errors.empty():
            raise worker_errors.get_nowait()
        self.assertEqual(worker_pids.qsize(), 2)
        self.assertNotEqual(worker_pids.get_nowait(), worker_pids.get_nowait())
        self.assertEqual(outcomes.qsize(), 2)
        results = [outcomes.get_nowait() for _ in range(2)]
        accepted = [result for result in results if result[0] == "accepted"]
        rejected = [result for result in results if result[0] == "rejected"]
        self.assertEqual(len(accepted), 1, results)
        self.assertEqual(accepted[0][1], ETLRun.Status.QUEUED)
        self.assertEqual(rejected, [("rejected", "queue_limit", 429)])
        self.assertEqual(ETLRun.objects.filter(owner=self.user, status__in=[ETLRun.Status.QUEUED, ETLRun.Status.RUNNING]).count(), 10)
        self.assertEqual(ETLRun.objects.filter(owner=self.user).count(), 11)
