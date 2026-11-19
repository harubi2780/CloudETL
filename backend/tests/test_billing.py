"""Local billing simulation and time-bound quota behavior; no gateway calls."""
import json
from importlib import import_module
from datetime import datetime, timedelta, timezone as datetime_timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.apps import apps
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from accounts.models import AccountEntitlement, StorageReservation
from billing import service
from billing.models import PaymentOrder, Subscription
from datasets.errors import DatasetError
from datasets.models import Dataset
from etl.models import ETLRun
from services import storage_service


FREE_BYTES = 500 * 1024**2
PREMIUM_BYTES = 2 * 1024**3


@override_settings(ALLOWED_HOSTS=["testserver"], BILLING_DEMO_ENABLED=True,
                   ACCOUNT_STORAGE_LIMIT_BYTES=FREE_BYTES)
class BillingDemoTests(TestCase):
    overview_url = "/api/billing/"
    orders_url = "/api/billing/demo/orders/"
    expire_url = "/api/billing/demo/expire/"
    fixed_now = datetime(2026, 11, 19, 12, 0, tzinfo=datetime_timezone.utc)

    def setUp(self):
        users = get_user_model()
        self.user = users.objects.create_user(username="billing-owner", email="owner@example.test")
        self.other = users.objects.create_user(username="billing-other", email="other@example.test")
        self.client, self.csrf = self.session(self.user)
        self.other_client, self.other_csrf = self.session(self.other)

    def session(self, user=None):
        client = Client(enforce_csrf_checks=True)
        if user is not None:
            client.force_login(user)
        token = client.get("/api/auth/csrf/").json()["csrfToken"]
        return client, token

    def post(self, url, payload, *, client=None, token=None):
        return (client or self.client).post(
            url, data=json.dumps(payload), content_type="application/json",
            HTTP_X_CSRFTOKEN=token or self.csrf, HTTP_ORIGIN="http://testserver",
        )

    def complete_url(self, order_id):
        return f"/api/billing/demo/orders/{order_id}/complete/"

    def create(self):
        response = self.post(self.orders_url, {"plan_code": "premium"})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["order"]

    def complete(self, order_id, outcome="succeeded"):
        return self.post(self.complete_url(order_id), {"outcome": outcome})

    def assert_free(self, user=None):
        entitlement = storage_service.entitlement(user or self.user)
        self.assertEqual(entitlement, {"plan": {"code": "free", "name": "Free"}, "limit_bytes": FREE_BYTES})

    def test_anonymous_access_requires_session_and_mutations_require_csrf(self):
        anonymous, token = self.session()
        self.assertEqual(anonymous.get(self.overview_url).status_code, 401)
        self.assertEqual(self.post(self.orders_url, {"plan_code": "premium"}, client=anonymous, token=token).status_code, 401)
        self.assertEqual(self.client.post(self.orders_url, data='{"plan_code":"premium"}', content_type="application/json").status_code, 403)
        order = self.create()
        self.assertEqual(self.client.post(self.complete_url(order["id"]), data='{"outcome":"succeeded"}', content_type="application/json").status_code, 403)
        self.assertEqual(self.client.post(self.expire_url, data='{}', content_type="application/json").status_code, 403)
        self.assertEqual(Subscription.objects.count(), 0)

    def test_plan_catalog_and_checkout_values_are_owned_by_server(self):
        response = self.client.get(self.overview_url)
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        data = response.json()
        plans = {plan["code"]: plan for plan in data["plans"]}
        self.assertTrue(data["demo_enabled"])
        self.assertEqual(data["subscription"], {"status": "free", "current_period_end": None})
        self.assertEqual(plans["free"]["storage_limit_bytes"], FREE_BYTES)
        self.assertEqual(plans["free"]["amount_vnd"], 0)
        self.assertEqual(plans["premium"]["amount_vnd"], 59000)
        self.assertEqual(plans["premium"]["period_days"], 30)
        self.assertEqual(plans["premium"]["storage_limit_bytes"], PREMIUM_BYTES)
        order = self.create()
        self.assertEqual({key: order[key] for key in ("plan_code", "plan_name", "amount_vnd", "currency", "period_days", "status")}, {
            "plan_code": "premium", "plan_name": "Premium", "amount_vnd": 59000,
            "currency": "VND", "period_days": 30, "status": "pending",
        })
        stored = PaymentOrder.objects.get(pk=order["id"])
        self.assertEqual(stored.storage_limit_bytes, PREMIUM_BYTES)
        self.assertEqual(stored.provider, "demo")
        self.assertNotIn("provider", order)
        self.assertNotIn("owner", order)
        self.assertNotIn("storage_limit_bytes", order)

    def test_client_cannot_supply_price_currency_period_provider_or_entitlement(self):
        extras = {"amount_vnd": 1, "amount": 1, "currency": "USD", "period_days": 365,
                  "provider": "verified", "storage_limit_bytes": 2**63 - 1, "owner_id": self.other.pk}
        for key, value in extras.items():
            with self.subTest(field=key):
                response = self.post(self.orders_url, {"plan_code": "premium", key: value})
                self.assertEqual(response.status_code, 400)
                self.assertIn(key, response.json()["error"]["fields"])
        self.assertEqual(PaymentOrder.objects.count(), 0)
        self.assertEqual(Subscription.objects.count(), 0)
        self.assertEqual(AccountEntitlement.objects.count(), 0)
        order = self.create()
        for key, value in extras.items():
            with self.subTest(completion_field=key):
                response = self.post(self.complete_url(order["id"]), {"outcome": "succeeded", key: value})
                self.assertEqual(response.status_code, 400)
        self.assertEqual(Subscription.objects.count(), 0)

    def test_pending_order_is_reused_and_replaced_only_after_expiry(self):
        with patch("billing.service.timezone.now", return_value=self.fixed_now):
            first = self.create()
            repeated = self.create()
        self.assertEqual(first["id"], repeated["id"])
        self.assertEqual(PaymentOrder.objects.count(), 1)
        self.assert_free()
        order = PaymentOrder.objects.get(pk=first["id"])
        self.assertEqual(order.expires_at, self.fixed_now + timedelta(minutes=15))
        with patch("billing.service.timezone.now", return_value=self.fixed_now + timedelta(minutes=15)):
            fresh = self.create()
        order.refresh_from_db()
        self.assertEqual(order.status, "expired")
        self.assertIsNotNone(order.completed_at)
        self.assertNotEqual(fresh["id"], first["id"])
        self.assertEqual(PaymentOrder.objects.filter(status="pending").count(), 1)
        self.assertEqual(self.complete(first["id"]).status_code, 410)

    def test_failed_or_cancelled_checkout_does_not_grant_premium(self):
        for outcome in ("failed", "cancelled"):
            with self.subTest(outcome=outcome):
                order = self.create()
                response = self.complete(order["id"], outcome)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["order"]["status"], outcome)
                self.assertIsNotNone(response.json()["order"]["completed_at"])
                self.assert_free()
        self.assertEqual(Subscription.objects.count(), 0)
        self.assertEqual(AccountEntitlement.objects.count(), 0)

    def test_success_grants_two_gib_and_replay_never_extends_twice(self):
        with patch("billing.service.timezone.now", return_value=self.fixed_now):
            order = self.create()
            response = self.complete(order["id"])
            self.assertEqual(response.status_code, 200)
            self.assertEqual(storage_service.storage_usage(self.user)["limit_bytes"], PREMIUM_BYTES)
        subscription = Subscription.objects.get(owner=self.user)
        first_end = self.fixed_now + timedelta(days=30)
        self.assertEqual(subscription.current_period_end, first_end)
        completed_at = PaymentOrder.objects.get(pk=order["id"]).completed_at
        with patch("billing.service.timezone.now", return_value=self.fixed_now + timedelta(days=1)):
            replay = self.complete(order["id"])
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["order"]["status"], "succeeded")
        subscription.refresh_from_db()
        self.assertEqual(subscription.current_period_end, first_end)
        self.assertEqual(PaymentOrder.objects.get(pk=order["id"]).completed_at, completed_at)
        self.assertEqual(Subscription.objects.count(), 1)
        self.assertEqual(AccountEntitlement.objects.count(), 0)
        self.assert_free(self.other)

    def test_conflicting_terminal_outcome_is_rejected_without_regranting(self):
        for first, conflicting in (("succeeded", "failed"), ("failed", "succeeded"), ("cancelled", "succeeded")):
            with self.subTest(first=first):
                order = self.create()
                self.assertEqual(self.complete(order["id"], first).status_code, 200)
                period = Subscription.objects.filter(owner=self.user).values_list("current_period_end", flat=True).first()
                response = self.complete(order["id"], conflicting)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()["error"]["code"], "order_finished")
                self.assertEqual(PaymentOrder.objects.get(pk=order["id"]).status, first)
                self.assertEqual(Subscription.objects.filter(owner=self.user).values_list("current_period_end", flat=True).first(), period)

    def test_early_renewal_adds_thirty_days_to_existing_period_end(self):
        with patch("billing.service.timezone.now", return_value=self.fixed_now):
            first = self.create()
            self.assertEqual(self.complete(first["id"]).status_code, 200)
        first_end = Subscription.objects.get(owner=self.user).current_period_end
        with patch("billing.service.timezone.now", return_value=self.fixed_now + timedelta(days=2)):
            renewal = self.create()
            self.assertEqual(self.complete(renewal["id"]).status_code, 200)
        self.assertNotEqual(first["id"], renewal["id"])
        self.assertEqual(Subscription.objects.get(owner=self.user).current_period_end, first_end + timedelta(days=30))

    def test_renewing_an_expired_subscription_starts_from_now(self):
        Subscription.objects.create(owner=self.user, current_period_end=self.fixed_now - timedelta(days=3))
        with patch("billing.service.timezone.now", return_value=self.fixed_now):
            order = self.create()
            self.assertEqual(self.complete(order["id"]).status_code, 200)
        self.assertEqual(Subscription.objects.get(owner=self.user).current_period_end, self.fixed_now + timedelta(days=30))

    def test_expired_pending_checkout_returns_gone_and_never_grants_storage(self):
        with patch("billing.service.timezone.now", return_value=self.fixed_now):
            order = self.create()
        with patch("billing.service.timezone.now", return_value=self.fixed_now + timedelta(minutes=15)):
            response = self.complete(order["id"])
            overview = self.client.get(self.overview_url).json()
        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json()["error"]["code"], "checkout_expired")
        self.assertEqual(overview["orders"][0]["status"], "expired")
        self.assertEqual(Subscription.objects.count(), 0)
        self.assert_free()

    def test_owner_scope_hides_other_users_order_and_subscription(self):
        order = self.create()
        response = self.post(self.complete_url(order["id"]), {"outcome": "succeeded"},
                             client=self.other_client, token=self.other_csrf)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "order_not_found")
        self.assertEqual(PaymentOrder.objects.get(pk=order["id"]).status, "pending")
        self.assertEqual(self.other_client.get(self.overview_url).json()["orders"], [])
        self.assertEqual(self.other_client.get(self.overview_url).json()["subscription"]["status"], "free")
        self.assertEqual(Subscription.objects.count(), 0)

    def test_history_is_limited_to_twenty_newest_owner_orders(self):
        owned = []
        for index in range(25):
            order = PaymentOrder.objects.create(owner=self.user, amount_vnd=59000, status="failed",
                                                expires_at=timezone.now() + timedelta(minutes=15))
            PaymentOrder.objects.filter(pk=order.pk).update(created_at=self.fixed_now + timedelta(seconds=index))
            owned.append(str(order.pk))
        private = PaymentOrder.objects.create(owner=self.other, amount_vnd=59000, status="cancelled",
                                              expires_at=timezone.now() + timedelta(minutes=15))
        response = self.client.get(self.overview_url, {"owner_id": self.other.pk})
        orders = response.json()["orders"]
        self.assertEqual([order["id"] for order in orders], list(reversed(owned))[:20])
        self.assertNotIn(str(private.pk), response.content.decode())
        self.assertNotIn(self.other.email, response.content.decode())
        self.assertEqual([order["id"] for order in self.other_client.get(self.overview_url).json()["orders"]], [str(private.pk)])

    def test_malformed_json_and_non_scalar_fields_return_validation_errors(self):
        raw_bodies = ('"premium"', '[]', 'null', '{"plan_code":', '{"plan_code":[]}', '{"plan_code":{}}')
        for body in raw_bodies:
            with self.subTest(body=body):
                response = self.client.post(self.orders_url, data=body, content_type="application/json", HTTP_X_CSRFTOKEN=self.csrf)
                self.assertEqual(response.status_code, 400, response.content)
        order = self.create()
        for value in ([], {}, None, True, 1, "paid", ["succeeded"]):
            with self.subTest(outcome=value):
                self.assertEqual(self.complete(order["id"], value).status_code, 400)
        for body in ('"succeeded"', '["succeeded"]', '{"outcome":'):
            with self.subTest(body=body):
                response = self.client.post(self.complete_url(order["id"]), data=body,
                                            content_type="application/json", HTTP_X_CSRFTOKEN=self.csrf)
                self.assertEqual(response.status_code, 400)
        self.assertEqual(PaymentOrder.objects.get(pk=order["id"]).status, "pending")
        self.assertEqual(Subscription.objects.count(), 0)

    def test_wrong_methods_and_nonempty_expiry_payload_are_rejected(self):
        for url in (self.orders_url, self.expire_url):
            self.assertEqual(self.client.get(url).status_code, 405)
        self.assertEqual(self.post(self.overview_url, {}).status_code, 405)
        self.assertEqual(self.post(self.expire_url, {"owner_id": self.other.pk}).status_code, 400)
        self.assertEqual(self.post(self.orders_url, {"plan_code": "free"}).status_code, 400)
        self.assertEqual(self.post(self.orders_url, {}).status_code, 400)

    def test_disable_flag_blocks_all_demo_mutations_and_revokes_demo_premium(self):
        order = self.create()
        end = timezone.now() + timedelta(days=20)
        Subscription.objects.create(owner=self.user, current_period_end=end)
        with override_settings(BILLING_DEMO_ENABLED=False):
            for url, payload in ((self.orders_url, {"plan_code": "premium"}),
                                 (self.complete_url(order["id"]), {"outcome": "succeeded"}),
                                 (self.expire_url, {})):
                with self.subTest(url=url):
                    response = self.post(url, payload)
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(response.json()["error"]["code"], "demo_disabled")
            overview = self.client.get(self.overview_url).json()
            self.assertFalse(overview["demo_enabled"])
            self.assertEqual(overview["subscription"]["status"], "expired")
            self.assert_free()
            self.assertEqual(storage_service.storage_usage(self.user)["limit_bytes"], FREE_BYTES)
        self.assertEqual(PaymentOrder.objects.get(pk=order["id"]).status, "pending")
        self.assertEqual(Subscription.objects.get(owner=self.user).current_period_end, end)

    def test_demo_cannot_replace_or_expire_a_future_non_demo_subscription(self):
        order = self.create()
        end = timezone.now() + timedelta(days=60)
        subscription = Subscription.objects.create(owner=self.user, provider="future-gateway", current_period_end=end)
        for url, payload in ((self.orders_url, {"plan_code": "premium"}),
                             (self.complete_url(order["id"]), {"outcome": "succeeded"})):
            with self.subTest(url=url):
                response = self.post(url, payload)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()["error"]["code"], "demo_subscription_conflict")
        self.assertEqual(self.post(self.expire_url, {}).status_code, 409)
        subscription.refresh_from_db()
        self.assertEqual(subscription.provider, "future-gateway")
        self.assertEqual(subscription.current_period_end, end)
        self.assertEqual(PaymentOrder.objects.count(), 1)
        self.assertEqual(PaymentOrder.objects.get(pk=order["id"]).status, "pending")

    def test_free_allowance_data_migration_preserves_unrelated_explicit_overrides(self):
        old_free = AccountEntitlement.objects.create(owner=self.user, storage_limit_bytes=1073741824)
        paid_override = AccountEntitlement.objects.create(owner=self.other, plan_code="team", plan_name="Team", storage_limit_bytes=1073741824)
        custom_owner = get_user_model().objects.create_user(username="billing-custom-free")
        custom_free = AccountEntitlement.objects.create(owner=custom_owner, storage_limit_bytes=PREMIUM_BYTES)
        default_owner = get_user_model().objects.create_user(username="billing-default-free")
        follows_default = AccountEntitlement.objects.create(owner=default_owner, storage_limit_bytes=None)
        migration = import_module("accounts.migrations.0002_free_default_allowance")
        migration.follow_free_default(apps, None)
        old_free.refresh_from_db()
        self.assertIsNone(old_free.storage_limit_bytes)
        self.assertEqual(storage_service.entitlement(self.user)["limit_bytes"], FREE_BYTES)
        paid_override.refresh_from_db()
        custom_free.refresh_from_db()
        follows_default.refresh_from_db()
        self.assertEqual(paid_override.storage_limit_bytes, 1073741824)
        self.assertEqual(paid_override.plan_code, "team")
        self.assertEqual(custom_free.storage_limit_bytes, PREMIUM_BYTES)
        self.assertIsNone(follows_default.storage_limit_bytes)
        migration.follow_free_default(apps, None)
        self.assertEqual(AccountEntitlement.objects.count(), 4)

    def test_time_expiry_changes_quota_without_visiting_account_page(self):
        Subscription.objects.create(owner=self.user, current_period_end=self.fixed_now + timedelta(seconds=1))
        with patch("billing.service.timezone.now", return_value=self.fixed_now):
            self.assertEqual(storage_service.entitlement(self.user)["limit_bytes"], PREMIUM_BYTES)
        with patch("services.storage_service.timezone.now", return_value=self.fixed_now + timedelta(seconds=1)):
            self.assert_free()
            self.assertEqual(storage_service.storage_usage(self.user)["limit_bytes"], FREE_BYTES)
            with self.assertRaises(DatasetError) as caught, storage_service.owner_storage_lock(self.user):
                storage_service.reserve_locked(self.user, target="test-direct-expired-admission",
                                               object_key="test/private-new.csv", size_bytes=FREE_BYTES + 1)
            self.assertEqual(caught.exception.code, "storage_quota_exceeded")

    def test_expiry_preserves_files_and_metadata_and_blocks_growth_when_over_free(self):
        Subscription.objects.create(owner=self.user, current_period_end=timezone.now() + timedelta(days=20))
        # Metadata-sized fixtures exercise quota transitions without allocating huge files.
        dataset = Dataset.objects.create(owner=self.user, filename="source.csv", format="csv",
                                          file="datasets/test-original.csv", size_bytes=FREE_BYTES, sha256="a" * 64)
        run = ETLRun.objects.create(owner=self.user, name="Preserved result", configuration={"steps": []}, sources={},
                                    status="succeeded", result="etl/test-result.parquet", size_bytes=42,
                                    sha256="b" * 64, summary={"final_rows": 2})
        with patch.object(dataset.file.storage, "delete") as delete_object:
            response = self.post(self.expire_url, {})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"expired": True})
            usage = storage_service.storage_usage(self.user)
            self.assertEqual(usage["limit_bytes"], FREE_BYTES)
            self.assertEqual(usage["used_bytes"], FREE_BYTES + 42)
            self.assertTrue(usage["over_limit"])
            self.assertEqual(usage["available_bytes"], 0)
            with self.assertRaises(DatasetError) as caught, storage_service.owner_storage_lock(self.user):
                storage_service.reserve_locked(self.user, target="blocked-growth", object_key="test/new.csv", size_bytes=1)
            self.assertEqual(caught.exception.code, "storage_quota_exceeded")
            self.assertEqual(caught.exception.status, 413)
            delete_object.assert_not_called()
        dataset.refresh_from_db()
        run.refresh_from_db()
        self.assertEqual(dataset.file.name, "datasets/test-original.csv")
        self.assertEqual(run.result.name, "etl/test-result.parquet")
        self.assertEqual(run.status, "succeeded")
        self.assertEqual(run.configuration, {"steps": []})
        self.assertEqual(run.summary, {"final_rows": 2})
        self.assertEqual(StorageReservation.objects.count(), 0)
        self.assert_free()
        self.assertEqual(self.post(self.expire_url, {}).status_code, 409)
