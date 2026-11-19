"""Account profile and quota metadata checks; no object storage I/O is needed."""
import os
import runpy
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured
from django.test import Client, SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from accounts.models import AccountEntitlement, StorageReservation
from datasets.errors import DatasetError
from datasets.models import Dataset
from etl.models import ETLRun
from services import storage_service


class AccountStorageSettingsTests(SimpleTestCase):
    def load_settings(self, value=None, billing_demo=None):
        environment = {
            "DJANGO_SECRET_KEY": "isolated-settings-check",
            "POSTGRES_DB": "settings_test", "POSTGRES_APP_USER": "settings_test",
            "POSTGRES_APP_PASSWORD": "isolated-settings-test-only",
            "DATASET_STORAGE_BACKEND": "filesystem",
        }
        if value is not None:
            environment["ACCOUNT_STORAGE_LIMIT_BYTES"] = value
        if billing_demo is not None:
            environment["BILLING_DEMO_ENABLED"] = billing_demo
        path = Path(__file__).resolve().parents[1] / "config" / "settings.py"
        # Do not read the user's .env or use any real application credentials.
        with patch.dict(os.environ, environment, clear=True), patch("dotenv.load_dotenv"):
            return runpy.run_path(str(path))

    def test_default_allowance_is_500_mib_and_account_billing_apps_are_installed(self):
        values = self.load_settings()
        self.assertEqual(values["ACCOUNT_STORAGE_LIMIT_BYTES"], 524288000)
        self.assertIn("accounts.apps.AccountsConfig", values["INSTALLED_APPS"])
        self.assertIn("billing.apps.BillingConfig", values["INSTALLED_APPS"])
        self.assertFalse(values["BILLING_DEMO_ENABLED"])

    def test_billing_demo_requires_an_explicit_valid_boolean_setting(self):
        self.assertTrue(self.load_settings(billing_demo="true")["BILLING_DEMO_ENABLED"])
        self.assertFalse(self.load_settings(billing_demo="false")["BILLING_DEMO_ENABLED"])
        with self.assertRaisesMessage(ImproperlyConfigured, "BILLING_DEMO_ENABLED"):
            self.load_settings(billing_demo="enabled")

    def test_explicit_allowance_accepts_both_signed_bigint_boundaries(self):
        for value in ("1", "2147483648", str(2**63 - 1)):
            with self.subTest(value=value):
                self.assertEqual(self.load_settings(value)["ACCOUNT_STORAGE_LIMIT_BYTES"], int(value))

    def test_invalid_allowances_fail_with_configuration_error(self):
        for value in ("", "0", "-1", "1.5", "NaN", "not-an-integer", str(2**63)):
            with self.subTest(value=value):
                with self.assertRaisesMessage(ImproperlyConfigured, "ACCOUNT_STORAGE_LIMIT_BYTES"):
                    self.load_settings(value)


# Deliberately exercise an explicit 1 GiB override independently of the Free default.
@override_settings(ALLOWED_HOSTS=["testserver"], ACCOUNT_STORAGE_LIMIT_BYTES=1073741824)
class AccountProfileTests(TestCase):
    endpoint = "/api/account/"

    def setUp(self):
        users = get_user_model()
        self.user = users.objects.create_user(username="account-owner", email="owner@example.test", password="test-only-password")
        self.other = users.objects.create_user(username="account-other", email="other@example.test")
        self.client.force_login(self.user)

    def dataset(self, size, owner=None):
        return Dataset.objects.create(owner=owner or self.user, filename="source.csv", format="csv",
                                      file=f"datasets/private-{size}.csv", size_bytes=size, sha256="a" * 64)

    def result(self, size, owner=None, status=ETLRun.Status.SUCCEEDED, has_file=True):
        return ETLRun.objects.create(owner=owner or self.user, name="Private pipeline", configuration={}, sources={},
                                     status=status, result=f"etl/private-{size}.parquet" if has_file else "", size_bytes=size)

    def reservation(self, size, reserved, state=StorageReservation.State.WRITING, owner=None):
        return StorageReservation.objects.create(owner=owner or self.user, target=f"test-{size}-{state}",
                                                  object_key=f"private/object-{size}", size_bytes=size,
                                                  reserved_bytes=reserved, state=state)

    def test_profile_requires_a_session_and_preserves_the_auth_url_namespace(self):
        response = Client().get(self.endpoint)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "authentication_required")
        self.assertEqual(reverse("account-profile"), self.endpoint)
        self.assertEqual(reverse("accounts:me"), "/api/auth/me/")

    def test_empty_account_has_one_gib_available_without_creating_an_entitlement(self):
        response = self.client.get(self.endpoint)
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        account = response.json()["account"]
        self.assertEqual(set(account), {"id", "username", "email", "status", "joined_at", "plan", "storage"})
        self.assertEqual(account["id"], self.user.pk)
        self.assertEqual(account["username"], self.user.username)
        self.assertEqual(account["email"], self.user.email)
        self.assertEqual(account["status"], "active")
        self.assertEqual(account["joined_at"], self.user.date_joined.isoformat())
        self.assertEqual(account["plan"], {"code": "free", "name": "Free"})
        self.assertEqual(account["storage"], {
            "limit_bytes": 1073741824, "used_bytes": 0, "uploaded_bytes": 0, "result_bytes": 0,
            "pending_cleanup_bytes": 0, "reserved_bytes": 0, "available_bytes": 1073741824, "over_limit": False,
        })
        self.assertEqual(AccountEntitlement.objects.count(), 0)
        self.assertEqual(StorageReservation.objects.count(), 0)

    def test_legacy_uploads_results_and_pending_bytes_are_counted_only_for_current_owner(self):
        first = self.dataset(100)
        self.dataset(200)
        self.dataset(4000, owner=self.other)
        result = self.result(500)
        self.result(25, status=ETLRun.Status.FAILED)
        self.result(7000, has_file=False, status=ETLRun.Status.QUEUED)
        self.result(8000, owner=self.other)
        cleanup = self.reservation(15, 0, state=StorageReservation.State.CLEANUP)
        writing = self.reservation(40, 12)
        self.reservation(5000, 5000, owner=self.other)
        response = self.client.get(self.endpoint, {"owner_id": self.other.pk})
        self.assertEqual(response.status_code, 200)
        account = response.json()["account"]
        self.assertEqual(account["id"], self.user.pk)
        self.assertEqual(account["storage"], {
            "limit_bytes": 1073741824, "uploaded_bytes": 300, "result_bytes": 525,
            "pending_cleanup_bytes": 15, "used_bytes": 840, "reserved_bytes": 12,
            "available_bytes": 1073741824 - 852, "over_limit": False,
        })
        for private in (first.file.name, first.sha256, result.result.name, cleanup.object_key, writing.object_key,
                        self.user.password, self.other.username, self.other.email):
            self.assertNotIn(private, response.content.decode())
        self.client.force_login(self.other)
        other = self.client.get(self.endpoint).json()["account"]
        self.assertEqual(other["storage"]["uploaded_bytes"], 4000)
        self.assertEqual(other["storage"]["result_bytes"], 8000)
        self.assertEqual(other["storage"]["reserved_bytes"], 5000)

    def test_profile_is_read_only_and_never_accepts_client_plan_or_quota_updates(self):
        for method in ("post", "put", "patch", "delete"):
            with self.subTest(method=method):
                response = getattr(self.client, method)(self.endpoint, data='{"plan":"paid","limit_bytes":9999999999}', content_type="application/json")
                self.assertEqual(response.status_code, 405)
                self.assertEqual(response["Allow"], "GET")
        self.assertEqual(AccountEntitlement.objects.count(), 0)
        self.assertEqual(StorageReservation.objects.count(), 0)

    def test_profile_database_failure_is_sanitized(self):
        from django.db import DatabaseError
        with patch("accounts.views.usage_locked", side_effect=DatabaseError("private-database-secret")), self.assertLogs("accounts.views", level="ERROR"):
            response = self.client.get(self.endpoint)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "account_unavailable")
        self.assertNotIn("private-database-secret", response.content.decode())

    def test_internal_entitlement_extension_changes_the_allowance_and_public_plan(self):
        self.dataset(100)
        record = storage_service.set_storage_entitlement(self.user, limit_bytes=2 * 1073741824,
                                                         plan_code="team", plan_name="Team")
        self.assertEqual(record.owner, self.user)
        self.assertEqual(AccountEntitlement.objects.count(), 1)
        account = self.client.get(self.endpoint).json()["account"]
        self.assertEqual(account["plan"], {"code": "team", "name": "Team"})
        self.assertEqual(account["storage"]["limit_bytes"], 2 * 1073741824)
        self.assertEqual(account["storage"]["available_bytes"], 2 * 1073741824 - 100)
        self.assertEqual(storage_service.entitlement(self.other)["limit_bytes"], 1073741824)

    def test_null_entitlement_allowance_follows_configured_default(self):
        AccountEntitlement.objects.create(owner=self.user, plan_code="trial", plan_name="Trial", storage_limit_bytes=None)
        with override_settings(ACCOUNT_STORAGE_LIMIT_BYTES=500):
            account = self.client.get(self.endpoint).json()["account"]
        self.assertEqual(account["plan"], {"code": "trial", "name": "Trial"})
        self.assertEqual(account["storage"]["limit_bytes"], 500)

    def test_lowering_allowance_below_usage_preserves_data_and_prevents_growth(self):
        dataset = self.dataset(500)
        result = self.result(100)
        storage_service.set_storage_entitlement(self.user, limit_bytes=200)
        account = self.client.get(self.endpoint).json()["account"]
        self.assertEqual(account["storage"]["used_bytes"], 600)
        self.assertEqual(account["storage"]["available_bytes"], 0)
        self.assertTrue(account["storage"]["over_limit"])
        self.assertTrue(Dataset.objects.filter(pk=dataset.pk, size_bytes=500).exists())
        self.assertTrue(ETLRun.objects.filter(pk=result.pk, size_bytes=100).exists())
        with self.assertRaises(DatasetError) as caught:
            with storage_service.owner_storage_lock(self.user):
                storage_service.reserve_locked(self.user, target="upload:new", object_key="private/new.csv", size_bytes=1)
        self.assertEqual(caught.exception.code, "storage_quota_exceeded")
        self.assertEqual(caught.exception.status, 413)
        with storage_service.owner_storage_lock(self.user):
            reservation = storage_service.reserve_locked(self.user, target=f"dataset:{dataset.pk}",
                                                           object_key="private/replacement.csv", size_bytes=300, credit_bytes=500)
        self.assertEqual(reservation.reserved_bytes, 0)

    def test_invalid_internal_entitlements_are_rejected_without_mutation(self):
        for limit in (0, -1, True, 1.5, "100", 2**63):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                storage_service.set_storage_entitlement(self.user, limit_bytes=limit)
        for changes in ({"plan_code": "unsafe/name"}, {"plan_name": " "}, {"plan_name": "x" * 81}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                storage_service.set_storage_entitlement(self.user, limit_bytes=100, **changes)
        self.assertFalse(AccountEntitlement.objects.exists())
