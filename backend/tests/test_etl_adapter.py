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

    def test_rejects_unsupported_options(self):
        cases = [
            step("cast_type", {"conversions": [{"column": "a", "toType": "binary"}]}),
            step("string_transform", {"rules": [{"column": "a", "caseMode": "camel"}]}),
            step("drop_duplicates", {"rules": [{"columns": ["a"], "keep": "none"}]}),
            step("drop_duplicates", {"rules": [{"columns": ["a"], "keep": "first", "orderBy": "a"}]}),
            step("format_datetime", {"column": "a", "inputFormat": "YYYY/MM/DD HH:mm"}),
            step("filter_rows", {"conditions": [{"column": "a", "operator": "is_true", "value": True}]}),
            step("filter_rows", {"conditions": [{"column": "a", "operator": "between", "value": "2026-01-01"}]}),
            step("handle_null", {"rules": [{"column": "a", "strategy": "mode"}]}),
            step("merge_columns", {"columns": ["a"], "newColumnName": "ab", "separator": " "}),
            step("merge_columns", {"columns": ["a", "b"], "newColumnName": "", "separator": " "}),
            step("merge_columns", {"columns": ["a", "b"], "newColumnName": "ab", "separator": "\x00"}),
        ]
        for item in cases:
            with self.subTest(step=item):
                self.assert_invalid(payload(item))

    def test_rejects_nonfinite_and_nonscalar_values(self):
        for value in (float("nan"), float("inf"), -float("inf"), {}, [], 10 ** 1000):
            with self.subTest(value=repr(value)):
                self.assert_invalid(payload(step("replace_value", {"column": "a", "oldValue": value, "newValue": "b"})))
        for value in ("NaN", "Infinity", None, True, "text"):
            with self.subTest(comparison=value):
                self.assert_invalid(payload(step("filter_rows", {"conditions": [{"column": "a", "operator": "greater_than", "value": value}]})))
        for value in (None, True, ""):
            with self.subTest(equals_invalid=value):
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

    def test_step_source_id_scoping_and_validation(self):
        data = validated(payload(
            step("string_transform", {"rules": [{"column": "city", "trim": True, "caseMode": "upper"}]}, sourceId=OTHER_ID),
            step("join", {"datasetId": OTHER_ID, "on": "id", "how": "left"}),
        ))
        self.assertEqual(data["steps"][0]["sourceId"], OTHER_ID)
        self.assertEqual(source_ids(data), [SOURCE_ID, OTHER_ID])
        self.assert_invalid(payload(step("join", {"datasetId": OTHER_ID, "on": "id"}, sourceId=OTHER_ID)))
        self.assert_invalid(payload(step("concat", {"datasetIds": [OTHER_ID]}, sourceId=OTHER_ID)))
        self.assert_invalid(payload(step("select_columns", {"selectedColumns": ["a"]}, sourceId="not-a-uuid")))

    def test_require_steps_and_cast_type_and_filter_config_rules(self):
        # Drafts allow 0 steps or all-disabled steps.
        self.assertTrue(PipelineSerializer(payload(), require_steps=False).is_valid())
        self.assertTrue(PipelineSerializer(payload(step("select_columns", {"selectedColumns": ["a"]}, enabled=False)), require_steps=False).is_valid())

        # Execution requires >= 1 enabled step.
        for bad in (
            payload(),
            {**payload(), "steps": None},
            payload(step("select_columns", {"selectedColumns": ["a"]}, enabled=False)),
        ):
            serializer = PipelineSerializer(bad, require_steps=True)
            with self.assertRaises(ETLError) as caught:
                serializer.is_valid(raise_exception=True)
            self.assertEqual(caught.exception.code, "invalid_pipeline")
            self.assertIn("steps", caught.exception.fields)

        # Canonical cast_type values and legacy aliases; boolean/bool rejected.
        for raw_type, expected_type in (
            ("str", "str"), ("int", "int"), ("float", "float"), ("date", "date"),
            ("string", "str"), ("integer", "int"), ("datetime", "date"),
        ):
            canonical = validated(payload(step("cast_type", {"conversions": [{"column": "a", "toType": raw_type}]})))
            self.assertEqual(canonical["steps"][0]["config"]["conversions"][0]["toType"], expected_type)

        for forbidden in ("boolean", "bool"):
            self.assert_invalid(payload(step("cast_type", {"conversions": [{"column": "a", "toType": forbidden}]})))

        # filter_rows config must not accept operatorsByType.
        self.assert_invalid(payload(step("filter_rows", {
            "conditions": [{"column": "a", "operator": "equals", "value": "x"}],
            "operatorsByType": {"string": ["equals"]},
        })))


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
            step("select_columns", {"selectedColumns": ["id"]}),
            step("select_columns", {"selectedColumns": ["missing"]}, enabled=False),
            step("join", {"datasetId": OTHER_ID, "on": "id"}, enabled=False),
        )
        pd.testing.assert_frame_equal(result, original)

    def test_execute_pipeline_rejects_zero_enabled_steps(self):
        frame = pd.DataFrame({"id": [1]})
        for steps in ([], [step("select_columns", {"selectedColumns": ["id"]}, enabled=False)]):
            with self.subTest(steps=steps):
                with self.assertRaises(ETLError) as caught:
                    run(frame, *steps)
                self.assertEqual(caught.exception.code, "invalid_pipeline")
                self.assertIn("steps", caught.exception.fields)

    def test_rejects_unknown_and_previously_dropped_columns_with_step_location(self):
        for steps, location in (([step("select_columns", {"selectedColumns": ["missing"]})], "steps.0"), ([step("select_columns", {"selectedColumns": ["a"]}), step("replace_value", {"column": "b", "oldValue": 1, "newValue": 2})], "steps.1")):
            with self.subTest(location=location):
                with self.assertRaises(ETLError) as caught:
                    run(pd.DataFrame({"a": [1], "b": [2]}), *steps)
                self.assertEqual(caught.exception.code, "invalid_column")
                self.assertIn(location, caught.exception.fields)

    def test_rejects_numeric_mean_median_or_filter_on_text(self):
        operations = [
            step("handle_null", {"rules": [{"column": "a", "strategy": "mean"}]}),
            step("handle_null", {"rules": [{"column": "a", "strategy": "median"}]}),
            step("filter_rows", {"conditions": [{"column": "a", "operator": "greater_than", "value": 1}]}),
            step("filter_rows", {"conditions": [{"column": "a", "operator": "not_equals", "value": 1}]}),
        ]
        for operation in operations:
            with self.subTest(operation=operation):
                with self.assertRaises(ETLError) as caught:
                    run(pd.DataFrame({"a": ["one", "two"]}), operation)
                self.assertEqual(caught.exception.code, "invalid_column_type")

    def test_new_tool_operations_and_extended_options(self):
        # keep="last" deduplication
        deduped = run(pd.DataFrame({"id": [1, 1, 2], "val": ["a", "b", "c"]}),
            step("drop_duplicates", {"rules": [{"allColumns": False, "columns": ["id"], "keep": "last"}]}))
        self.assertEqual(deduped["val"].tolist(), ["b", "c"])

        # median null fill
        filled = run(pd.DataFrame({"x": [1.0, None, 3.0, 100.0]}),
            step("handle_null", {"rules": [{"column": "x", "strategy": "median"}]}))
        self.assertEqual(filled["x"].tolist(), [1.0, 3.0, 3.0, 100.0])

        # date type conversion; boolean/bool rejected directly by adapter
        casted = run(pd.DataFrame({"num": ["42", "bad", "7"], "when": ["2026-10-01 12:30:00", "bad", "2026-10-02"]}),
            step("cast_type", {"conversions": [{"column": "num", "toType": "int"}, {"column": "when", "toType": "date"}]}))
        self.assertEqual(casted["num"].tolist(), [42, 0, 7])
        self.assertEqual(casted["when"].iloc[0], "2026-10-01")
        self.assertTrue(pd.isna(casted["when"].iloc[1]))
        for forbidden in ("boolean", "bool"):
            with self.assertRaises(ETLError) as caught:
                adapter.apply_step(
                    pd.DataFrame({"flag": ["true", "false"]}),
                    {"type": "cast_type", "config": {"conversions": [{"column": "flag", "toType": forbidden}]}},
                    {},
                )
            self.assertEqual(caught.exception.code, "invalid_pipeline")

        # title case string transform
        titled = run(pd.DataFrame({"name": ["  alice smith  "]}),
            step("string_transform", {"rules": [{"column": "name", "trim": False, "caseMode": "title"}]}))
        self.assertEqual(titled["name"].tolist(), ["Alice Smith"])

        # explicit inputFormat in format_datetime
        formatted = run(pd.DataFrame({"date": ["25/12/2026", "01/02/2026"]}),
            step("format_datetime", {"column": "date", "inputFormat": "DD/MM/YYYY", "outputFormat": "YYYY-MM-DD"}))
        self.assertEqual(formatted["date"].tolist(), ["2026-12-25", "2026-02-01"])

        # numeric equals preserves float/int equality; text equals trims and matches strings
        num_eq = run(pd.DataFrame({"amount": [1.0, 2.0, 3.0]}),
            step("filter_rows", {"conditions": [{"column": "amount", "operator": "equals", "value": 2}]}))
        self.assertEqual(num_eq["amount"].tolist(), [2.0])
        with self.assertRaises(ETLError) as caught:
            run(pd.DataFrame({"amount": [1.0, 2.0]}),
                step("filter_rows", {"conditions": [{"column": "amount", "operator": "equals", "value": "not-a-number"}]}))
        self.assertEqual(caught.exception.code, "invalid_column_type")

        text_eq = run(pd.DataFrame({"city": [" HCM ", "Ha Noi"]}),
            step("filter_rows", {"conditions": [{"column": "city", "operator": "equals", "value": "HCM"}]}))
        self.assertEqual(text_eq["city"].tolist(), [" HCM "])

        # case-insensitive literal contains, starts_with, ends_with, is_true/is_false, after/before
        ci = run(pd.DataFrame({"text": ["Hello [VIP]", "vip", "other"]}),
            step("filter_rows", {"conditions": [{"column": "text", "operator": "contains", "value": "[vip]"}]}))
        self.assertEqual(ci["text"].tolist(), ["Hello [VIP]"])
        sw = run(pd.DataFrame({"text": ["HCM-1", "HN-2"]}),
            step("filter_rows", {"conditions": [{"column": "text", "operator": "starts_with", "value": "HCM"}]}))
        self.assertEqual(sw["text"].tolist(), ["HCM-1"])
        ew = run(pd.DataFrame({"text": ["a.csv", "b.tsv"]}),
            step("filter_rows", {"conditions": [{"column": "text", "operator": "ends_with", "value": ".tsv"}]}))
        self.assertEqual(ew["text"].tolist(), ["b.tsv"])
        flags = run(pd.DataFrame({"ok": ["true", "false", "1"]}),
            step("filter_rows", {"conditions": [{"column": "ok", "operator": "is_true"}]}))
        self.assertEqual(flags["ok"].tolist(), ["true", "1"])
        false_flags = run(pd.DataFrame({"ok": ["true", "false", "1"]}),
            step("filter_rows", {"conditions": [{"column": "ok", "operator": "is_false"}]}))
        self.assertEqual(false_flags["ok"].tolist(), ["false"])
        dates = pd.DataFrame({"d": ["2026-01-01", "2026-06-15", "2026-12-31"]})
        self.assertEqual(run(dates, step("filter_rows", {"conditions": [{"column": "d", "operator": "after", "value": "2026-06-01"}]}))["d"].tolist(), ["2026-06-15", "2026-12-31"])
        self.assertEqual(run(dates, step("filter_rows", {"conditions": [{"column": "d", "operator": "before", "value": "2026-06-01"}]}))["d"].tolist(), ["2026-01-01"])
        with self.assertRaises(ETLError) as caught:
            run(dates, step("filter_rows", {"conditions": [{"column": "d", "operator": "after", "value": "not-a-date"}]}))
        self.assertEqual(caught.exception.code, "invalid_value")

        # merge_columns
        merged = run(pd.DataFrame({"first": [" Alice "], "last": [" Nguyen "]}),
            step("merge_columns", {"columns": ["first", "last"], "newColumnName": "full_name", "separator": " "}))
        self.assertEqual(merged["full_name"].tolist(), ["Alice Nguyen"])
        with self.assertRaises(ETLError) as caught:
            run(pd.DataFrame({"first": ["Alice"], "last": ["Nguyen"]}),
                step("merge_columns", {"columns": ["first", "last"], "newColumnName": "first", "separator": " "}))
        self.assertEqual(caught.exception.code, "invalid_column")

    def test_filter_rows_enforces_per_type_operators(self):
        frame = pd.DataFrame({
            "num": [1, 2, 3],
            "flt": [1.5, 2.5, 3.5],
            "txt": ["alpha", "beta", "gamma"],
            "dt": pd.to_datetime(["2026-01-01", "2026-06-01", "2026-12-01"]),
            "dt_str": ["2026/01/01", "01-06-2026", "2026-12-01"],
            "flag": [True, False, True],
            "flag_str": ["true", "false", "1"],
        })
        # Valid per-type operations
        self.assertEqual(len(run(frame, step("filter_rows", {"conditions": [{"column": "dt", "operator": "after", "value": "2026-05-01"}]}))), 2)
        self.assertEqual(len(run(frame, step("filter_rows", {"conditions": [{"column": "dt_str", "operator": "equals", "value": "2026/01/01"}]}))), 1)
        self.assertEqual(len(run(frame, step("filter_rows", {"conditions": [{"column": "flag", "operator": "is_true"}]}))), 2)
        self.assertEqual(len(run(frame, step("filter_rows", {"conditions": [{"column": "flag", "operator": "is_false"}]}))), 1)
        self.assertEqual(len(run(frame, step("filter_rows", {"conditions": [{"column": "flag_str", "operator": "is_true"}]}))), 2)

        # Cross-type invalid operator matrix
        invalid_cases = [
            ("txt", "greater_than", 1),
            ("dt", "greater_than", 1),
            ("flag", "greater_than", 1),
            ("flag", "not_equals", 1),
            ("num", "contains", "1"),
            ("flt", "starts_with", "1"),
            ("flag", "ends_with", "e"),
            ("dt_str", "contains", "2026"),
            ("num", "after", "2026-01-01"),
            ("flt", "before", "2026-01-01"),
            ("flag", "after", "2026-01-01"),
            ("txt", "after", "2026-01-01"),
            ("num", "is_true", None),
            ("flt", "is_false", None),
            ("dt", "is_true", None),
            ("txt", "is_true", None),
            ("flag", "equals", "True"),
        ]
        for column, operator, value in invalid_cases:
            cond = {"column": column, "operator": operator}
            if value is not None:
                cond["value"] = value
            with self.subTest(column=column, operator=operator):
                with self.assertRaises(ETLError) as caught:
                    run(frame, step("filter_rows", {"conditions": [cond]}))
                self.assertEqual(caught.exception.code, "invalid_column_type")

    def test_per_source_cleaning_feeds_into_join_and_concat(self):
        left = pd.DataFrame({"id": [1, 2], "amount": [10, 20]})
        right = pd.DataFrame({"id": [1, 1, 2], "city": ["  hcm  ", "  hcm  ", "  hn  "], "extra": ["x", "x", "y"]})
        joined = run(
            left,
            step("drop_duplicates", {"rules": [{"allColumns": False, "columns": ["id"], "keep": "first"}]}, sourceId=OTHER_ID),
            step("string_transform", {"rules": [{"column": "city", "trim": True, "caseMode": "upper"}]}, sourceId=OTHER_ID),
            step("select_columns", {"selectedColumns": ["id", "city"]}, sourceId=OTHER_ID),
            step("join", {"datasetId": OTHER_ID, "on": "id", "how": "left"}),
            extra_sources={OTHER_ID: right},
        )
        self.assertEqual(list(joined.columns), ["id", "amount", "city"])
        self.assertEqual(joined["city"].tolist(), ["HCM", "HN"])

        # Original right frame was not mutated and combined working memory limits are enforced
        self.assertEqual(len(right), 3)
        with patch.object(adapter, "MAX_MEMORY_BYTES", 10):
            with self.assertRaises(ETLError) as caught:
                run(left, step("select_columns", {"selectedColumns": ["id"]}, sourceId=OTHER_ID), extra_sources={OTHER_ID: right})
            self.assertEqual(caught.exception.code, "resource_limit")

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

    def test_preview_and_paginate_frame_detect_dates_and_reject_false_positives(self):
        orders = self.extract(self.dataset((VENDOR_DIR / "orders_sample.csv").read_bytes()))
        orders_preview = adapter.preview(orders)
        col_types = {col["name"]: col["type"] for col in orders_preview["columns"]}
        self.assertEqual(col_types["order_date"], "datetime")
        self.assertEqual(col_types["is_paid"], "boolean")
        self.assertEqual(col_types["order_id"], "string")

        # Mixed-format dates without "date" in column name, mixed tz, month names, and non-dates
        mixed = pd.DataFrame({
            "col_x": ["2026/10/01", "02-10-2026", "2026-10-03", "Oct 4, 2026"],
            "tz_mix": ["2026-10-01", "2026-10-02T12:30:00Z", "2026-10-03", "2026-10-04"],
            "years": ["2026", "2025", "2024", "2023"],
            "neg": ["-1", "-2", "-3", "-4"],
            "frac": ["1/2", "3/4", "1-2", "1.2.3"],
            "ids": ["ORD01", "ORD02", "0901234567", "HCM-1"],
            "mostly_bad": ["2026-10-01", "not-date-1", "not-date-2", "not-date-3"],
            "bool_obj": pd.Series([True, False, None, True], dtype="object"),
            "empty_str": ["", "   ", None, ""],
            "blank_date": [" ", "  ", None, " "],
        })
        mixed_types = {col["name"]: col["type"] for col in adapter.preview(mixed)["columns"]}
        self.assertEqual(mixed_types["col_x"], "datetime")
        self.assertEqual(mixed_types["tz_mix"], "datetime")
        self.assertEqual(mixed_types["years"], "string")
        self.assertEqual(mixed_types["neg"], "string")
        self.assertEqual(mixed_types["frac"], "string")
        self.assertEqual(mixed_types["ids"], "string")
        self.assertEqual(mixed_types["mostly_bad"], "string")
        self.assertEqual(mixed_types["bool_obj"], "boolean")
        self.assertEqual(mixed_types["empty_str"], "string")
        self.assertEqual(mixed_types["blank_date"], "string")

        # paginate_frame behavior
        paged = adapter.paginate_frame(orders, page=2, page_size=2)
        self.assertEqual(paged["page"], 2)
        self.assertEqual(paged["page_size"], 2)
        self.assertEqual(paged["total_count"], 5)
        self.assertEqual(paged["total_pages"], 3)
        self.assertEqual(len(paged["rows"]), 2)
        self.assertEqual({col["name"]: col["type"] for col in paged["columns"]}["order_date"], "datetime")
        empty_paged = adapter.paginate_frame(pd.DataFrame({"a": pd.Series([], dtype="int64")}), page=1, page_size=10)
        self.assertEqual((empty_paged["rows"], empty_paged["total_count"], empty_paged["total_pages"]), ([], 0, 1))
        with self.assertRaises(ETLError) as caught:
            adapter.paginate_frame(orders, page=4, page_size=2)
        self.assertEqual(caught.exception.code, "invalid_page")

    def test_paginate_result_normalizes_arrow_column_types(self):
        import pyarrow as pa
        frame = pd.DataFrame({
            "int_col": pd.Series([1, 2], dtype="int64"),
            "float_col": pd.Series([1.5, 2.5], dtype="float64"),
            "str_col": pd.Series(["a", "b"], dtype="object"),
            "dt_col": pd.to_datetime(["2026-01-01", "2026-01-02"]),
            "bool_col": pd.Series([True, False], dtype="bool"),
        })
        content = adapter.serialize_result(frame, "parquet")
        result = adapter.paginate_result(content, page=1, page_size=25)
        types = {col["name"]: col["type"] for col in result["columns"]}
        self.assertEqual(types, {
            "int_col": "integer",
            "float_col": "float",
            "str_col": "string",
            "dt_col": "datetime",
            "bool_col": "boolean",
        })
        # Also verify Arrow large_string / date32 / null direct mapping
        self.assertEqual(adapter._arrow_type_to_canonical(pa.large_string()), "string")
        self.assertEqual(adapter._arrow_type_to_canonical(pa.date32()), "datetime")
        self.assertEqual(adapter._arrow_type_to_canonical(pa.null()), "string")
        self.assertEqual(adapter._arrow_type_to_canonical(pa.decimal128(10, 2)), "float")
