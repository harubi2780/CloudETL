"""Bounded application adapter around the unmodified, vendored ETL functions."""
import csv
import hashlib
import io
import json
import re
from collections import Counter
from pathlib import Path
from tempfile import TemporaryDirectory

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from django.conf import settings
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell

from vendor.etl_tool import extract, load, transform

from .errors import ETLError
from .serializers import MAX_CELLS, MAX_COLUMNS, MAX_MEMORY_BYTES, MAX_RESULT_BYTES, MAX_ROWS


def check_shape(rows, columns):
    if rows > MAX_ROWS or columns > MAX_COLUMNS or rows * columns > MAX_CELLS:
        raise ETLError("The data exceeds the ETL row, column, or cell limit.", code="resource_limit")


def check_frame(frame):
    check_shape(len(frame), len(frame.columns))
    if frame.columns.has_duplicates:
        raise ETLError("Duplicate result column names are not supported.")
    if frame.memory_usage(index=True, deep=True).sum() > MAX_MEMORY_BYTES:
        raise ETLError("The data exceeds the ETL memory limit.", code="resource_limit")
    return frame


def extract_dataset(dataset, snapshot=None):
    """Stage an owner-checked storage object locally; never accept client paths."""
    if dataset.format not in ("csv", "tsv"):
        raise ETLError("This ETL tool supports CSV and TSV inputs only.", code="unsupported_input")
    if snapshot and any(snapshot[field] != value for field, value in {
        "sha256": dataset.sha256, "key": dataset.file.name,
        "format": dataset.format, "size_bytes": dataset.size_bytes,
    }.items()):
        raise ETLError("An input dataset changed after this run was queued.", code="input_changed")
    with TemporaryDirectory(prefix="cloudetl-extract-") as temporary:
        path = Path(temporary) / f"input.{dataset.format}"
        digest = hashlib.sha256()
        count = 0
        with dataset.file.open("rb") as source, path.open("wb") as output:
            while chunk := source.read(64 * 1024):
                count += len(chunk)
                if count > settings.DATASET_MAX_FILE_SIZE_BYTES:
                    raise ETLError("An input exceeds the file size limit.", code="resource_limit")
                digest.update(chunk)
                output.write(chunk)
        if count != dataset.size_bytes or digest.hexdigest() != dataset.sha256:
            raise ETLError("Input bytes no longer match dataset metadata.", code="input_changed")
        # Validate headers before pandas silently renames duplicates or blank names.
        with path.open(encoding="utf-8-sig", newline="") as source:
            reader = csv.reader(source, delimiter="\t" if dataset.format == "tsv" else ",", strict=True)
            header = next((row for row in reader if row), None)
            if not header or any(not name.strip() or len(name) > 255 for name in header) or len(header) != len(set(header)):
                raise ETLError("ETL inputs require unique, non-empty column names up to 255 characters.")
            rows = 0
            check_shape(rows, len(header))
            for row in reader:
                if not row:
                    continue
                rows += 1
                check_shape(rows, len(header))
                if len(row) != len(header):
                    raise ETLError("Input rows must have the same width as the header.")
        frame = extract.readFile(str(path))
        if frame is None:
            raise ETLError("The tool could not read this dataset.", code="extraction_failed")
        return check_frame(frame)


def require_columns(frame, names):
    if set(names) - set(frame.columns):
        raise ETLError("A configured column does not exist at this pipeline step.", code="invalid_column")


def numeric_column(frame, name):
    if not pd.api.types.is_numeric_dtype(frame[name]) or pd.api.types.is_bool_dtype(frame[name]):
        raise ETLError("This operation requires a numeric column; add a conversion step first.", code="invalid_column_type")


def estimate_join(left, right, column, how):
    """Count matches before allocating a potentially multiplicative join result."""
    null_key = object()
    def counts(frame):
        return Counter(null_key if pd.isna(value) else value for value in frame[column])
    left_counts, right_counts = counts(left), counts(right)
    rows = sum(count * right_counts.get(key, 0) for key, count in left_counts.items())
    if how in ("left", "outer"):
        rows += sum(count for key, count in left_counts.items() if key not in right_counts)
    if how in ("right", "outer"):
        rows += sum(count for key, count in right_counts.items() if key not in left_counts)
    check_shape(rows, len(left.columns) + len(right.columns) - 1)
    # Conservative bound on repeated string payloads, before pd.merge allocates.
    row_bytes = sum(int(frame.memory_usage(index=False, deep=True).sum()) / max(len(frame), 1) for frame in (left, right))
    if rows * row_bytes > MAX_MEMORY_BYTES:
        raise ETLError("The join would exceed the ETL memory limit.", code="resource_limit")


def apply_step(frame, step, sources):
    kind, config = step["type"], step["config"]
    if kind == "join":
        right = sources[config["datasetId"]]
        require_columns(frame, [config["on"]])
        require_columns(right, [config["on"]])
        estimate_join(frame, right, config["on"], config["how"])
        return transform.joinTables(frame, right, config["on"], config["how"])
    if kind == "concat":
        frames = [frame, *(sources[key] for key in config["datasetIds"])]
        check_shape(sum(len(item) for item in frames), len(set().union(*(item.columns for item in frames))))
        if sum(item.memory_usage(index=True, deep=True).sum() for item in frames) > MAX_MEMORY_BYTES:
            raise ETLError("Concatenation would exceed the ETL memory limit.", code="resource_limit")
        return transform.concatTables(frames)
    if kind == "select_columns":
        require_columns(frame, config["selectedColumns"])
        return transform.selectColumns(frame, keep_columns=config["selectedColumns"])
    if kind == "drop_duplicates":
        for rule in config["rules"]:
            names = None if rule["allColumns"] else rule["columns"]
            require_columns(frame, names or [])
            frame = transform.removeDuplicates(frame, columns=names)
        return frame
    if kind in ("replace_value", "format_datetime"):
        require_columns(frame, [config["column"]])
        if kind == "replace_value":
            return transform.replaceValue(frame, config["column"], config["oldValue"], config["newValue"])
        formats = {"YYYY-MM-DD": "%Y-%m-%d", "YYYY-MM-DD HH:mm:ss": "%Y-%m-%d %H:%M:%S", "ISO_8601": "%Y-%m-%dT%H:%M:%S"}
        return transform.normalizeDate(frame, config["column"], formats[config["outputFormat"]])
    key = "conversions" if kind == "cast_type" else "conditions" if kind == "filter_rows" else "rules"
    for rule in config[key]:
        column = rule["column"]
        require_columns(frame, [column])
        if kind == "handle_null":
            methods = {"drop": "drop_rows", "custom": "constant_value", "mean": "mean"}
            if rule["strategy"] == "mean":
                numeric_column(frame, column)
            frame = transform.handleNull(frame, methods[rule["strategy"]], columns=[column], value=rule["customValue"])
        elif kind == "cast_type":
            frame = transform.convertType(frame, column, {"integer": "int", "float": "float", "string": "string"}[rule["toType"]])
        elif kind == "string_transform":
            if rule["trim"]:
                frame = transform.cleanString(frame, column, "strip")
            if rule["caseMode"] in ("upper", "lower"):
                frame = transform.cleanString(frame, column, {"upper": "uppercase", "lower": "lowercase"}[rule["caseMode"]])
        elif kind == "filter_rows":
            operators = {"greater_than": ">", "less_than": "<", "greater_or_equal": ">=", "less_or_equal": "<=", "equals": "==", "not_equals": "!=", "contains": "contains"}
            value = rule["value"]
            if rule["operator"] != "contains":
                numeric_column(frame, column)
            else:
                # The upstream tool uses regex; expose literal contains only.
                value = re.escape(value)
            frame = transform.filterData(frame, column, operators[rule["operator"]], value)
    return frame


def execute_pipeline(config, sources):
    frame = sources[config["datasetId"]].copy()
    initial_rows = len(frame)
    for index, step in enumerate(config["steps"]):
        if not step["enabled"]:
            continue
        try:
            frame = check_frame(apply_step(frame, step, sources))
        except ETLError as error:
            error.fields = {f"steps.{index}": [error.message]}
            raise
        except (ValueError, TypeError, KeyError, OverflowError) as error:
            raise ETLError(f"Transformation step {index + 1} failed. Check column types and values.", code="transformation_failed") from error
    return check_frame(frame), initial_rows


def preview(frame, initial_rows=None):
    # JSON roundtrip normalizes numpy scalars, NaN, infinities and dates.
    report = load.reviewFile(frame, initial_rows=initial_rows, n_rows=10)
    return {"initial_rows": initial_rows, "final_rows": report["final_rows"],
            "dropped_rows": max(0, initial_rows - len(frame)) if initial_rows is not None else 0,
            "added_rows": max(0, len(frame) - initial_rows) if initial_rows is not None else 0,
            "columns": [{"name": name, "type": dtype} for name, dtype in extract.checkColumnType(frame).items()],
            "rows": json.loads(frame.head(10).to_json(orient="records", date_format="iso"))}


def serialize_result(frame, file_format):
    output = io.BytesIO()
    if file_format == "parquet":
        pq.write_table(pa.Table.from_pandas(frame, preserve_index=False), output, row_group_size=4096)
    elif file_format in ("csv", "tsv"):
        text_output = io.StringIO()
        load.exportFile(frame, text_output, file_type=file_format)
        output.write(text_output.getvalue().encode("utf-8"))
    elif file_format == "json":
        output.write(frame.to_json(orient="records", date_format="iso", force_ascii=False).encode("utf-8"))
    elif file_format == "xlsx":
        if any(isinstance(value, str) and len(value) > 32767
               for row in frame.itertuples(index=False, name=None) for value in row):
            raise ETLError("A value exceeds Excel's 32767-character cell limit.", code="export_failed")
        workbook = Workbook(write_only=True)
        sheet = workbook.create_sheet("Result")
        cells = [WriteOnlyCell(sheet, value=value) for value in frame.columns]
        for cell in cells:
            cell.data_type = "s"
        sheet.append(cells)
        for row in frame.itertuples(index=False, name=None):
            cells = []
            for value in row:
                value = None if pd.isna(value) else value
                cell = WriteOnlyCell(sheet, value=value)
                if isinstance(value, str):
                    cell.data_type = "s"
                cells.append(cell)
            sheet.append(cells)
        workbook.save(output)
        workbook.close()
    else:
        raise ETLError("Unsupported export format.")
    if output.tell() > MAX_RESULT_BYTES:
        raise ETLError("The exported result exceeds 25 MiB.", code="resource_limit")
    return output.getvalue()


def read_result(content):
    parquet = pq.ParquetFile(io.BytesIO(content), arrow_extensions_enabled=False,
                             thrift_string_size_limit=8 * 1024 * 1024, thrift_container_size_limit=100_000)
    check_shape(parquet.metadata.num_rows, len(parquet.schema_arrow))
    if sum(parquet.metadata.row_group(index).total_byte_size for index in range(parquet.num_row_groups)) > MAX_MEMORY_BYTES:
        raise ETLError("The stored result exceeds the ETL memory limit.", code="resource_limit")
    table = parquet.read(use_threads=False)
    return check_frame(table.to_pandas())


def paginate_result(content, page, page_size):
    """Read only relevant Parquet row groups and return at most one page of rows."""
    parquet = pq.ParquetFile(io.BytesIO(content), arrow_extensions_enabled=False,
                             thrift_string_size_limit=8 * 1024 * 1024, thrift_container_size_limit=100_000)
    total = parquet.metadata.num_rows
    check_shape(total, len(parquet.schema_arrow))
    if parquet.num_row_groups > 2048 or sum(parquet.metadata.row_group(index).total_byte_size for index in range(parquet.num_row_groups)) > MAX_MEMORY_BYTES:
        raise ETLError("The stored result exceeds the ETL memory limit.", code="resource_limit")
    total_pages = max(1, (total + page_size - 1) // page_size)
    if page > total_pages:
        raise ETLError("This result page does not exist.", code="invalid_page")
    start, stop = (page - 1) * page_size, min(page * page_size, total)
    batches = []
    offset = 0
    for group in range(parquet.num_row_groups):
        group_rows = parquet.metadata.row_group(group).num_rows
        if offset + group_rows <= start:
            offset += group_rows
            continue
        if offset >= stop:
            break
        for batch in parquet.iter_batches(batch_size=1024, row_groups=[group], use_threads=False):
            end = offset + batch.num_rows
            if end > start and offset < stop:
                batches.append(batch.slice(max(0, start - offset), min(end, stop) - max(offset, start)))
            offset = end
            if offset >= stop:
                break
    table = pa.Table.from_batches(batches, schema=parquet.schema_arrow)
    frame = check_frame(table.to_pandas())
    return {"columns": [{"name": field.name, "type": str(field.type)} for field in parquet.schema_arrow],
            "rows": json.loads(frame.to_json(orient="records", date_format="iso")),
            "page": page, "page_size": page_size, "total_count": total, "total_pages": total_pages}
