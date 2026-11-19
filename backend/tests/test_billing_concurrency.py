"""Billing idempotence under independent PostgreSQL sessions, without gateway I/O."""
from datetime import timedelta
from queue import Queue
from threading import Barrier, Thread
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TransactionTestCase, override_settings, skipUnlessDBFeature
from django.utils import timezone

from billing import service
from billing.models import PaymentOrder, Subscription


@skipUnlessDBFeature("has_select_for_update")
@override_settings(BILLING_DEMO_ENABLED=True, ACCOUNT_STORAGE_LIMIT_BYTES=500 * 1024**2)
class BillingConcurrencyTests(TransactionTestCase):
    wait_seconds = 10

    def setUp(self):
        super().setUp()
        if connection.vendor != "postgresql":
            self.skipTest("Requires independent PostgreSQL sessions.")
        self.user = get_user_model().objects.create_user(username="concurrent-billing-owner")
        self.now = timezone.now().replace(microsecond=0)

    def parallel(self, action):
        """Release both sessions together; timeouts make deadlocks observable."""
        barrier = Barrier(3)
        results, errors, backend_pids = Queue(), Queue(), Queue()
        owner_id = self.user.pk

        def worker():
            try:
                connections.close_all()
                user = get_user_model().objects.get(pk=owner_id)
                with connection.cursor() as cursor:
                    cursor.execute("SET lock_timeout = '5s'")
                    cursor.execute("SET statement_timeout = '5s'")
                    cursor.execute("SELECT pg_backend_pid()")
                    backend_pids.put(cursor.fetchone()[0])
                barrier.wait(timeout=self.wait_seconds)
                results.put(action(user))
            except BaseException as error:
                errors.put(error)
                barrier.abort()
            finally:
                connections.close_all()

        workers = [Thread(target=worker, name=f"billing-test-{index}", daemon=True) for index in range(2)]
        for worker_thread in workers:
            worker_thread.start()
        try:
            barrier.wait(timeout=self.wait_seconds)
        finally:
            for worker_thread in workers:
                worker_thread.join(self.wait_seconds)
        self.assertTrue(all(not worker_thread.is_alive() for worker_thread in workers), "A concurrent billing request did not finish.")
        if not errors.empty():
            raise errors.get_nowait()
        self.assertEqual(backend_pids.qsize(), 2)
        self.assertNotEqual(backend_pids.get_nowait(), backend_pids.get_nowait())
        self.assertEqual(results.qsize(), 2)
        return [results.get_nowait(), results.get_nowait()]

    def test_simultaneous_checkout_creation_reuses_one_pending_order(self):
        with patch("billing.service.timezone.now", return_value=self.now):
            results = self.parallel(lambda user: service.create_order(user, "premium"))
        self.assertEqual(results[0]["id"], results[1]["id"])
        self.assertEqual(PaymentOrder.objects.filter(owner=self.user).count(), 1)
        order = PaymentOrder.objects.get(owner=self.user)
        self.assertEqual(order.status, "pending")
        self.assertEqual(order.expires_at, self.now + timedelta(minutes=15))
        self.assertFalse(Subscription.objects.filter(owner=self.user).exists())

    def test_simultaneous_success_callbacks_extend_existing_period_only_once(self):
        existing_end = self.now + timedelta(days=12)
        subscription = Subscription.objects.create(owner=self.user, current_period_end=existing_end)
        with patch("billing.service.timezone.now", return_value=self.now):
            order = service.create_order(self.user, "premium")
            results = self.parallel(lambda user: service.complete_order(user, order["id"], "succeeded"))
        self.assertEqual([result["status"] for result in results], ["succeeded", "succeeded"])
        self.assertEqual({result["id"] for result in results}, {order["id"]})
        subscription.refresh_from_db()
        self.assertEqual(subscription.current_period_end, existing_end + timedelta(days=30))
        self.assertEqual(Subscription.objects.filter(owner=self.user).count(), 1)
        stored = PaymentOrder.objects.get(pk=order["id"])
        self.assertEqual(stored.status, "succeeded")
        self.assertEqual(stored.completed_at, self.now)
