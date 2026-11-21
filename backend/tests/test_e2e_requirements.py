"""Opaque-box end-to-end tests for CloudETL requirements R1-R6 (Tiers 1-4).

All tests drive the application through real HTTP endpoints with CSRF checks
enabled (`Client(enforce_csrf_checks=True)`), real PostgreSQL persistence, and
isolated per-test `FileSystemStorage` `MEDIA_ROOT` directories. Background
worker execution is pumped deterministically via `etl_service.claim_next_run()`
and `etl_service.execute_run()`.
"""
import csv
import io
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings

from etl.models import ETLRun
from services import etl_service


VENDOR_FIXTURE_DIR = Path(__file__).resolve().parents[1] / "vendor" / "etl_tool"
ORIGIN = "http://testserver"
CANONICAL_TYPES = ("string", "integer", "float", "datetime", "boolean")


class OpaqueBoxE2EMixin:
    """Shared opaque-box HTTP harness with isolated storage and CSRF."""

    def setUp(self):
        super().setUp()
        temporary = TemporaryDirectory(prefix="cloudetl-e2e-test-")
        self.addCleanup(temporary.cleanup)
        self.media_root = temporary.name
        override = override_settings(
            MEDIA_ROOT=self.media_root,
            ALLOWED_HOSTS=["testserver"],
            STORAGES={
                "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
            },
        )
        override.enable()
        self.addCleanup(override.disable)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="e2e-owner",
            email="e2e-owner@example.com",
            password="CloudEtlPass!2026",
        )
        self.other = user_model.objects.create_user(
            username="e2e-other",
            email="e2e-other@example.com",
            password="CloudEtlPass!2026",
        )
        self.client = Client(enforce_csrf_checks=True)
        self.client.force_login(self.user)
        self.csrf = self.client.get("/api/auth/csrf/").json()["csrfToken"]

    def make_other_client(self):
        other_client = Client(enforce_csrf_checks=True)
        other_client.force_login(self.other)
        other_csrf = other_client.get("/api/auth/csrf/").json()["csrfToken"]
        return other_client, other_csrf

    def upload_file(self, filename, content=None, client=None, csrf=None):
        if content is None:
            content = (VENDOR_FIXTURE_DIR / filename).read_bytes()
        active_client = client or self.client
        active_csrf = csrf or self.csrf
        upload = SimpleUploadedFile(filename, content, content_type="application/octet-stream")
        response = active_client.post(
            "/api/datasets/",
            {"file": upload},
            HTTP_X_CSRFTOKEN=active_csrf,
            HTTP_ORIGIN=ORIGIN,
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["dataset"]

    def post_json(self, url, payload, client=None, csrf=None):
        active_client = client or self.client
        active_csrf = csrf or self.csrf
        return active_client.post(
            url,
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=active_csrf,
            HTTP_ORIGIN=ORIGIN,
        )

    def put_json(self, url, payload, client=None, csrf=None):
        active_client = client or self.client
        active_csrf = csrf or self.csrf
        return active_client.put(
            url,
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=active_csrf,
            HTTP_ORIGIN=ORIGIN,
        )

    def delete_req(self, url, client=None, csrf=None):
        active_client = client or self.client
        active_csrf = csrf or self.csrf
        return active_client.delete(
            url,
            HTTP_X_CSRFTOKEN=active_csrf,
            HTTP_ORIGIN=ORIGIN,
        )

    def build_config(self, dataset_id, steps, name="E2E Pipeline"):
        return {
            "schemaVersion": 1,
            "name": name,
            "datasetId": dataset_id,
            "steps": steps,
        }

    def run_pipeline(self, payload, expect_status="succeeded"):
        post_resp = self.post_json("/api/etl/runs/", payload)
        self.assertEqual(post_resp.status_code, 202, post_resp.content)
        run_id = post_resp.json()["run"]["id"]
        claimed = etl_service.claim_next_run()
        self.assertIsNotNone(claimed)
        self.assertEqual(str(claimed.pk), run_id)
        etl_service.execute_run(claimed.pk, claimed.claim_token)
        detail_resp = self.client.get(f"/api/etl/runs/{run_id}/")
        self.assertEqual(detail_resp.status_code, 200, detail_resp.content)
        run_data = detail_resp.json()["run"]
        if expect_status is not None:
            self.assertEqual(run_data["status"], expect_status, run_data.get("error"))
        return run_data


class Tier1RequirementTests(OpaqueBoxE2EMixin, TestCase):
    """Tier 1: 18 isolated happy-path & primary contract tests (R1-R6)."""

    def test_t1_r1_b1_run_with_one_enabled_step_succeeds(self):
        ds = self.upload_file("orders_sample.csv")
        payload = self.build_config(
            ds["id"],
            [{"type": "select_columns", "enabled": True, "config": {"selectedColumns": ["order_id", "customer_name"]}}],
        )
        post_resp = self.post_json("/api/etl/runs/", payload)
        self.assertEqual(post_resp.status_code, 202, post_resp.content)
        self.assertEqual(post_resp.json()["run"]["status"], "queued")

        run_id = post_resp.json()["run"]["id"]
        claimed = etl_service.claim_next_run()
        self.assertEqual(str(claimed.pk), run_id)
        etl_service.execute_run(claimed.pk, claimed.claim_token)

        detail = self.client.get(f"/api/etl/runs/{run_id}/").json()["run"]
        self.assertEqual(detail["status"], "succeeded")
        self.assertTrue(detail["result_available"])
        self.assertEqual(detail["summary"]["final_rows"], 5)
        self.assertEqual([col["name"] for col in detail["summary"]["columns"]], ["order_id", "customer_name"])

    def test_t1_r1_b2_save_zero_step_pipeline_draft_allowed(self):
        ds = self.upload_file("orders_sample.csv")
        payload = self.build_config(ds["id"], [], name="Zero-step draft")
        resp = self.post_json("/api/etl/pipelines/", payload)
        self.assertEqual(resp.status_code, 201, resp.content)
        pipeline = resp.json()["pipeline"]
        self.assertEqual(pipeline["step_count"], 0)
        self.assertEqual(pipeline["configuration"]["steps"], [])

        fetched = self.client.get(f"/api/etl/pipelines/{pipeline['id']}/")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["pipeline"]["step_count"], 0)

    def test_t1_r1_b3_run_with_zero_steps_blocked(self):
        ds = self.upload_file("orders_sample.csv")
        resp = self.post_json("/api/etl/runs/", self.build_config(ds["id"], []))
        self.assertEqual(resp.status_code, 400, resp.content)
        err = resp.json()["error"]
        self.assertEqual(err["code"], "invalid_pipeline")
        self.assertIn("steps", err["fields"])
        self.assertTrue(err["fields"]["steps"])
        self.assertEqual(self.client.get("/api/etl/runs/").json()["total_count"], 0)

    def test_t1_r2_b1_orders_sample_mixed_date_detected_as_datetime_in_preview(self):
        ds = self.upload_file("orders_sample.csv")
        resp = self.client.get(f"/api/etl/datasets/{ds['id']}/preview/")
        self.assertEqual(resp.status_code, 200, resp.content)
        cols = {col["name"]: col["type"] for col in resp.json()["preview"]["columns"]}
        self.assertEqual(cols["order_date"], "datetime")

    def test_t1_r2_b2_iso_date_column_detected_as_datetime_in_rows(self):
        csv_bytes = b"id,created_at\n1,2026-01-01\n2,2026-01-02\n"
        ds = self.upload_file("iso_dates.csv", csv_bytes)
        resp = self.client.get(f"/api/etl/datasets/{ds['id']}/rows/")
        self.assertEqual(resp.status_code, 200, resp.content)
        cols = {col["name"]: col["type"] for col in resp.json()["columns"]}
        self.assertEqual(cols["created_at"], "datetime")

    def test_t1_r2_b3_format_datetime_normalizes_orders_sample_dates(self):
        ds = self.upload_file("orders_sample.csv")
        run = self.run_pipeline(
            self.build_config(
                ds["id"],
                [{"type": "format_datetime", "enabled": True, "config": {"column": "order_date", "inputFormat": "auto", "outputFormat": "YYYY-MM-DD"}}],
            )
        )
        rows_resp = self.client.get(f"/api/etl/runs/{run['id']}/rows/")
        self.assertEqual(rows_resp.status_code, 200, rows_resp.content)
        dates = [row["order_date"] for row in rows_resp.json()["rows"]]
        self.assertEqual(len(dates), 5)
        for value in dates:
            self.assertIsInstance(value, str)
            self.assertRegex(value, r"^\d{4}-\d{2}-\d{2}$")
        self.assertEqual(dates[0], "2026-10-01")
        self.assertEqual(dates[3], "2026-10-03")

    def test_t1_r3_b1_capabilities_cast_type_excludes_boolean(self):
        resp = self.client.get("/api/etl/capabilities/")
        self.assertEqual(resp.status_code, 200, resp.content)
        to_types = resp.json()["operations"]["cast_type"]["conversions"][0]["toType"]
        self.assertEqual(to_types, ["str", "int", "float", "date"])
        self.assertNotIn("boolean", to_types)
        self.assertNotIn("bool", to_types)

    def test_t1_r3_b2_cast_type_allowed_targets_succeed(self):
        csv_bytes = b"id,s_int,s_float,s_date,n_str\n1,42,3.14,2026-10-05,99\n2,7,2.5,2026-10-06,100\n"
        ds = self.upload_file("cast_inputs.csv", csv_bytes)
        cases = [
            ("n_str", "str", "99", str, "string"),
            ("s_int", "int", 42, int, "integer"),
            ("s_float", "float", 3.14, float, "float"),
            ("s_date", "date", "2026-10-05", str, "string"),
        ]
        for column, to_type, expected_val, expected_py_type, expected_col_type in cases:
            with self.subTest(to_type=to_type):
                run = self.run_pipeline(
                    self.build_config(
                        ds["id"],
                        [{"type": "cast_type", "enabled": True, "config": {"conversions": [{"column": column, "toType": to_type}]}}],
                        name=f"Cast to {to_type}",
                    )
                )
                rows_data = self.client.get(f"/api/etl/runs/{run['id']}/rows/").json()
                cols = {col["name"]: col["type"] for col in rows_data["columns"]}
                self.assertEqual(cols[column], expected_col_type)
                actual = rows_data["rows"][0][column]
                self.assertIsInstance(actual, expected_py_type)
                self.assertEqual(actual, expected_val)

    def test_t1_r3_b3_cast_type_boolean_rejected_in_runs_and_pipelines(self):
        ds = self.upload_file("flag.csv", b"id,flag\n1,true\n")
        payload = self.build_config(
            ds["id"],
            [{"type": "cast_type", "enabled": True, "config": {"conversions": [{"column": "flag", "toType": "boolean"}]}}],
        )
        run_resp = self.post_json("/api/etl/runs/", payload)
        self.assertEqual(run_resp.status_code, 400, run_resp.content)
        pipe_resp = self.post_json("/api/etl/pipelines/", payload)
        self.assertEqual(pipe_resp.status_code, 400, pipe_resp.content)
        self.assertEqual(self.client.get("/api/etl/runs/").json()["total_count"], 0)
        self.assertEqual(self.client.get("/api/etl/pipelines/").json()["total_count"], 0)

    def test_t1_r4_b1_capabilities_filter_rows_operators_by_type(self):
        resp = self.client.get("/api/etl/capabilities/")
        self.assertEqual(resp.status_code, 200, resp.content)
        operators_by_type = resp.json()["operations"]["filter_rows"]["operatorsByType"]
        expected = {
            "integer": ["equals", "not_equals", "greater_than", "less_than", "greater_or_equal", "less_or_equal"],
            "float": ["equals", "not_equals", "greater_than", "less_than", "greater_or_equal", "less_or_equal"],
            "string": ["equals", "contains", "starts_with", "ends_with"],
            "datetime": ["after", "before", "equals"],
            "boolean": ["is_true", "is_false"],
        }
        self.assertEqual(operators_by_type, expected)

    def test_t1_r4_b2_filter_rows_per_type_happy_paths(self):
        csv_bytes = (
            b"id,qty,city,event_date,active\n"
            b"1,10,Hanoi,2026-01-01,True\n"
            b"2,25,Ho Chi Minh,2026-06-15,False\n"
            b"3,30,Haiphong,2026-10-20,True\n"
        )
        ds = self.upload_file("filter_types.csv", csv_bytes)
        cases = [
            ({"column": "qty", "operator": "greater_than", "value": 20}, [2, 3]),
            ({"column": "city", "operator": "contains", "value": "Ha"}, [1, 3]),
            ({"column": "event_date", "operator": "after", "value": "2026-05-01"}, [2, 3]),
            ({"column": "active", "operator": "is_true"}, [1, 3]),
        ]
        for condition, expected_ids in cases:
            with self.subTest(condition=condition):
                run = self.run_pipeline(
                    self.build_config(
                        ds["id"],
                        [{"type": "filter_rows", "enabled": True, "config": {"conditions": [condition]}}],
                    )
                )
                rows = self.client.get(f"/api/etl/runs/{run['id']}/rows/").json()["rows"]
                self.assertEqual([row["id"] for row in rows], expected_ids)

    def test_t1_r4_b3_filter_rows_equals_on_integer_string_datetime(self):
        csv_bytes = b"id,qty,city,event_date\n1,10,Hanoi,2026-01-01\n2,20,Hue,2026-06-15\n"
        ds = self.upload_file("equals_types.csv", csv_bytes)
        cases = [
            ({"column": "qty", "operator": "equals", "value": 20}, [2]),
            ({"column": "city", "operator": "equals", "value": "Hanoi"}, [1]),
            ({"column": "event_date", "operator": "equals", "value": "2026-06-15"}, [2]),
        ]
        for condition, expected_ids in cases:
            with self.subTest(condition=condition):
                run = self.run_pipeline(
                    self.build_config(
                        ds["id"],
                        [{"type": "filter_rows", "enabled": True, "config": {"conditions": [condition]}}],
                    )
                )
                rows = self.client.get(f"/api/etl/runs/{run['id']}/rows/").json()["rows"]
                self.assertEqual([row["id"] for row in rows], expected_ids)

    def test_t1_r5_b1_dataset_rows_default_pagination_and_headers(self):
        lines = ["id,label"] + [f"{i},item-{i}" for i in range(1, 31)]
        ds = self.upload_file("rows_30.csv", ("\n".join(lines) + "\n").encode("utf-8"))
        resp = self.client.get(f"/api/etl/datasets/{ds['id']}/rows/")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn("no-store", resp["Cache-Control"])
        data = resp.json()
        self.assertEqual(data["page"], 1)
        self.assertEqual(data["page_size"], 25)
        self.assertEqual(data["total_count"], 30)
        self.assertEqual(data["total_pages"], 2)
        self.assertEqual(len(data["rows"]), 25)
        self.assertEqual([c["name"] for c in data["columns"]], ["id", "label"])
        self.assertEqual(data["rows"][0], {"id": 1, "label": "item-1"})
        self.assertEqual(data["rows"][-1], {"id": 25, "label": "item-25"})

    def test_t1_r5_b2_dataset_rows_page_2(self):
        lines = ["id,label"] + [f"{i},item-{i}" for i in range(1, 31)]
        ds = self.upload_file("rows_30_p2.csv", ("\n".join(lines) + "\n").encode("utf-8"))
        resp = self.client.get(f"/api/etl/datasets/{ds['id']}/rows/?page=2&page_size=25")
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data["page"], 2)
        self.assertEqual(data["page_size"], 25)
        self.assertEqual(len(data["rows"]), 5)
        self.assertEqual(data["rows"][0], {"id": 26, "label": "item-26"})
        self.assertEqual(data["rows"][-1], {"id": 30, "label": "item-30"})

    def test_t1_r5_b3_dataset_rows_tsv_upload(self):
        ds = self.upload_file("customers_sample.tsv")
        resp = self.client.get(f"/api/etl/datasets/{ds['id']}/rows/?page=1&page_size=10")
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data["total_count"], 4)
        self.assertEqual(data["total_pages"], 1)
        self.assertEqual(len(data["rows"]), 4)
        self.assertEqual([c["name"] for c in data["columns"]], ["order_id", "customer_phone", "customer_tier"])
        self.assertEqual(data["rows"][0]["order_id"], "ORD01")
        self.assertEqual(data["rows"][0]["customer_tier"], "VIP")

    def test_t1_r6_b1_run_detail_includes_steps_summary_and_safe_sources_meta(self):
        ds = self.upload_file("orders_sample.csv")
        run = self.run_pipeline(
            self.build_config(
                ds["id"],
                [{"type": "select_columns", "enabled": True, "config": {"selectedColumns": ["order_id", "total_amount"]}}],
            )
        )
        self.assertEqual(len(run["configuration"]["steps"]), 1)
        self.assertIsNotNone(run["summary"])
        self.assertIn("sources_meta", run)
        self.assertIn(ds["id"], run["sources_meta"])
        meta = run["sources_meta"][ds["id"]]
        self.assertEqual(meta["id"], ds["id"])
        self.assertEqual(meta["filename"], "orders_sample.csv")
        self.assertEqual(meta["format"], "csv")
        self.assertGreater(meta["size_bytes"], 0)
        self.assertTrue(meta["available"])
        self.assertTrue(meta["matches_snapshot"])
        self.assertTrue(meta["is_primary"])
        self.assertNotIn("key", meta)
        self.assertNotIn("sha256", meta)

    def test_t1_r6_b2_run_source_rows_returns_original_dataset(self):
        ds = self.upload_file("orders_sample.csv")
        run = self.run_pipeline(
            self.build_config(
                ds["id"],
                [{"type": "select_columns", "enabled": True, "config": {"selectedColumns": ["order_id"]}}],
            )
        )
        resp = self.client.get(f"/api/etl/runs/{run['id']}/source-rows/?page=1&page_size=25")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn("no-store", resp["Cache-Control"])
        data = resp.json()
        self.assertEqual(data["dataset_id"], ds["id"])
        self.assertEqual(data["filename"], "orders_sample.csv")
        self.assertEqual(data["total_count"], 5)
        self.assertEqual(len(data["rows"]), 5)
        self.assertTrue(data["matches_snapshot"])
        self.assertEqual(
            [c["name"] for c in data["columns"]],
            ["order_id", "customer_name", "city", "total_amount", "quantity", "is_paid", "order_date"],
        )

    def test_t1_r6_b3_run_rows_returns_canonical_column_types(self):
        csv_bytes = b"id,score,label,created_at,active\n1,9.5,alpha,2026-10-01,True\n"
        ds = self.upload_file("canonical.csv", csv_bytes)
        run = self.run_pipeline(
            self.build_config(
                ds["id"],
                [{"type": "select_columns", "enabled": True, "config": {"selectedColumns": ["id", "score", "label", "created_at", "active"]}}],
            )
        )
        resp = self.client.get(f"/api/etl/runs/{run['id']}/rows/?page=1&page_size=25")
        self.assertEqual(resp.status_code, 200, resp.content)
        columns = resp.json()["columns"]
        for col in columns:
            self.assertIn(col["type"], CANONICAL_TYPES)
        col_types = {col["name"]: col["type"] for col in columns}
        self.assertEqual(col_types["id"], "integer")
        self.assertEqual(col_types["score"], "float")
        self.assertEqual(col_types["label"], "string")
        self.assertEqual(col_types["active"], "boolean")


class Tier2BoundaryAndNegativeTests(OpaqueBoxE2EMixin, TestCase):
    """Tier 2: 22 boundary, negative, authorization, and state-transition tests."""

    def test_t2_r1_b1_run_with_all_disabled_steps_blocked(self):
        ds = self.upload_file("orders_sample.csv")
        payload = self.build_config(
            ds["id"],
            [
                {"type": "select_columns", "enabled": False, "config": {"selectedColumns": ["order_id"]}},
                {"type": "drop_duplicates", "enabled": False, "config": {"rules": [{"allColumns": True, "keep": "first"}]}},
            ],
        )
        resp = self.post_json("/api/etl/runs/", payload)
        self.assertEqual(resp.status_code, 400, resp.content)
        err = resp.json()["error"]
        self.assertEqual(err["code"], "invalid_pipeline")
        self.assertIn("steps", err["fields"])
        self.assertEqual(self.client.get("/api/etl/runs/").json()["total_count"], 0)

    def test_t2_r1_b2_run_with_mixed_disabled_and_enabled_steps_skips_disabled(self):
        ds = self.upload_file("orders_sample.csv")
        payload = self.build_config(
            ds["id"],
            [
                {"type": "select_columns", "enabled": False, "config": {"selectedColumns": ["order_id"]}},
                {"type": "drop_duplicates", "enabled": True, "config": {"rules": [{"allColumns": False, "columns": ["order_id"], "keep": "first"}]}},
            ],
        )
        run = self.run_pipeline(payload)
        rows_data = self.client.get(f"/api/etl/runs/{run['id']}/rows/").json()
        self.assertEqual(rows_data["total_count"], 4)
        self.assertEqual(len(rows_data["columns"]), 7)

    def test_t2_r1_b3_update_saved_pipeline_to_zero_or_all_disabled_steps_allowed(self):
        ds = self.upload_file("orders_sample.csv")
        created = self.post_json(
            "/api/etl/pipelines/",
            self.build_config(
                ds["id"],
                [{"type": "select_columns", "enabled": True, "config": {"selectedColumns": ["order_id"]}}],
                name="Draft v1",
            ),
        )
        self.assertEqual(created.status_code, 201)
        pipeline_id = created.json()["pipeline"]["id"]

        put_empty = self.put_json(
            f"/api/etl/pipelines/{pipeline_id}/",
            self.build_config(ds["id"], [], name="Draft v2"),
        )
        self.assertEqual(put_empty.status_code, 200, put_empty.content)
        self.assertEqual(put_empty.json()["pipeline"]["step_count"], 0)

        put_disabled = self.put_json(
            f"/api/etl/pipelines/{pipeline_id}/",
            self.build_config(
                ds["id"],
                [{"type": "select_columns", "enabled": False, "config": {"selectedColumns": ["order_id"]}}],
                name="Draft v3",
            ),
        )
        self.assertEqual(put_disabled.status_code, 200, put_disabled.content)
        self.assertEqual(put_disabled.json()["pipeline"]["step_count"], 1)

    def test_t2_r1_b4_tampered_zero_step_db_run_fails_in_worker_defense_in_depth(self):
        ds = self.upload_file("orders_sample.csv")
        valid_payload = self.build_config(
            ds["id"],
            [{"type": "select_columns", "enabled": True, "config": {"selectedColumns": ["order_id"]}}],
        )
        post_resp = self.post_json("/api/etl/runs/", valid_payload)
        self.assertEqual(post_resp.status_code, 202)
        run_id = post_resp.json()["run"]["id"]

        # Simulate a tampered/legacy persisted DB run bypassing HTTP validation.
        persisted = ETLRun.objects.get(pk=run_id)
        tampered_config = dict(persisted.configuration)
        tampered_config["steps"] = []
        ETLRun.objects.filter(pk=run_id).update(configuration=tampered_config)

        claimed = etl_service.claim_next_run()
        self.assertEqual(str(claimed.pk), run_id)
        etl_service.execute_run(claimed.pk, claimed.claim_token)

        detail = self.client.get(f"/api/etl/runs/{run_id}/").json()["run"]
        self.assertEqual(detail["status"], "failed")
        self.assertEqual(detail["error"]["code"], "invalid_pipeline")
        self.assertFalse(detail["result_available"])

    def test_t2_r2_b1_non_date_numeric_float_bool_text_never_classified_as_datetime(self):
        csv_bytes = (
            b"int_col,big_int_date,float_col,bool_col,text_col\n"
            b"100,20261001,1.5,True,ORD01\n"
            b"200,20261002,2.5,False,ORD02\n"
        )
        ds = self.upload_file("non_dates.csv", csv_bytes)
        for endpoint in (f"/api/etl/datasets/{ds['id']}/preview/", f"/api/etl/datasets/{ds['id']}/rows/"):
            with self.subTest(endpoint=endpoint):
                resp = self.client.get(endpoint)
                self.assertEqual(resp.status_code, 200, resp.content)
                body = resp.json()
                cols = (body["preview"]["columns"] if "preview" in body else body["columns"])
                col_types = {c["name"]: c["type"] for c in cols}
                self.assertEqual(col_types["int_col"], "integer")
                self.assertEqual(col_types["big_int_date"], "integer")
                self.assertEqual(col_types["float_col"], "float")
                self.assertEqual(col_types["bool_col"], "boolean")
                self.assertEqual(col_types["text_col"], "string")

    def test_t2_r2_b2_sparse_dates_below_threshold_classified_as_string(self):
        csv_bytes = b"id,order_date\n1,2026-10-01\n2,not-a-date\n3,2026-10-03\n4,invalid\n"
        ds = self.upload_file("sparse_dates.csv", csv_bytes)
        preview_cols = {c["name"]: c["type"] for c in self.client.get(f"/api/etl/datasets/{ds['id']}/preview/").json()["preview"]["columns"]}
        rows_cols = {c["name"]: c["type"] for c in self.client.get(f"/api/etl/datasets/{ds['id']}/rows/").json()["columns"]}
        self.assertEqual(preview_cols["order_date"], "string")
        self.assertEqual(rows_cols["order_date"], "string")

    def test_t2_r2_b3_all_empty_date_column_classified_as_string(self):
        csv_bytes = b"id,empty_date,blank_date\n1,, \n2,,  \n3,,\n"
        ds = self.upload_file("empty_dates.csv", csv_bytes)
        preview_cols = {c["name"]: c["type"] for c in self.client.get(f"/api/etl/datasets/{ds['id']}/preview/").json()["preview"]["columns"]}
        rows_cols = {c["name"]: c["type"] for c in self.client.get(f"/api/etl/datasets/{ds['id']}/rows/").json()["columns"]}
        self.assertNotEqual(preview_cols["empty_date"], "datetime")
        self.assertNotEqual(rows_cols["empty_date"], "datetime")
        self.assertEqual(preview_cols["blank_date"], "string")
        self.assertEqual(rows_cols["blank_date"], "string")

    def test_t2_r2_b4_over_50_rows_mixed_dates_detected_as_datetime(self):
        samples = ["2026/10/01", "02-10-2026", "2026-10-03"]
        lines = ["id,event_date"] + [f"{i},{samples[i % 3]}" for i in range(1, 61)]
        ds = self.upload_file("many_mixed_dates.csv", ("\n".join(lines) + "\n").encode("utf-8"))
        preview_cols = {c["name"]: c["type"] for c in self.client.get(f"/api/etl/datasets/{ds['id']}/preview/").json()["preview"]["columns"]}
        rows_cols = {c["name"]: c["type"] for c in self.client.get(f"/api/etl/datasets/{ds['id']}/rows/").json()["columns"]}
        self.assertEqual(preview_cols["event_date"], "datetime")
        self.assertEqual(rows_cols["event_date"], "datetime")

    def test_t2_r3_b1_cast_type_rejects_bool_and_uppercase_boolean(self):
        ds = self.upload_file("flag2.csv", b"id,flag\n1,true\n")
        for bad_type in ("bool", "BOOLEAN", "Boolean"):
            with self.subTest(bad_type=bad_type):
                payload = self.build_config(
                    ds["id"],
                    [{"type": "cast_type", "enabled": True, "config": {"conversions": [{"column": "flag", "toType": bad_type}]}}],
                )
                self.assertEqual(self.post_json("/api/etl/runs/", payload).status_code, 400)
                self.assertEqual(self.post_json("/api/etl/pipelines/", payload).status_code, 400)

    def test_t2_r3_b2_legacy_cast_type_aliases_normalized_and_executable(self):
        ds = self.upload_file("legacy_cast.csv", b"id,a,b,c\n1,10,20,2026-10-01\n")
        payload = self.build_config(
            ds["id"],
            [
                {
                    "type": "cast_type",
                    "enabled": True,
                    "config": {
                        "conversions": [
                            {"column": "a", "toType": "string"},
                            {"column": "b", "toType": "integer"},
                            {"column": "c", "toType": "datetime"},
                        ]
                    },
                }
            ],
        )
        pipe_resp = self.post_json("/api/etl/pipelines/", payload)
        self.assertEqual(pipe_resp.status_code, 201, pipe_resp.content)
        normalized = [c["toType"] for c in pipe_resp.json()["pipeline"]["configuration"]["steps"][0]["config"]["conversions"]]
        self.assertEqual(normalized, ["str", "int", "date"])

        run = self.run_pipeline(payload)
        row = self.client.get(f"/api/etl/runs/{run['id']}/rows/").json()["rows"][0]
        self.assertEqual(row["a"], "10")
        self.assertEqual(row["b"], 20)
        self.assertEqual(row["c"], "2026-10-01")

    def test_t2_r3_b3_cast_type_non_numeric_and_unparseable_dates_safe_no_500(self):
        ds = self.upload_file("dirty_cast.csv", b"id,bad_int,bad_date\n1,abc,nope\n2,,2026-10-05\n")
        run = self.run_pipeline(
            self.build_config(
                ds["id"],
                [
                    {
                        "type": "cast_type",
                        "enabled": True,
                        "config": {
                            "conversions": [
                                {"column": "bad_int", "toType": "int"},
                                {"column": "bad_date", "toType": "date"},
                            ]
                        },
                    }
                ],
            )
        )
        rows = self.client.get(f"/api/etl/runs/{run['id']}/rows/").json()["rows"]
        self.assertEqual(rows[0]["bad_int"], 0)
        self.assertIsNone(rows[0]["bad_date"])
        self.assertEqual(rows[1]["bad_date"], "2026-10-05")

    def _assert_invalid_column_type_filter(self, dataset_id, condition):
        payload = self.build_config(
            dataset_id,
            [{"type": "filter_rows", "enabled": True, "config": {"conditions": [condition]}}],
        )
        post_resp = self.post_json("/api/etl/runs/", payload)
        if post_resp.status_code == 400:
            return
        self.assertEqual(post_resp.status_code, 202, post_resp.content)
        run_id = post_resp.json()["run"]["id"]
        claimed = etl_service.claim_next_run()
        self.assertEqual(str(claimed.pk), run_id)
        etl_service.execute_run(claimed.pk, claimed.claim_token)
        detail = self.client.get(f"/api/etl/runs/{run_id}/").json()["run"]
        self.assertEqual(detail["status"], "failed")
        self.assertEqual(detail["error"]["code"], "invalid_column_type")

    def test_t2_r4_b1_filter_rows_string_ops_rejected_on_integer_and_datetime(self):
        ds = self.upload_file("f_str_err.csv", b"id,qty,event_date\n1,10,2026-10-01\n2,20,2026-10-02\n")
        for condition in (
            {"column": "qty", "operator": "contains", "value": "1"},
            {"column": "qty", "operator": "starts_with", "value": "1"},
            {"column": "event_date", "operator": "ends_with", "value": "01"},
        ):
            with self.subTest(condition=condition):
                self._assert_invalid_column_type_filter(ds["id"], condition)

    def test_t2_r4_b2_filter_rows_numeric_ops_rejected_on_string_bool_datetime(self):
        ds = self.upload_file("f_num_err.csv", b"id,city,active,event_date\n1,Hanoi,True,2026-10-01\n2,Hue,False,2026-10-02\n")
        for condition in (
            {"column": "city", "operator": "greater_than", "value": 5},
            {"column": "active", "operator": "less_than", "value": 1},
            {"column": "event_date", "operator": "not_equals", "value": 5},
        ):
            with self.subTest(condition=condition):
                self._assert_invalid_column_type_filter(ds["id"], condition)

    def test_t2_r4_b3_filter_rows_date_ops_rejected_on_integer_and_plain_string(self):
        ds = self.upload_file("f_date_err.csv", b"id,qty,city\n1,10,Hanoi\n2,20,Hue\n")
        for condition in (
            {"column": "qty", "operator": "after", "value": "2026-01-01"},
            {"column": "city", "operator": "before", "value": "2026-01-01"},
        ):
            with self.subTest(condition=condition):
                self._assert_invalid_column_type_filter(ds["id"], condition)

    def test_t2_r4_b4_filter_rows_boolean_ops_rejected_on_integer_and_non_bool_string(self):
        ds = self.upload_file("f_bool_err.csv", b"id,qty,city\n1,10,Alice\n2,20,Bob\n")
        for condition in (
            {"column": "qty", "operator": "is_true"},
            {"column": "city", "operator": "is_false"},
        ):
            with self.subTest(condition=condition):
                self._assert_invalid_column_type_filter(ds["id"], condition)

    def test_t2_r5_b1_dataset_rows_auth_and_tenant_isolation(self):
        ds = self.upload_file("private_rows.csv", b"id,val\n1,secret\n")
        url = f"/api/etl/datasets/{ds['id']}/rows/"

        anonymous = Client(enforce_csrf_checks=True)
        self.assertEqual(anonymous.get(url).status_code, 401)

        other_client, _ = self.make_other_client()
        self.assertEqual(other_client.get(url).status_code, 404)

    def test_t2_r5_b2_dataset_rows_invalid_pagination_params_rejected(self):
        ds = self.upload_file("page_err.csv", b"id,val\n1,a\n2,b\n")
        base = f"/api/etl/datasets/{ds['id']}/rows/"
        for query in ("page_size=0", "page_size=15", "page_size=200", "page_size=abc", "page=0", "page=-1", "page=99", "unknown=1"):
            with self.subTest(query=query):
                resp = self.client.get(f"{base}?{query}")
                self.assertEqual(resp.status_code, 400, resp.content)
                self.assertIn("error", resp.json())
                if query.startswith("page"):
                    self.assertEqual(resp.json()["error"]["code"], "invalid_page")

    def test_t2_r5_b3_dataset_rows_120_rows_page_size_100_and_no_secret_leak(self):
        lines = ["id,name"] + [f"{i},n{i}" for i in range(1, 121)]
        ds = self.upload_file("rows_120.csv", ("\n".join(lines) + "\n").encode("utf-8"))

        p1 = self.client.get(f"/api/etl/datasets/{ds['id']}/rows/?page=1&page_size=100")
        self.assertEqual(p1.status_code, 200, p1.content)
        p1_data = p1.json()
        self.assertEqual(len(p1_data["rows"]), 100)
        self.assertEqual(p1_data["total_count"], 120)
        self.assertEqual(p1_data["total_pages"], 2)
        self.assertEqual(p1_data["rows"][0]["id"], 1)
        self.assertEqual(p1_data["rows"][-1]["id"], 100)

        p2 = self.client.get(f"/api/etl/datasets/{ds['id']}/rows/?page=2&page_size=100")
        self.assertEqual(p2.status_code, 200, p2.content)
        p2_data = p2.json()
        self.assertEqual(len(p2_data["rows"]), 20)
        self.assertEqual(p2_data["rows"][0]["id"], 101)
        self.assertEqual(p2_data["rows"][-1]["id"], 120)

        raw = p1.content.decode("utf-8")
        self.assertNotIn(f"datasets/{self.user.pk}/", raw)
        self.assertNotIn("sha256", raw)

    def test_t2_r5_b4_dataset_upload_rejects_blank_duplicate_and_overlong_headers(self):
        bad_files = [
            ("blank_hdr.csv", b"id,,name\n1,x,a\n"),
            ("dup_hdr.csv", b"id,id\n1,2\n"),
            ("long_hdr.csv", f"id,{'x' * 256}\n1,2\n".encode("utf-8")),
        ]
        for filename, content in bad_files:
            with self.subTest(filename=filename):
                upload = SimpleUploadedFile(filename, content, content_type="application/octet-stream")
                resp = self.client.post(
                    "/api/datasets/",
                    {"file": upload},
                    HTTP_X_CSRFTOKEN=self.csrf,
                    HTTP_ORIGIN=ORIGIN,
                )
                self.assertEqual(resp.status_code, 400, resp.content)

    def test_t2_r6_b1_run_source_rows_auth_isolation_and_foreign_dataset_id(self):
        ds1 = self.upload_file("src1.csv", b"id,val\n1,a\n")
        ds2 = self.upload_file("src2.csv", b"id,val\n2,b\n")
        other_client, other_csrf = self.make_other_client()
        other_ds = self.upload_file("other.csv", b"id,val\n3,c\n", client=other_client, csrf=other_csrf)

        run = self.run_pipeline(
            self.build_config(ds1["id"], [{"type": "select_columns", "enabled": True, "config": {"selectedColumns": ["id"]}}])
        )
        base_url = f"/api/etl/runs/{run['id']}/source-rows/"

        self.assertEqual(Client(enforce_csrf_checks=True).get(base_url).status_code, 401)
        self.assertEqual(other_client.get(base_url).status_code, 404)
        self.assertEqual(self.client.get(f"{base_url}?dataset_id={ds2['id']}").status_code, 404)
        self.assertEqual(self.client.get(f"{base_url}?dataset_id={other_ds['id']}").status_code, 404)

    def test_t2_r6_b2_run_source_rows_after_original_dataset_deleted(self):
        ds = self.upload_file("orders_sample.csv")
        run = self.run_pipeline(
            self.build_config(ds["id"], [{"type": "select_columns", "enabled": True, "config": {"selectedColumns": ["order_id"]}}])
        )
        del_resp = self.delete_req(f"/api/datasets/{ds['id']}/")
        self.assertEqual(del_resp.status_code, 200, del_resp.content)

        detail = self.client.get(f"/api/etl/runs/{run['id']}/")
        self.assertEqual(detail.status_code, 200)
        self.assertFalse(detail.json()["run"]["sources_meta"][ds["id"]]["available"])

        src_rows = self.client.get(f"/api/etl/runs/{run['id']}/source-rows/")
        self.assertEqual(src_rows.status_code, 404)
        self.assertEqual(src_rows.json()["error"]["code"], "dataset_not_found")

        # Result rows remain readable.
        self.assertEqual(self.client.get(f"/api/etl/runs/{run['id']}/rows/").status_code, 200)

    def test_t2_r6_b3_run_source_rows_after_original_dataset_replaced(self):
        ds = self.upload_file("orders_sample.csv")
        run = self.run_pipeline(
            self.build_config(ds["id"], [{"type": "select_columns", "enabled": True, "config": {"selectedColumns": ["order_id"]}}])
        )
        replacement = SimpleUploadedFile("orders_v2.csv", b"order_id,extra\nNEW1,x\n", content_type="application/octet-stream")
        rep_resp = self.client.post(
            f"/api/datasets/{ds['id']}/replace/",
            {"file": replacement},
            HTTP_X_CSRFTOKEN=self.csrf,
            HTTP_ORIGIN=ORIGIN,
        )
        self.assertEqual(rep_resp.status_code, 200, rep_resp.content)

        detail = self.client.get(f"/api/etl/runs/{run['id']}/")
        self.assertEqual(detail.status_code, 200)
        meta = detail.json()["run"]["sources_meta"][ds["id"]]
        self.assertTrue(meta["available"])
        self.assertFalse(meta["matches_snapshot"])

        src_rows = self.client.get(f"/api/etl/runs/{run['id']}/source-rows/")
        self.assertEqual(src_rows.status_code, 409)
        self.assertEqual(src_rows.json()["error"]["code"], "source_modified")

        self.assertEqual(self.client.get(f"/api/etl/runs/{run['id']}/rows/").status_code, 200)


class Tier3CrossFeatureWorkflowTests(OpaqueBoxE2EMixin, TestCase):
    """Tier 3: 4 cross-feature workflow combinations."""

    def test_t3_1_r5_r2_r1_review_mixed_dates_block_zero_steps_then_format_iso8601(self):
        csv_bytes = b"id,order_date\n1,2026/10/01\n2,02-10-2026\n3,2026-10-03\n"
        ds = self.upload_file("t3_1_dates.csv", csv_bytes)

        rows_resp = self.client.get(f"/api/etl/datasets/{ds['id']}/rows/")
        self.assertEqual(rows_resp.status_code, 200)
        cols = {c["name"]: c["type"] for c in rows_resp.json()["columns"]}
        self.assertEqual(cols["order_date"], "datetime")
        self.assertEqual(len(rows_resp.json()["rows"]), 3)

        blocked = self.post_json("/api/etl/runs/", self.build_config(ds["id"], []))
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(blocked.json()["error"]["code"], "invalid_pipeline")

        run = self.run_pipeline(
            self.build_config(
                ds["id"],
                [{"type": "format_datetime", "enabled": True, "config": {"column": "order_date", "inputFormat": "auto", "outputFormat": "ISO_8601"}}],
            )
        )
        res_rows = self.client.get(f"/api/etl/runs/{run['id']}/rows/").json()["rows"]
        self.assertEqual(len(res_rows), 3)
        for row in res_rows:
            self.assertRegex(row["order_date"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")

    def test_t3_2_r3_r2_cast_string_to_date_then_format_datetime(self):
        csv_bytes = b"id,event_day\n1,01 Oct 2026\n2,02 Oct 2026\n"
        ds = self.upload_file("t3_2_cast_date.csv", csv_bytes)
        run = self.run_pipeline(
            self.build_config(
                ds["id"],
                [
                    {"type": "cast_type", "enabled": True, "config": {"conversions": [{"column": "event_day", "toType": "date"}]}},
                    {"type": "format_datetime", "enabled": True, "config": {"column": "event_day", "inputFormat": "auto", "outputFormat": "YYYY-MM-DD HH:mm:ss"}},
                ],
            )
        )
        res_rows = self.client.get(f"/api/etl/runs/{run['id']}/rows/").json()["rows"]
        self.assertEqual([r["event_day"] for r in res_rows], ["2026-10-01 00:00:00", "2026-10-02 00:00:00"])

    def test_t3_3_r3_r4_cast_string_to_int_and_date_then_filter_rows(self):
        csv_bytes = (
            b"id,price,dt\n"
            b"1,1500,05 Oct 2026\n"
            b"2,800,02 Oct 2026\n"
            b"3,2000,25 Sep 2026\n"
            b"4,free,10 Oct 2026\n"
        )
        ds = self.upload_file("t3_3_cast_filter.csv", csv_bytes)
        run = self.run_pipeline(
            self.build_config(
                ds["id"],
                [
                    {
                        "type": "cast_type",
                        "enabled": True,
                        "config": {
                            "conversions": [
                                {"column": "price", "toType": "int"},
                                {"column": "dt", "toType": "date"},
                            ]
                        },
                    },
                    {
                        "type": "filter_rows",
                        "enabled": True,
                        "config": {
                            "conditions": [
                                {"column": "price", "operator": "greater_or_equal", "value": 1000},
                                {"column": "dt", "operator": "after", "value": "2026-10-01"},
                            ]
                        },
                    },
                ],
            )
        )
        rows_data = self.client.get(f"/api/etl/runs/{run['id']}/rows/").json()
        col_types = {c["name"]: c["type"] for c in rows_data["columns"]}
        self.assertEqual(col_types["price"], "integer")
        self.assertEqual(rows_data["total_count"], 1)
        self.assertEqual(rows_data["rows"][0]["id"], 1)
        self.assertEqual(rows_data["rows"][0]["price"], 1500)
        self.assertEqual(rows_data["rows"][0]["dt"], "2026-10-05")

    def test_t3_4_r4_r6_multisource_join_filter_and_source_rows(self):
        orders = self.upload_file("orders_sample.csv")
        customers = self.upload_file("customers_sample.tsv")
        run = self.run_pipeline(
            self.build_config(
                orders["id"],
                [
                    {"type": "join", "enabled": True, "config": {"datasetId": customers["id"], "on": "order_id", "how": "inner"}},
                    {
                        "type": "filter_rows",
                        "enabled": True,
                        "config": {
                            "conditions": [
                                {"column": "customer_tier", "operator": "equals", "value": "VIP"},
                                {"column": "total_amount", "operator": "greater_or_equal", "value": 500000},
                            ]
                        },
                    },
                ],
                name="VIP Orders Join",
            )
        )
        meta = run["sources_meta"]
        self.assertEqual(set(meta.keys()), {orders["id"], customers["id"]})
        self.assertTrue(meta[orders["id"]]["is_primary"])
        self.assertFalse(meta[customers["id"]]["is_primary"])
        for entry in meta.values():
            self.assertNotIn("key", entry)
            self.assertNotIn("sha256", entry)

        src_orders = self.client.get(f"/api/etl/runs/{run['id']}/source-rows/?dataset_id={orders['id']}").json()
        src_customers = self.client.get(f"/api/etl/runs/{run['id']}/source-rows/?dataset_id={customers['id']}").json()
        self.assertEqual(src_orders["total_count"], 5)
        self.assertEqual(src_customers["total_count"], 4)

        res_rows = self.client.get(f"/api/etl/runs/{run['id']}/rows/").json()["rows"]
        self.assertEqual(len(res_rows), 3)
        self.assertTrue(all(r["customer_tier"] == "VIP" and r["total_amount"] >= 500000 for r in res_rows))


class Tier4RealWorldScenarioTests(OpaqueBoxE2EMixin, TestCase):
    """Tier 4: 3 realistic multi-feature CloudETL application scenarios."""

    def test_t4_1_ecommerce_orders_cleaning_and_reconciliation(self):
        ds = self.upload_file("orders_sample.csv")

        review = self.client.get(f"/api/etl/datasets/{ds['id']}/rows/")
        self.assertEqual(review.status_code, 200)
        self.assertEqual(review.json()["total_count"], 5)
        self.assertEqual({c["name"]: c["type"] for c in review.json()["columns"]}["order_date"], "datetime")

        # 0-step pipeline blocked before configuring real cleaning steps.
        self.assertEqual(self.post_json("/api/etl/runs/", self.build_config(ds["id"], [])).status_code, 400)

        steps = [
            {"type": "drop_duplicates", "enabled": True, "config": {"rules": [{"allColumns": False, "columns": ["order_id"], "keep": "first"}]}},
            {"type": "handle_null", "enabled": True, "config": {"rules": [{"column": "customer_name", "strategy": "drop"}]}},
            {"type": "format_datetime", "enabled": True, "config": {"column": "order_date", "inputFormat": "auto", "outputFormat": "YYYY-MM-DD"}},
            {
                "type": "filter_rows",
                "enabled": True,
                "config": {
                    "conditions": [
                        {"column": "total_amount", "operator": "greater_or_equal", "value": 800000},
                        {"column": "is_paid", "operator": "is_true"},
                    ]
                },
            },
            {"type": "select_columns", "enabled": True, "config": {"selectedColumns": ["order_id", "customer_name", "total_amount", "order_date"]}},
        ]
        run = self.run_pipeline(self.build_config(ds["id"], steps, name="E-Commerce Reconciliation"))

        self.assertEqual(len(run["configuration"]["steps"]), 5)
        self.assertEqual(run["summary"]["initial_rows"], 5)
        self.assertEqual(run["summary"]["final_rows"], 1)
        self.assertEqual(run["summary"]["dropped_rows"], 4)
        self.assertTrue(run["sources_meta"][ds["id"]]["matches_snapshot"])

        source_rows = self.client.get(f"/api/etl/runs/{run['id']}/source-rows/").json()
        self.assertEqual(source_rows["total_count"], 5)

        result_rows = self.client.get(f"/api/etl/runs/{run['id']}/rows/").json()["rows"]
        self.assertEqual(len(result_rows), 1)
        self.assertEqual(result_rows[0]["order_id"], "ORD01")
        self.assertEqual(result_rows[0]["customer_name"], "Nguyen Van A")
        self.assertEqual(result_rows[0]["total_amount"], 1500000.0)
        self.assertEqual(result_rows[0]["order_date"], "2026-10-01")

        for fmt, delim in (("csv", ","), ("tsv", "\t")):
            dl = self.client.get(f"/api/etl/runs/{run['id']}/download/?format={fmt}")
            self.assertEqual(dl.status_code, 200)
            parsed = list(csv.DictReader(io.StringIO(dl.content.decode("utf-8-sig")), delimiter=delim))
            self.assertEqual(len(parsed), 1)
            self.assertEqual(parsed[0]["order_id"], "ORD01")
            self.assertEqual(parsed[0]["customer_name"], "Nguyen Van A")
            self.assertEqual(float(parsed[0]["total_amount"]), 1500000.0)
            self.assertEqual(parsed[0]["order_date"], "2026-10-01")

    def test_t4_2_customer_loyalty_tsv_normalization_and_casting(self):
        tsv_rows = [
            "member_id\ttier\tpoints_str\tsignup_raw\tactive_flag",
            "M01\t  gold \t150\t15 Jan 2025\tTrue",
            "M02\t silver \t80\t20 Feb 2025\tTrue",
            "M03\tBRONZE  \t220\t01 Jun 2024\tTrue",
            "M04\t  gold\t300\t10 Mar 2025\tTrue",
            "M05\t silver\t100\t05 Apr 2025\tFalse",
            "M06\tbronze\t50\t12 May 2025\tTrue",
            "M07\t  platinum \t500\t18 Jun 2025\tTrue",
            "M08\tgold  \t120\t22 Jul 2025\tTrue",
            "M09\t silver\t95\t11 Aug 2025\tTrue",
            "M10\tgold\tN/A\t19 Sep 2025\tTrue",
            "M11\t  bronze\t180\t25 Oct 2025\tTrue",
            "M12\tSilver\t400\t01 Nov 2025\tTrue",
            "M13\tGOLD\t60\t14 Dec 2025\tFalse",
            "M14\t  silver \t250\t02 Jan 2026\tTrue",
            "M15\tbronze  \t110\t01 Jan 2025\tTrue",
        ]
        # Rows passing (points_str >= 100 AND signup_raw > 2025-01-01):
        # M01 (150, 2025-01-15), M04 (300, 2025-03-10), M05 (100, 2025-04-05),
        # M07 (500, 2025-06-18), M08 (120, 2025-07-22), M11 (180, 2025-10-25),
        # M12 (400, 2025-11-01), M14 (250, 2026-01-02) -> 8 rows.
        ds = self.upload_file("loyalty.tsv", ("\n".join(tsv_rows) + "\n").encode("utf-8"))

        review = self.client.get(f"/api/etl/datasets/{ds['id']}/rows/?page=1&page_size=25").json()
        self.assertEqual(review["total_count"], 15)

        bad_cast = self.build_config(
            ds["id"],
            [{"type": "cast_type", "enabled": True, "config": {"conversions": [{"column": "active_flag", "toType": "boolean"}]}}],
        )
        self.assertEqual(self.post_json("/api/etl/runs/", bad_cast).status_code, 400)

        steps = [
            {"type": "string_transform", "enabled": True, "config": {"rules": [{"column": "tier", "trim": True, "caseMode": "upper"}]}},
            {
                "type": "cast_type",
                "enabled": True,
                "config": {
                    "conversions": [
                        {"column": "points_str", "toType": "int"},
                        {"column": "signup_raw", "toType": "date"},
                    ]
                },
            },
            {"type": "format_datetime", "enabled": True, "config": {"column": "signup_raw", "inputFormat": "auto", "outputFormat": "ISO_8601"}},
            {
                "type": "filter_rows",
                "enabled": True,
                "config": {
                    "conditions": [
                        {"column": "points_str", "operator": "greater_or_equal", "value": 100},
                        {"column": "signup_raw", "operator": "after", "value": "2025-01-01"},
                    ]
                },
            },
        ]
        run = self.run_pipeline(self.build_config(ds["id"], steps, name="Loyalty TSV Normalization"))

        source_rows = self.client.get(f"/api/etl/runs/{run['id']}/source-rows/").json()
        self.assertEqual(source_rows["total_count"], 15)

        result_data = self.client.get(f"/api/etl/runs/{run['id']}/rows/").json()
        col_types = {c["name"]: c["type"] for c in result_data["columns"]}
        self.assertEqual(col_types["points_str"], "integer")
        self.assertEqual(col_types["tier"], "string")
        self.assertEqual(result_data["total_count"], 8)
        self.assertEqual(
            [r["member_id"] for r in result_data["rows"]],
            ["M01", "M04", "M05", "M07", "M08", "M11", "M12", "M14"],
        )
        for row in result_data["rows"]:
            self.assertEqual(row["tier"], row["tier"].strip().upper())
            self.assertRegex(row["signup_raw"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")

        tsv_dl = self.client.get(f"/api/etl/runs/{run['id']}/download/?format=tsv")
        self.assertEqual(tsv_dl.status_code, 200)
        tsv_lines = tsv_dl.content.decode("utf-8-sig").strip().splitlines()
        self.assertEqual(len(tsv_lines), 9)
        self.assertIn("\t", tsv_lines[0])

    def test_t4_3_large_paginated_dataset_upload_review_execution_and_comparison(self):
        lines = ["id,category,score,event_date"]
        for i in range(1, 121):
            day = ((i - 1) % 28) + 1
            lines.append(f"{i},cat-{i % 4},{i},2026-10-{day:02d}")
        ds = self.upload_file("large_120.csv", ("\n".join(lines) + "\n").encode("utf-8"))

        for page_size, expected_pages in ((25, 5), (50, 3)):
            collected = []
            for page in range(1, expected_pages + 1):
                resp = self.client.get(f"/api/etl/datasets/{ds['id']}/rows/?page={page}&page_size={page_size}")
                self.assertEqual(resp.status_code, 200, resp.content)
                payload = resp.json()
                self.assertEqual(payload["total_count"], 120)
                self.assertEqual(payload["total_pages"], expected_pages)
                collected.extend(row["id"] for row in payload["rows"])
            self.assertEqual(collected, list(range(1, 121)))

        steps = [
            {"type": "cast_type", "enabled": True, "config": {"conversions": [{"column": "id", "toType": "int"}, {"column": "score", "toType": "int"}]}},
            {"type": "filter_rows", "enabled": True, "config": {"conditions": [{"column": "score", "operator": "greater_or_equal", "value": 50}]}},
            {"type": "format_datetime", "enabled": True, "config": {"column": "event_date", "inputFormat": "auto", "outputFormat": "YYYY-MM-DD"}},
        ]
        run = self.run_pipeline(self.build_config(ds["id"], steps, name="Large Paginated Pipeline"))
        self.assertEqual(run["summary"]["initial_rows"], 120)
        self.assertEqual(run["summary"]["final_rows"], 71)

        source_ids_seen = []
        for page in range(1, 4):
            s_resp = self.client.get(f"/api/etl/runs/{run['id']}/source-rows/?page={page}&page_size=50")
            self.assertEqual(s_resp.status_code, 200, s_resp.content)
            self.assertEqual(s_resp.json()["total_count"], 120)
            source_ids_seen.extend(r["id"] for r in s_resp.json()["rows"])
        self.assertEqual(source_ids_seen, list(range(1, 121)))

        result_ids_seen = []
        for page in range(1, 4):
            r_resp = self.client.get(f"/api/etl/runs/{run['id']}/rows/?page={page}&page_size=25")
            self.assertEqual(r_resp.status_code, 200, r_resp.content)
            self.assertEqual(r_resp.json()["total_count"], 71)
            result_ids_seen.extend(r["id"] for r in r_resp.json()["rows"])
        self.assertEqual(result_ids_seen, list(range(50, 121)))

        csv_dl = self.client.get(f"/api/etl/runs/{run['id']}/download/?format=csv")
        self.assertEqual(csv_dl.status_code, 200)
        csv_lines = csv_dl.content.decode("utf-8-sig").strip().splitlines()
        self.assertEqual(len(csv_lines), 72)
