import hashlib
import io
import json
import os
import subprocess
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import openpyxl
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connection
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from datasets.models import Dataset
from etl.models import ETLRun
from services import etl_service
from services.dataset_service import upload_dataset


class ETLSetupMixin:
    def setUp(self):
        super().setUp()
        temporary = TemporaryDirectory(prefix="cloudetl-etl-test-")
        self.addCleanup(temporary.cleanup)
        self.media_root = temporary.name
        override = override_settings(MEDIA_ROOT=temporary.name, ALLOWED_HOSTS=["testserver"], STORAGES={
            "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
            "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
        })
        override.enable()
        self.addCleanup(override.disable)
        self.user = get_user_model().objects.create_user(username="etl-owner")
        self.other = get_user_model().objects.create_user(username="etl-other")
        self.client = Client(enforce_csrf_checks=True)
        self.client.force_login(self.user)
        self.csrf = self.client.get("/api/auth/csrf/").json()["csrfToken"]
        self.dataset = self.upload("orders_sample.csv")

    def upload(self, filename, content=None, owner=None):
        if content is None:
            content = (Path(__file__).resolve().parents[1] / "vendor" / "etl_tool" / filename).read_bytes()
        data = upload_dataset(owner or self.user, SimpleUploadedFile(filename, content))
        return Dataset.objects.get(pk=data["id"])

    def payload(self, steps=None):
        return {"name": "Sample cleaning", "datasetId": str(self.dataset.pk), "steps": steps or []}

    def post(self, payload):
        return self.client.post("/api/etl/runs/", data=json.dumps(payload), content_type="application/json",
                                HTTP_X_CSRFTOKEN=self.csrf, HTTP_ORIGIN="http://testserver")

    def process(self, payload=None):
        response = self.post(payload or self.payload())
        self.assertEqual(response.status_code, 202, response.content)
        run = etl_service.claim_next_run()
        self.assertIsNotNone(run)
        etl_service.execute_run(run.pk, run.claim_token)
        run.refresh_from_db()
        return run


class ETLApiTests(ETLSetupMixin, TestCase):
    def test_capabilities_and_preview(self):
        response = self.client.get("/api/etl/capabilities/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["operations"]), 10)
        self.assertIn("no-store", response["Cache-Control"])
        response = self.client.get(f"/api/etl/datasets/{self.dataset.pk}/preview/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["preview"]["final_rows"], 5)
        self.assertNotIn(self.dataset.file.name, response.content.decode())
        self.assertNotIn(b"NaN", response.content)

    def test_submit_returns_queued_without_execution_and_hides_storage_keys(self):
        with patch("services.etl_service.adapter.extract_dataset") as extract:
            response = self.post(self.payload())
        self.assertEqual(response.status_code, 202, response.content)
        self.assertEqual(response.json()["run"]["status"], "queued")
        extract.assert_not_called()
        self.assertEqual(ETLRun.objects.count(), 1)
        self.assertNotIn(self.dataset.file.name, response.content.decode())

    def test_successful_join_cleaning_and_all_download_formats(self):
        customers = self.upload("customers_sample.tsv")
        steps = [
            {"type": "join", "config": {"datasetId": str(customers.pk), "on": "order_id", "how": "left"}},
            {"type": "drop_duplicates", "config": {"rules": [{"columns": ["order_id"], "keep": "first"}]}},
            {"type": "handle_null", "config": {"rules": [{"column": "total_amount", "strategy": "mean"}]}},
            {"type": "replace_value", "config": {"column": "city", "oldValue": "Hồ Chí Minh", "newValue": "HCM"}},
            {"type": "select_columns", "config": {"selectedColumns": ["order_id", "city", "customer_tier", "total_amount", "customer_phone"]}},
        ]
        run = self.process(self.payload(steps))
        self.assertEqual(run.status, "succeeded", run.error_message)
        self.assertEqual(run.summary["final_rows"], 4)
        self.assertEqual(run.summary["rows"][1]["total_amount"], 933333.33)
        self.assertTrue(run.result.name.startswith(f"etl/{self.user.pk}/{run.pk}/"))
        self.assertEqual(self.dataset.sha256, hashlib.sha256(self.dataset.file.read()).hexdigest())
        url = f"/api/etl/runs/{run.pk}/download/"
        for extension in ("parquet", "csv", "tsv", "json", "xlsx"):
            with self.subTest(extension=extension):
                response = self.client.get(url, {"format": extension})
                self.assertEqual(response.status_code, 200, response.content[:200])
                self.assertIn("attachment", response["Content-Disposition"])
                self.assertIn("no-store", response["Cache-Control"])
                if extension == "parquet":
                    self.assertTrue(response.content.startswith(b"PAR1"))
                elif extension == "json":
                    self.assertEqual(len(response.json()), 4)
                elif extension == "xlsx":
                    workbook = openpyxl.load_workbook(io.BytesIO(response.content), read_only=True)
                    self.assertEqual(len(list(workbook.active.rows)), 5)
                    workbook.close()
                else:
                    expected = (Path(__file__).resolve().parents[1] / "vendor" / "etl_tool" / "ket_qua_lam_sach.csv").read_text(encoding="utf-8-sig")
                    actual = response.content.decode("utf-8").replace("\r\n", "\n")
                    self.assertEqual(actual, expected if extension == "csv" else expected.replace(",", "\t"))

    def test_session_csrf_and_http_methods(self):
        anonymous = Client()
        for url in ("/api/etl/capabilities/", f"/api/etl/datasets/{self.dataset.pk}/preview/"):
            self.assertEqual(anonymous.get(url).status_code, 401)
        self.assertEqual(anonymous.post("/api/etl/runs/", self.payload(), content_type="application/json").status_code, 401)
        self.assertEqual(self.client.post("/api/etl/runs/", self.payload(), content_type="application/json").status_code, 403)
        self.assertEqual(self.client.patch("/api/etl/runs/", HTTP_X_CSRFTOKEN=self.csrf).status_code, 405)

    def test_cross_owner_input_preview_run_and_download_are_hidden(self):
        private = self.upload("private.csv", b"id,value\n1,secret\n", owner=self.other)
        payload = self.payload()
        payload["datasetId"] = str(private.pk)
        self.assertEqual(self.post(payload).status_code, 404)
        self.assertEqual(self.client.get(f"/api/etl/datasets/{private.pk}/preview/").status_code, 404)
        for operation, config in (("join", {"datasetId": str(private.pk), "on": "id"}), ("concat", {"datasetIds": [str(private.pk)]})):
            with self.subTest(operation=operation):
                self.assertEqual(self.post(self.payload([{"type": operation, "config": config}])).status_code, 404)
        run = self.process()
        self.client.force_login(self.other)
        for suffix in ("", "download/"):
            self.assertEqual(self.client.get(f"/api/etl/runs/{run.pk}/{suffix}").status_code, 404)

    def test_input_replacement_or_deletion_fails_queued_run(self):
        for action in ("replacement", "deletion"):
            with self.subTest(action=action):
                dataset = self.upload("input.csv", b"id,value\n1,2\n")
                payload = self.payload()
                payload["datasetId"] = str(dataset.pk)
                self.assertEqual(self.post(payload).status_code, 202)
                if action == "replacement":
                    dataset.sha256 = "a" * 64
                    dataset.save(update_fields=["sha256"])
                else:
                    dataset.delete()
                run = etl_service.claim_next_run()
                etl_service.execute_run(run.pk, run.claim_token)
                run.refresh_from_db()
                self.assertEqual(run.status, "failed")
                self.assertIn(run.error_code, ("input_changed", "dataset_not_found"))
                self.assertFalse(run.result)

    def test_actual_storage_bytes_are_integrity_checked(self):
        self.assertEqual(self.post(self.payload()).status_code, 202)
        with self.dataset.file.storage.open(self.dataset.file.name, "wb") as target:
            target.write(b"id,value\n1,tampered\n")
        run = etl_service.claim_next_run()
        etl_service.execute_run(run.pk, run.claim_token)
        run.refresh_from_db()
        self.assertEqual(run.error_code, "input_changed")

    def test_invalid_requests_and_unsupported_options(self):
        for payload in ([], {"name": "x"}, {**self.payload(), "path": "/etc/passwd"},
                        self.payload([{"type": "cast_type", "config": {"conversions": [{"column": "is_paid", "toType": "boolean"}]}}])):
            with self.subTest(payload=payload):
                self.assertEqual(self.post(payload).status_code, 400)
        response = self.client.post("/api/etl/runs/", data='{"name":', content_type="application/json", HTTP_X_CSRFTOKEN=self.csrf)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(ETLRun.objects.count(), 0)

    def test_non_tabular_supported_upload_is_rejected_by_etl(self):
        dataset = self.upload("input.json", b'[{"id":1}]')
        payload = self.payload()
        payload["datasetId"] = str(dataset.pk)
        self.assertEqual(self.post(payload).json()["error"]["code"], "unsupported_input")

    def test_unknown_column_fails_with_safe_error(self):
        run = self.process(self.payload([{"type": "select_columns", "config": {"selectedColumns": ["missing"]}}]))
        self.assertEqual(run.status, "failed")
        self.assertEqual(run.error_code, "invalid_column")
        self.assertNotIn("Traceback", run.error_message)

    def test_queue_limit_and_download_not_ready(self):
        for _ in range(10):
            response = self.post(self.payload())
            self.assertEqual(response.status_code, 202)
        self.assertEqual(self.post(self.payload()).status_code, 429)
        run_id = response.json()["run"]["id"]
        self.assertEqual(self.client.get(f"/api/etl/runs/{run_id}/download/").status_code, 409)

    def test_export_errors_and_tampered_result(self):
        run = self.process()
        url = f"/api/etl/runs/{run.pk}/download/"
        self.assertEqual(self.client.get(url, {"format": "exe"}).status_code, 400)
        self.assertEqual(self.client.get(url + "?format=csv&format=json").status_code, 400)
        with run.result.storage.open(run.result.name, "wb") as target:
            target.write(b"corrupt")
        response = self.client.get(url)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "result_corrupt")

    def test_storage_failure_has_no_local_fallback(self):
        self.assertEqual(self.post(self.payload()).status_code, 202)
        run = etl_service.claim_next_run()
        storage = ETLRun._meta.get_field("result").storage
        before = {str(path) for path in Path(self.media_root).rglob("*") if path.is_file()}
        with patch.object(storage, "save", side_effect=RuntimeError("private-storage-secret")), self.assertLogs("services.etl_service", level="ERROR"):
            etl_service.execute_run(run.pk, run.claim_token)
        run.refresh_from_db()
        self.assertEqual(run.status, "failed")
        self.assertEqual(run.error_code, "execution_failed")
        self.assertNotIn("private-storage-secret", run.error_message)
        self.assertEqual(before, {str(path) for path in Path(self.media_root).rglob("*") if path.is_file()})

    def test_wrong_token_does_not_execute_and_success_is_not_repeated(self):
        self.assertEqual(self.post(self.payload()).status_code, 202)
        run = etl_service.claim_next_run()
        etl_service.execute_run(run.pk, "00000000-0000-0000-0000-000000000000")
        run.refresh_from_db()
        self.assertEqual(run.status, "running")
        etl_service.execute_run(run.pk, run.claim_token)
        run.refresh_from_db()
        self.assertEqual(run.status, "succeeded")
        with patch("services.etl_service.adapter.extract_dataset") as extract:
            etl_service.execute_run(run.pk, run.claim_token)
            extract.assert_not_called()

    def test_stale_publication_cleans_only_new_output(self):
        self.assertEqual(self.post(self.payload()).status_code, 202)
        run = etl_service.claim_next_run()
        storage = ETLRun._meta.get_field("result").storage
        original_save = storage.save
        def stale_save(*args, **kwargs):
            name = original_save(*args, **kwargs)
            etl_service.fail_run(run.pk, run.claim_token, "worker_interrupted", "Worker interrupted.")
            return name
        with patch.object(storage, "save", side_effect=stale_save):
            etl_service.execute_run(run.pk, run.claim_token)
        run.refresh_from_db()
        self.assertEqual(run.status, "failed")
        self.assertFalse(list(Path(self.media_root).glob("etl/**/*.parquet")))
        self.assertTrue(self.dataset.file.storage.exists(self.dataset.file.name))


class ETLWorkerProcessTests(ETLSetupMixin, TransactionTestCase):
    def test_worker_timeout_and_stale_job_recovery(self):
        self.assertEqual(self.post(self.payload()).status_code, 202)
        with patch("etl.management.commands.run_etl_worker.subprocess.run", side_effect=subprocess.TimeoutExpired("test", 300)):
            call_command("run_etl_worker", once=True)
        run = ETLRun.objects.get()
        self.assertEqual(run.error_code, "execution_timeout")
        ETLRun.objects.filter(pk=run.pk).update(status="running", started_at=timezone.now() - timedelta(hours=2))
        self.assertEqual(etl_service.expire_stale_runs(), 1)
        run.refresh_from_db()
        self.assertEqual(run.error_code, "worker_interrupted")
        self.assertEqual(etl_service.fail_run(run.pk, run.claim_token, "x", "x"), 0)

    def test_real_worker_subprocess(self):
        self.assertEqual(self.post(self.payload()).status_code, 202)
        with patch.dict(os.environ, {"DJANGO_SETTINGS_MODULE": "config.test_settings",
                                    "ETL_TEST_DB_NAME": connection.settings_dict["NAME"],
                                    "ETL_TEST_MEDIA_ROOT": self.media_root}):
            call_command("run_etl_worker", once=True)
        run = ETLRun.objects.get()
        self.assertEqual(run.status, "succeeded", run.error_message)
        self.assertEqual(run.summary["final_rows"], 5)
        self.assertTrue(run.result.storage.exists(run.result.name))
