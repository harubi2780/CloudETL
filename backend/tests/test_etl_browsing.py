import hashlib
import io
from unittest.mock import patch

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

from datasets.models import Dataset
from etl.models import ETLRun
from tests.test_etl_api import ETLSetupMixin


class ETLBrowsingTests(ETLSetupMixin, TestCase):
    def completed(self, frame):
        buffer = io.BytesIO()
        pq.write_table(pa.Table.from_pandas(frame, preserve_index=False), buffer, row_group_size=10)
        content = buffer.getvalue()
        run = ETLRun.objects.create(owner=self.user, name="Browse result", configuration=self.payload(), sources={},
                                    status="succeeded", size_bytes=len(content), sha256=hashlib.sha256(content).hexdigest(),
                                    summary={"final_rows": len(frame), "columns": [{"name": name} for name in frame.columns]})
        run.result.save("result.parquet", ContentFile(content), save=True)
        return run

    def test_history_is_owner_scoped_filtered_and_paginated(self):
        for index in range(22):
            ETLRun.objects.create(owner=self.user, name=f"Run {index}", configuration=self.payload(), sources={})
        ETLRun.objects.create(owner=self.other, name="Private other run", configuration={}, sources={})
        response = self.client.get("/api/etl/runs/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total_count"], 22)
        self.assertEqual(len(response.json()["runs"]), 20)
        page2 = self.client.get("/api/etl/runs/?page=2").json()
        self.assertEqual(len(page2["runs"]), 2)
        self.assertNotEqual(page2["runs"][0]["id"], response.json()["runs"][0]["id"])
        run = self.completed(pd.DataFrame({"value": [1]}))
        listing = self.client.get("/api/etl/runs/?status=succeeded").json()
        self.assertEqual(listing["total_count"], 1)
        self.assertEqual(listing["runs"][0]["id"], str(run.pk))
        self.assertNotIn("configuration", listing["runs"][0])
        self.assertNotIn("rows", listing["runs"][0]["summary"])
        self.assertNotIn(run.result.name, str(listing))

    def test_detail_exposes_only_owned_configuration_and_source_metadata(self):
        run = self.process()
        response = self.client.get(f"/api/etl/runs/{run.pk}/")
        self.assertEqual(response.json()["run"]["configuration"], self.payload() | {"schemaVersion": 1})
        source = self.client.get(f"/api/etl/datasets/{self.dataset.pk}/")
        self.assertEqual(source.json()["dataset"]["id"], str(self.dataset.pk))
        self.assertNotIn("file", source.json()["dataset"])
        self.client.force_login(self.other)
        for url in (f"/api/etl/runs/{run.pk}/", f"/api/etl/datasets/{self.dataset.pk}/", f"/api/etl/runs/{run.pk}/rows/"):
            self.assertEqual(self.client.get(url).status_code, 404)

    def test_rows_preserve_order_and_boundaries_across_parquet_groups(self):
        run = self.completed(pd.DataFrame({"id": range(127), "text": [f"row-{i}" for i in range(127)]}))
        url = f"/api/etl/runs/{run.pk}/rows/"
        for size in (25, 50, 100):
            all_rows = []
            page_count = (127 + size - 1) // size
            with patch("services.etl_service.adapter.read_result") as read_whole:
                for page in range(1, page_count + 1):
                    response = self.client.get(url, {"page": page, "page_size": size})
                    self.assertEqual(response.status_code, 200, response.content)
                    data = response.json()
                    self.assertLessEqual(len(data["rows"]), size)
                    self.assertEqual(data["total_count"], 127)
                    self.assertEqual(data["total_pages"], page_count)
                    self.assertIn("no-store", response["Cache-Control"])
                    all_rows.extend(data["rows"])
                read_whole.assert_not_called()
            self.assertEqual([row["id"] for row in all_rows], list(range(127)))
            self.assertEqual(self.client.get(url, {"page": page_count + 1, "page_size": size}).status_code, 400)
        # A full download still includes every row, independent of viewed page.
        csv_lines = self.client.get(f"/api/etl/runs/{run.pk}/download/?format=csv").content.decode("utf-8").strip().splitlines()
        self.assertEqual(len(csv_lines), 128)

    def test_rows_empty_result_and_scalar_fidelity(self):
        empty = self.completed(pd.DataFrame({"id": pd.Series([], dtype="int64")}))
        data = self.client.get(f"/api/etl/runs/{empty.pk}/rows/").json()
        self.assertEqual((data["rows"], data["total_count"], data["total_pages"]), ([], 0, 1))
        self.assertEqual(data["columns"][0]["name"], "id")
        self.assertEqual(data["columns"][0]["type"], "integer")
        run = self.completed(pd.DataFrame({
            "text": ["", None],
            "flag": [False, True],
            "number": [0, 1],
            "price": [1.5, 2.5],
            "when": pd.to_datetime(["2026-10-01", "2026-10-02"]),
        }))
        rows_data = self.client.get(f"/api/etl/runs/{run.pk}/rows/").json()
        col_types = {col["name"]: col["type"] for col in rows_data["columns"]}
        self.assertEqual(col_types, {
            "text": "string",
            "flag": "boolean",
            "number": "integer",
            "price": "float",
            "when": "datetime",
        })
        rows = rows_data["rows"]
        self.assertEqual(rows[0]["text"], "")
        self.assertIsNone(rows[1]["text"])
        self.assertEqual([row["flag"] for row in rows], [False, True])
        self.assertEqual([row["number"] for row in rows], [0, 1])

    def test_invalid_query_and_not_ready_are_structured(self):
        run = self.process()
        base = f"/api/etl/runs/{run.pk}/rows/"
        for query in ("page=0", "page=-1", "page=1.5", "page=99999999999", "page_size=10", "page_size=0", "page=1&page=2", "unknown=1"):
            response = self.client.get(base + "?" + query)
            self.assertEqual(response.status_code, 400, query)
            self.assertIn("error", response.json())
        for query in ("status=invalid", "page=0", "status=queued&status=running", "owner=2", "page=999"):
            self.assertEqual(self.client.get("/api/etl/runs/?" + query).status_code, 400)
        ETLRun.objects.filter(pk=run.pk).update(status="running")
        self.assertEqual(self.client.get(base).status_code, 409)
        self.client.logout()
        self.assertEqual(self.client.get(base).status_code, 401)
        self.assertEqual(self.client.get("/api/etl/runs/").status_code, 401)

    def test_corrupt_result_is_not_paged(self):
        run = self.completed(pd.DataFrame({"id": [1]}))
        with run.result.storage.open(run.result.name, "wb") as target:
            target.write(b"corrupt")
        response = self.client.get(f"/api/etl/runs/{run.pk}/rows/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "result_corrupt")

    def test_dataset_rows_pagination_types_and_isolation(self):
        # Paginated dataset rows for multi-row CSV
        lines = ["id,name,when"] + [f"{i},row-{i},2026-10-{(i % 28) + 1:02d}" for i in range(27)]
        big = self.upload("big.csv", ("\n".join(lines) + "\n").encode("utf-8"))
        url = f"/api/etl/datasets/{big.pk}/rows/"
        default_page = self.client.get(url)
        self.assertEqual(default_page.status_code, 200, default_page.content)
        self.assertIn("no-store", default_page["Cache-Control"])
        default_data = default_page.json()
        self.assertEqual((default_data["page"], default_data["page_size"], default_data["total_count"], default_data["total_pages"]), (1, 25, 27, 2))
        self.assertEqual(len(default_data["rows"]), 25)

        for size in (10, 25, 50, 100):
            all_rows = []
            page_count = (27 + size - 1) // size
            for page in range(1, page_count + 1):
                resp = self.client.get(url, {"page": page, "page_size": size})
                self.assertEqual(resp.status_code, 200, resp.content)
                all_rows.extend(resp.json()["rows"])
            self.assertEqual([row["id"] for row in all_rows], list(range(27)))

        # Column types match /preview/ including order_date -> datetime
        orders_rows = self.client.get(f"/api/etl/datasets/{self.dataset.pk}/rows/").json()
        orders_preview = self.client.get(f"/api/etl/datasets/{self.dataset.pk}/preview/").json()["preview"]
        self.assertEqual(orders_rows["columns"], orders_preview["columns"])
        self.assertEqual({col["name"]: col["type"] for col in orders_rows["columns"]}["order_date"], "datetime")

        # Empty header-only CSV
        empty = self.upload("empty_rows.csv", b"a,b\n")
        empty_data = self.client.get(f"/api/etl/datasets/{empty.pk}/rows/").json()
        self.assertEqual((empty_data["rows"], empty_data["total_count"], empty_data["total_pages"]), ([], 0, 1))

        # Validation & unsupported format errors
        for query in ("page=0", "page=-1", "page=99", "page_size=15", "page_size=200", "unknown=1", "page=1&page=2"):
            self.assertEqual(self.client.get(f"{url}?{query}").status_code, 400, query)
        self.assertEqual(self.client.post(url, HTTP_X_CSRFTOKEN=self.csrf).status_code, 405)

        legacy = Dataset.objects.create(
            owner=self.user, filename="legacy.json", format="json",
            file=f"datasets/{self.user.pk}/legacy.json", size_bytes=10, sha256="a" * 64,
        )
        self.assertEqual(self.client.get(f"/api/etl/datasets/{legacy.pk}/rows/").status_code, 400)

        # Auth & cross-owner isolation
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(Client().get(url).status_code, 401)

    def test_run_detail_sources_meta_and_source_rows_comparison(self):
        customers = self.upload("customers_sample.tsv")
        steps = [
            {"type": "join", "config": {"datasetId": str(customers.pk), "on": "order_id", "how": "left"}},
            {"type": "select_columns", "config": {"selectedColumns": ["order_id", "city", "customer_tier"]}},
        ]
        run = self.process(self.payload(steps))
        detail = self.client.get(f"/api/etl/runs/{run.pk}/").json()["run"]
        self.assertIn("sources_meta", detail)
        sources_meta = detail["sources_meta"]
        self.assertEqual(set(sources_meta.keys()), {str(self.dataset.pk), str(customers.pk)})
        primary_meta = sources_meta[str(self.dataset.pk)]
        secondary_meta = sources_meta[str(customers.pk)]
        self.assertEqual(primary_meta["filename"], "orders_sample.csv")
        self.assertTrue(primary_meta["available"])
        self.assertTrue(primary_meta["matches_snapshot"])
        self.assertTrue(primary_meta["is_primary"])
        self.assertEqual(secondary_meta["filename"], "customers_sample.tsv")
        self.assertFalse(secondary_meta["is_primary"])
        # Never expose storage key or sha256
        for meta in sources_meta.values():
            self.assertNotIn("key", meta)
            self.assertNotIn("sha256", meta)
        self.assertNotIn(self.dataset.sha256, str(detail))
        self.assertNotIn(self.dataset.file.name, str(detail))

        # Default primary source-rows & secondary source-rows
        src_url = f"/api/etl/runs/{run.pk}/source-rows/"
        primary_resp = self.client.get(src_url, {"page": 1, "page_size": 10})
        self.assertEqual(primary_resp.status_code, 200, primary_resp.content)
        self.assertIn("no-store", primary_resp["Cache-Control"])
        primary_data = primary_resp.json()
        self.assertEqual(primary_data["dataset_id"], str(self.dataset.pk))
        self.assertEqual(primary_data["filename"], "orders_sample.csv")
        self.assertEqual(primary_data["total_count"], 5)
        self.assertTrue(primary_data["matches_snapshot"])

        secondary_resp = self.client.get(src_url, {"dataset_id": str(customers.pk), "page_size": 10})
        self.assertEqual(secondary_resp.status_code, 200, secondary_resp.content)
        self.assertEqual(secondary_resp.json()["filename"], "customers_sample.tsv")
        self.assertEqual(secondary_resp.json()["total_count"], 4)

        # Still works even after result is deleted
        self.assertEqual(self.client.delete(f"/api/etl/runs/{run.pk}/result/", HTTP_X_CSRFTOKEN=self.csrf).status_code, 200)
        self.assertEqual(self.client.get(src_url).status_code, 200)

        # Invalid dataset_id or unrelated dataset -> 404 dataset_not_found
        other_ds = self.upload("extra.csv", b"id\n1\n")
        for bad_id in ("not-a-uuid", str(other_ds.pk)):
            resp = self.client.get(src_url, {"dataset_id": bad_id})
            self.assertEqual(resp.status_code, 404)
            self.assertEqual(resp.json()["error"]["code"], "dataset_not_found")

        # Invalid pagination -> 400
        for query in ("page=0", "page=99", "page_size=15", "unknown=1"):
            self.assertEqual(self.client.get(f"{src_url}?{query}").status_code, 400, query)

        # Cross-owner & anonymous -> 404 / 401
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(src_url).status_code, 404)
        self.assertEqual(Client().get(src_url).status_code, 401)
        self.client.force_login(self.user)

        # Replaced source dataset -> matches_snapshot=False in sources_meta, 409 source_modified on source-rows
        replace_resp = self.client.post(
            f"/api/datasets/{self.dataset.pk}/replace/",
            {"file": SimpleUploadedFile("orders_v2.csv", b"order_id,city\nORD99,DN\n")},
            HTTP_X_CSRFTOKEN=self.csrf,
        )
        self.assertEqual(replace_resp.status_code, 200)
        detail_after_replace = self.client.get(f"/api/etl/runs/{run.pk}/").json()["run"]
        self.assertTrue(detail_after_replace["sources_meta"][str(self.dataset.pk)]["available"])
        self.assertFalse(detail_after_replace["sources_meta"][str(self.dataset.pk)]["matches_snapshot"])
        modified_resp = self.client.get(src_url)
        self.assertEqual(modified_resp.status_code, 409)
        self.assertEqual(modified_resp.json()["error"]["code"], "source_modified")

        # Deleted source dataset -> available=False, matches_snapshot=False in sources_meta, 404 dataset_not_found on source-rows
        customers_id = str(customers.pk)
        customers.delete()
        detail_after_delete = self.client.get(f"/api/etl/runs/{run.pk}/").json()["run"]
        self.assertFalse(detail_after_delete["sources_meta"][customers_id]["available"])
        self.assertFalse(detail_after_delete["sources_meta"][customers_id]["matches_snapshot"])
        deleted_resp = self.client.get(src_url, {"dataset_id": customers_id})
        self.assertEqual(deleted_resp.status_code, 404)
        self.assertEqual(deleted_resp.json()["error"]["code"], "dataset_not_found")
