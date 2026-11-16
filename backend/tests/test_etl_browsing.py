import hashlib
import io
from unittest.mock import patch

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from django.core.files.base import ContentFile
from django.test import TestCase

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
        self.assertEqual(len(self.client.get(f"/api/etl/runs/{run.pk}/download/?format=json").json()), 127)

    def test_rows_empty_result_and_scalar_fidelity(self):
        empty = self.completed(pd.DataFrame({"id": pd.Series([], dtype="int64")}))
        data = self.client.get(f"/api/etl/runs/{empty.pk}/rows/").json()
        self.assertEqual((data["rows"], data["total_count"], data["total_pages"]), ([], 0, 1))
        self.assertEqual(data["columns"][0]["name"], "id")
        run = self.completed(pd.DataFrame({"text": ["", None], "flag": [False, True], "number": [0, 1]}))
        rows = self.client.get(f"/api/etl/runs/{run.pk}/rows/").json()["rows"]
        self.assertEqual(rows, [{"text": "", "flag": False, "number": 0}, {"text": None, "flag": True, "number": 1}])

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
