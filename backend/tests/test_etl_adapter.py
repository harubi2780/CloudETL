"""Behavioral adapter checks that run without a database or configured Django."""

import hashlib
import io
import json
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

import numpy as np
import pandas as pd
from openpyxl import load_workbook

from etl import adapter
from etl.errors import ETLError
from etl.serializers import MAX_STEPS, PipelineSerializer, source_ids


SOURCE_ID = "10000000-0000-0000-0000-000000000001"
OTHER_ID = "10000000-0000-0000-0000-000000000002"
VENDOR_DIR = Path(__file__).resolve().parents[1] / "vendor" / "etl_tool"


def payload(*steps):
    return {"name": "Adapter behavior", "datasetId": SOURCE_ID, "steps": list(steps)}


def step(kind, config, **extra):
    return {"type": kind, "config": config, **extra}


def validated(data):
    serializer = PipelineSerializer(data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


def run(frame, *steps, extra_sources=None):
    return adapter.execute_pipeline(
        validated(payload(*steps)), {SOURCE_ID: frame, **(extra_sources or {})},
    )[0]


class PipelineSerializerTests(TestCase):
    def assert_invalid(self, data):
        serializer = PipelineSerializer(data)
        self.assertFalse(serializer.is_valid())
        with self.assertRaises(ETLError) as caught:
            serializer.is_valid(raise_exception=True)
        self.assertTrue(caught.exception.fields)
        return caught.exception

    def test_normalizes_frontend_metadata_and_legacy_string_and_null_shapes(self):
        data = payload(
            step("string_transform", {"columns": ["name"], "trim": True, "caseMode": "lower"}, id="step-1", name="Normalize"),
            step("handle_null", {"rules": [{"column": "amount", "strategy": "fill_mean"}]}),
        )
        data["updatedAt"] = "2026-11-14T00:00:00Z"
        canonical = validated(data)
        self.assertEqual(canonical["schemaVersion"], 1)
        self.assertNotIn("updatedAt", canonical)
        self.assertNotIn("id", canonical["steps"][0])
        self.assertEqual(canonical["steps"][0]["config"], {
            "rules": [{"column": "name", "trim": True, "caseMode": "lower"}],
        })
        self.assertEqual(canonical["steps"][1]["config"]["rules"][0], {
            "column": "amount", "strategy": "mean", "customValue": None,
        })
        self.assertEqual(json.loads(json.dumps(canonical, allow_nan=False)), canonical)

    def test_rejects_unknown_fields_at_every_level(self):
        cases = [
            {**payload(), "ownerId": 2},
            payload(step("select_columns", {"selectedColumns": ["a"]}, unexpected=True)),
            payload(step("select_columns", {"selectedColumns": ["a"], "unexpected": True})),
            payload(step("cast_type", {"conversions": [{"column": "a", "toType": "integer", "unexpected": True}]})),
        ]
        for data in cases:
            with self.subTest(data=data):
                self.assert_invalid(data)

    def test_rejects_frontend_options_missing_from_original_tool(self):
        cases = [
            step("cast_type", {"conversions": [{"column": "a", "toType": "boolean"}]}),
            step("string_transform", {"rules": [{"column": "a", "caseMode": "title"}]}),
            step("drop_duplicates", {"rules": [{"columns": ["a"], "keep": "last"}]}),
            step("drop_duplicates", {"rules": [{"columns": ["a"], "keep": "first", "orderBy": "a"}]}),
            step("format_datetime", {"column": "a", "inputFormat": "DD/MM/YYYY"}),
            step("filter_rows", {"conditions": [{"column": "a", "operator": "is_true", "value": True}]}),
        ]
        for strategy in ("median", "mode"):
            cases.append(step("handle_null", {"rules": [{"column": "a", "strategy": strategy}]}))
        for item in cases:
            with self.subTest(step=item):
                self.assert_invalid(payload(item))

    def test_rejects_nonfinite_and_nonscalar_values(self):
        for value in (float("nan"), float("inf"), -float("inf"), {}, [], 10 ** 1000):
            with self.subTest(value=repr(value)):
                self.assert_invalid(payload(step("replace_value", {"column": "a", "oldValue": value, "newValue": "b"})))
        for value in ("NaN", "Infinity", None, True, "text"):
            with self.subTest(comparison=value):
                self.assert_invalid(payload(step("filter_rows", {"conditions": [{"column": "a", "operator": "equals", "value": value}]})))

    def test_rejects_malformed_structure_and_unbounded_steps(self):
        for data in ([], {}, payload(step("arbitrary_code", {})), {**payload(), "steps": [step("select_columns", {"selectedColumns": ["a"]})] * (MAX_STEPS + 1)}, {**payload(), "datasetId": "../../private.csv"}, {**payload(), "schemaVersion": True}):
            with self.subTest(data=repr(data)[:120]):
                self.assert_invalid(data)

    def test_rejects_empty_duplicate_or_invalid_columns_and_bad_booleans(self):
        for names in ([], ["a", "a"], [""], ["a\x00"], [12]):
            with self.subTest(names=names):
                self.assert_invalid(payload(step("select_columns", {"selectedColumns": names})))
        self.assert_invalid(payload(step("select_columns", {"selectedColumns": ["a"]}, enabled="false")))
        self.assert_invalid(payload(step("string_transform", {"rules": [{"column": "a", "trim": 1}]})))

    def test_custom_fill_requires_value_and_disabled_sources_are_not_loaded(self):
        self.assert_invalid(payload(step("handle_null", {"rules": [{"column": "a", "strategy": "custom"}]})))
        self.assert_invalid(payload(step("handle_null", {"rules": [{"column": "a", "strategy": "custom", "customValue": None}]})))
        config = validated(payload(
            step("join", {"datasetId": OTHER_ID, "on": "id"}, enabled=False),
        ))
        self.assertEqual(source_ids(config), [SOURCE_ID])

    def test_caps_unique_sources_and_rejects_duplicate_concat_ids(self):
        ids = [f"10000000-0000-0000-0000-{number:012d}" for number in range(2, 8)]
        self.assert_invalid(payload(*[step("join", {"datasetId": key, "on": "id"}) for key in ids]))
        self.assert_invalid(payload(step("concat", {"datasetIds": [OTHER_ID, OTHER_ID]})))


class EtlTransformationTests(TestCase):
    def test_select_columns_preserves_requested_order_without_mutating_input(self):
        frame = pd.DataFrame({"a": [1, 2], "b": [3, 4], "unused": [5, 6]})
        original = frame.copy(deep=True)
        result = run(frame, step("select_columns", {"selectedColumns": ["b", "a"]}))
        self.assertEqual(list(result.columns), ["b", "a"])
        pd.testing.assert_frame_equal(frame, original)

    def test_deduplication_keeps_first_exact_match(self):
        frame = pd.DataFrame({"key": ["A", "A", "a"], "amount": [1, 2, 3]})
        result = run(frame, step("drop_duplicates", {"rules": [{"columns": ["key"], "keep": "first"}]}))
        self.assertEqual(result["amount"].tolist(), [1, 3])
        all_columns = run(pd.DataFrame({"a": [1, 1, 2]}), step("drop_duplicates", {"rules": [{"allColumns": True, "columns": []}]}))
        self.assertEqual(all_columns["a"].tolist(), [1, 2])

    def test_null_strategies_mean_custom_and_drop(self):
        frame = pd.DataFrame({"amount": [1.0, 2.0, np.nan], "name": ["a", None, "c"]})
        result = run(frame,
            step("handle_null", {"rules": [{"column": "amount", "strategy": "mean"}, {"column": "name", "strategy": "custom", "customValue": "guest"}]}),
        )
        self.assertEqual(result["amount"].tolist(), [1.0, 2.0, 1.5])
        self.assertEqual(result["name"].tolist(), ["a", "guest", "c"])
        dropped = run(frame, step("handle_null", {"rules": [{"column": "name", "strategy": "drop"}]}))
        self.assertEqual(dropped["name"].tolist(), ["a", "c"])

    def test_ordered_sample_pipeline_deduplicates_before_computing_mean(self):
        content = (VENDOR_DIR / "orders_sample.csv").read_bytes()
        frame = pd.read_csv(io.BytesIO(content))
        result = run(frame,
            step("drop_duplicates", {"rules": [{"columns": ["order_id"]}]}),
            step("handle_null", {"rules": [{"column": "total_amount", "strategy": "mean"}]}),
            step("replace_value", {"column": "city", "oldValue": "Hồ Chí Minh", "newValue": "HCM"}),
            step("filter_rows", {"conditions": [{"column": "total_amount", "operator": "greater_or_equal", "value": 900000}]}),
            step("select_columns", {"selectedColumns": ["order_id", "city", "total_amount"]}),
        )
        self.assertEqual(result["order_id"].tolist(), ["ORD01", "ORD02"])
        self.assertEqual(result["city"].tolist(), ["HCM", "Hà Nội"])
        self.assertEqual(result["total_amount"].tolist(), [1500000.0, 933333.33])
        self.assertEqual(adapter.preview(result, initial_rows=len(frame))["dropped_rows"], 3)

    def test_type_conversion_preserves_upstream_invalid_integer_to_zero(self):
        frame = pd.DataFrame({"integer": ["12", "invalid", None], "decimal": ["1.5", "invalid", "2"], "text": [1, 2, 3]})
        result = run(frame, step("cast_type", {"conversions": [
            {"column": "integer", "toType": "integer"},
            {"column": "decimal", "toType": "float"},
            {"column": "text", "toType": "string"},
        ]}))
        self.assertEqual(result["integer"].tolist(), [12, 0, 0])
        self.assertEqual(result["decimal"].iloc[0], 1.5)
        self.assertTrue(pd.isna(result["decimal"].iloc[1]))
        self.assertEqual(result["text"].tolist(), ["1", "2", "3"])

    def test_string_cleanup_strips_edges_and_changes_case(self):
        result = run(pd.DataFrame({"name": ["  Alice  Smith  ", "BOB"]}),
            step("string_transform", {"rules": [{"column": "name", "trim": True, "caseMode": "lower"}]}),
        )
        self.assertEqual(result["name"].tolist(), ["alice  smith", "bob"])
        upper = run(result, step("string_transform", {"rules": [{"column": "name", "caseMode": "upper"}]}))
        self.assertEqual(upper["name"].iloc[1], "BOB")

    def test_replacement_matches_exact_values_and_keeps_empty_replacement(self):
        result = run(pd.DataFrame({"city": ["HCM", "hcm", "HCM suburb"]}),
            step("replace_value", {"column": "city", "oldValue": "HCM", "newValue": ""}),
        )
        self.assertEqual(result["city"].tolist(), ["", "hcm", "HCM suburb"])

    def test_datetime_formats_and_invalid_date_coercion(self):
        for output, expected in (("YYYY-MM-DD", "2026-10-01"), ("YYYY-MM-DD HH:mm:ss", "2026-10-01 12:30:00"), ("ISO_8601", "2026-10-01T12:30:00")):
            with self.subTest(output=output):
                result = run(pd.DataFrame({"date": ["2026-10-01 12:30:00", "invalid"]}),
                    step("format_datetime", {"column": "date", "outputFormat": output}),
                )
                self.assertEqual(result["date"].iloc[0], expected)
                self.assertTrue(pd.isna(result["date"].iloc[1]))

    def test_numeric_filters_and_literal_contains(self):
        for operator, expected in (("greater_than", [3]), ("less_than", [1]), ("greater_or_equal", [2, 3]), ("less_or_equal", [1, 2]), ("equals", [2]), ("not_equals", [1, 3])):
            with self.subTest(operator=operator):
                result = run(pd.DataFrame({"value": [1, 2, 3]}), step("filter_rows", {"conditions": [{"column": "value", "operator": operator, "value": "2"}]}))
                self.assertEqual(result["value"].tolist(), expected)
        result = run(pd.DataFrame({"text": ["a.b", "axb", "A.B", "[x]", "x"]}),
            step("filter_rows", {"conditions": [{"column": "text", "operator": "contains", "value": "."}]}),
        )
        self.assertEqual(result["text"].tolist(), ["a.b", "A.B"])
        brackets = run(pd.DataFrame({"text": ["[x]", "x"]}), step("filter_rows", {"conditions": [{"column": "text", "operator": "contains", "value": "[x]"}]}))
        self.assertEqual(brackets["text"].tolist(), ["[x]"])

    def test_join_and_concat(self):
        left = pd.DataFrame({"id": [1, 2], "amount": [10, 20]})
        right = pd.DataFrame({"id": [1], "name": ["Alice"]})
        joined = run(left, step("join", {"datasetId": OTHER_ID, "on": "id", "how": "left"}), extra_sources={OTHER_ID: right})
        self.assertEqual(joined["name"].iloc[0], "Alice")
        self.assertTrue(pd.isna(joined["name"].iloc[1]))
        combined = run(left, step("concat", {"datasetIds": [OTHER_ID]}), extra_sources={OTHER_ID: pd.DataFrame({"id": [3], "amount": [30]})})
        self.assertEqual(combined["id"].tolist(), [1, 2, 3])

    def test_disabled_steps_skip_execution_and_missing_source(self):
        original = pd.DataFrame({"id": [1]})
        result = run(original,
            step("select_columns", {"selectedColumns": ["missing"]}, enabled=False),
            step("join", {"datasetId": OTHER_ID, "on": "id"}, enabled=False),
        )
        pd.testing.assert_frame_equal(result, original)

    def test_rejects_unknown_and_previously_dropped_columns_with_step_location(self):
        for steps, location in (([step("select_columns", {"selectedColumns": ["missing"]})], "steps.0"), ([step("select_columns", {"selectedColumns": ["a"]}), step("replace_value", {"column": "b", "oldValue": 1, "newValue": 2})], "steps.1")):
            with self.subTest(location=location):
                with self.assertRaises(ETLError) as caught:
                    run(pd.DataFrame({"a": [1], "b": [2]}), *steps)
                self.assertEqual(caught.exception.code, "invalid_column")
                self.assertIn(location, caught.exception.fields)

    def test_rejects_numeric_mean_or_filter_on_text(self):
        operations = [step("handle_null", {"rules": [{"column": "a", "strategy": "mean"}]}), step("filter_rows", {"conditions": [{"column": "a", "operator": "equals", "value": 1}]})]
        for operation in operations:
            with self.subTest(operation=operation):
                with self.assertRaises(ETLError) as caught:
                    run(pd.DataFrame({"a": ["one", "two"]}), operation)
                self.assertEqual(caught.exception.code, "invalid_column_type")

    def test_join_explosion_rejected_before_merge_including_null_keys(self):
        left = pd.DataFrame({"id": [None] * 800})
        right = pd.DataFrame({"id": [None] * 800})
        with patch.object(adapter.transform, "joinTables") as merge:
            with self.assertRaises(ETLError) as caught:
                run(left, step("join", {"datasetId": OTHER_ID, "on": "id", "how": "inner"}), extra_sources={OTHER_ID: right})
        self.assertEqual(caught.exception.code, "resource_limit")
        merge.assert_not_called()

    def test_concat_limits_checked_before_allocation(self):
        frame = pd.DataFrame({"id": [1, 2]})
        with patch.object(adapter, "MAX_ROWS", 3), patch.object(adapter.transform, "concatTables") as concat:
            with self.assertRaises(ETLError) as caught:
                run(frame, step("concat", {"datasetIds": [OTHER_ID]}), extra_sources={OTHER_ID: frame})
        self.assertEqual(caught.exception.code, "resource_limit")
        concat.assert_not_called()

    def test_frame_rejects_duplicate_columns_and_memory_limit(self):
        with self.assertRaises(ETLError):
            adapter.check_frame(pd.DataFrame([[1, 2]], columns=["a", "a"]))
        with patch.object(adapter, "MAX_MEMORY_BYTES", 1):
            with self.assertRaises(ETLError) as caught:
                adapter.check_frame(pd.DataFrame({"a": ["payload"]}))
        self.assertEqual(caught.exception.code, "resource_limit")


class EtlExtractionAndExportTests(TestCase):
    def dataset(self, content, file_format="csv"):
        return SimpleNamespace(
            format=file_format, size_bytes=len(content), sha256=hashlib.sha256(content).hexdigest(),
            file=SimpleNamespace(name=f"private/input.{file_format}", open=lambda mode: io.BytesIO(content)),
        )

    def extract(self, dataset, snapshot=None):
        # Patch the adapter's settings handle, avoiding global Django setup.
        with patch.object(adapter, "settings", SimpleNamespace(DATASET_MAX_FILE_SIZE_BYTES=25 * 1024 * 1024)):
            return adapter.extract_dataset(dataset, snapshot)

    def test_extracts_supplied_csv_and_tsv_and_records_inferred_phone_loss(self):
        orders = self.extract(self.dataset((VENDOR_DIR / "orders_sample.csv").read_bytes()))
        customers = self.extract(self.dataset((VENDOR_DIR / "customers_sample.tsv").read_bytes(), "tsv"))
        self.assertEqual(len(orders), 5)
        self.assertEqual(len(customers), 4)
        self.assertEqual(orders["order_id"].iloc[0], "ORD01")
        self.assertEqual(customers["customer_phone"].iloc[0], 901234567)

    def test_rejects_bad_headers_width_and_unsupported_input(self):
        for content in (b"a,a\n1,2\n", b"a,\n1,2\n", b"a,b\n1\n", b""):
            with self.subTest(content=content):
                with self.assertRaises(ETLError):
                    self.extract(self.dataset(content))
        with self.assertRaises(ETLError) as caught:
            self.extract(self.dataset(b"[]", "json"))
        self.assertEqual(caught.exception.code, "unsupported_input")

    def test_rejects_changed_metadata_bytes_snapshot_and_oversized_source(self):
        dataset = self.dataset(b"a\n1\n")
        stale = {"key": dataset.file.name, "format": "csv", "size_bytes": dataset.size_bytes, "sha256": "0" * 64}
        with self.assertRaises(ETLError) as caught:
            self.extract(dataset, stale)
        self.assertEqual(caught.exception.code, "input_changed")
        dataset.sha256 = "0" * 64
        with self.assertRaises(ETLError) as caught:
            self.extract(dataset)
        self.assertEqual(caught.exception.code, "input_changed")
        with patch.object(adapter, "settings", SimpleNamespace(DATASET_MAX_FILE_SIZE_BYTES=2)):
            with self.assertRaises(ETLError) as caught:
                adapter.extract_dataset(self.dataset(b"a\n1\n"))
        self.assertEqual(caught.exception.code, "resource_limit")

    def test_preview_normalizes_nonfinite_values_dates_and_counts(self):
        frame = pd.DataFrame({"number": [1.0, np.nan, np.inf, -np.inf], "date": pd.to_datetime(["2026-10-01", None, None, None])})
        report = adapter.preview(frame, initial_rows=3)
        self.assertEqual(report["final_rows"], 4)
        self.assertEqual(report["added_rows"], 1)
        self.assertEqual(report["dropped_rows"], 0)
        self.assertEqual([row["number"] for row in report["rows"]], [1.0, None, None, None])
        self.assertTrue(report["rows"][0]["date"].startswith("2026-10-01"))
        json.dumps(report, allow_nan=False)
        self.assertEqual(len(adapter.preview(pd.DataFrame({"id": range(20)}))["rows"]), 10)

    def test_five_export_formats_roundtrip(self):
        frame = pd.DataFrame({"name": ["Hồ Chí Minh", "Hà Nội"], "amount": [1500000, 800000]})
        for file_format in ("parquet", "csv", "tsv", "json", "xlsx"):
            with self.subTest(file_format=file_format):
                content = adapter.serialize_result(frame, file_format)
                if file_format == "parquet":
                    result = adapter.read_result(content)
                elif file_format in ("csv", "tsv"):
                    result = pd.read_csv(io.BytesIO(content), sep="\t" if file_format == "tsv" else ",")
                elif file_format == "json":
                    result = pd.DataFrame(json.loads(content))
                else:
                    workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
                    rows = list(workbook.active.values)
                    result = pd.DataFrame(rows[1:], columns=rows[0])
                    workbook.close()
                self.assertEqual(result.to_dict(orient="records"), frame.to_dict(orient="records"))
                self.assertEqual(list(result.columns), ["name", "amount"])

    def test_xlsx_formula_like_headers_and_values_remain_text(self):
        frame = pd.DataFrame({"=header": ["=1+1", "+SUM(A1)", "@command"]})
        content = adapter.serialize_result(frame, "xlsx")
        workbook = load_workbook(io.BytesIO(content), data_only=False)
        cells = [row[0] for row in workbook.active.iter_rows()]
        self.assertEqual([cell.value for cell in cells], ["=header", "=1+1", "+SUM(A1)", "@command"])
        self.assertTrue(all(cell.data_type == "s" for cell in cells))
        workbook.close()

    def test_export_unknown_format_and_size_limit(self):
        frame = pd.DataFrame({"a": [1]})
        with self.assertRaises(ETLError):
            adapter.serialize_result(frame, "pickle")
        with patch.object(adapter, "MAX_RESULT_BYTES", 1):
            with self.assertRaises(ETLError) as caught:
                adapter.serialize_result(frame, "csv")
        self.assertEqual(caught.exception.code, "resource_limit")

    def test_xlsx_oversized_cell_fails_before_creating_workbook(self):
        with patch.object(adapter, "Workbook") as workbook:
            with self.assertRaises(ETLError) as caught:
                adapter.serialize_result(pd.DataFrame({"text": ["x" * 32768]}), "xlsx")
        self.assertEqual(caught.exception.code, "export_failed")
        workbook.assert_not_called()
