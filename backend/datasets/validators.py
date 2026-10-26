"""Bounded format validation. These limits are documented in DATASETS.md.

Original bytes are preserved; validation never executes formulas, extracts ZIPs,
fetches URLs, or deserializes Arrow extension types.
"""
import csv
import io
import json
import re
from decimal import Decimal
from pathlib import PurePosixPath
from zipfile import ZipFile

import openpyxl
import pyarrow.parquet as pq
from defusedxml.ElementTree import iterparse
from django.conf import settings

from .errors import DatasetError, invalid_file
from .models import Dataset

MAX_ROWS = 500_000
MAX_COLUMNS = 2048
MAX_EXPANDED_BYTES = 128 * 1024 * 1024
MAX_XML_NODES = 500_000
CONTROL_CHARACTERS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def limits():
    return {"max_file_size_bytes": settings.DATASET_MAX_FILE_SIZE_BYTES, "extensions": list(Dataset.Format.values)}


def validate_delimited(upload, delimiter):
    wrapper = io.TextIOWrapper(upload, encoding="utf-8-sig", newline="")
    try:
        width = None
        rows = 0
        for row in csv.reader(wrapper, delimiter=delimiter, strict=True):
            if not row:
                continue
            rows += 1
            if rows > MAX_ROWS or len(row) > MAX_COLUMNS:
                raise invalid_file("This file exceeds the row or column validation limit.")
            if any(CONTROL_CHARACTERS.search(value) for value in row):
                raise invalid_file("CSV and TSV files must contain readable UTF-8 text.")
            if width is None:
                if not any(value.strip() for value in row):
                    raise invalid_file("The file must contain a non-empty first row.")
                width = len(row)
            elif len(row) != width:
                raise invalid_file("Each row must have the same number of columns.")
        if width is None:
            raise invalid_file("The file has no tabular content.")
    finally:
        # TextIOWrapper must not close the upload needed by hashing/storage.
        wrapper.detach()


def validate_json(upload):
    text = upload.read().decode("utf-8-sig")
    # Bound nesting and structural allocations before json.loads builds objects.
    in_string = escaped = False
    depth = tokens = 0
    for character in text:
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
        elif character == '"':
            in_string = True
        elif character in "[{":
            depth += 1
            tokens += 1
        elif character in "]}":
            depth -= 1
        elif character in ",:":
            tokens += 1
        if depth > 64 or tokens > 250_000:
            raise invalid_file("JSON exceeds the nesting or complexity validation limit.")

    def reject_constant(value):
        raise ValueError("Non-standard JSON constant")

    value = json.loads(text, parse_float=Decimal, parse_constant=reject_constant)
    if not isinstance(value, (dict, list)):
        raise invalid_file("JSON must contain an object or array.")


def validate_xlsx(upload):
    with ZipFile(upload) as archive:
        entries = archive.infolist()
        if len(entries) > 2000 or sum(entry.file_size for entry in entries) > MAX_EXPANDED_BYTES:
            raise invalid_file("The workbook exceeds the expanded-size validation limit.")
        nodes = 0
        for entry in entries:
            if entry.flag_bits & 1 or entry.filename.lower().endswith("vbaproject.bin"):
                raise invalid_file("Encrypted or macro-enabled workbooks are not supported.")
            if entry.filename.lower().endswith((".xml", ".rels")):
                # Preflight XML before openpyxl allocates shared strings/styles.
                with archive.open(entry) as source:
                    depth = 0
                    for event, element in iterparse(source, events=("start", "end")):
                        if event == "start":
                            nodes += 1
                            depth += 1
                            if nodes > MAX_XML_NODES or depth > 64:
                                raise invalid_file("The workbook exceeds the XML complexity validation limit.")
                        else:
                            depth -= 1
                            element.clear()
    upload.seek(0)
    workbook = openpyxl.load_workbook(upload, read_only=True, data_only=True, keep_links=False)
    try:
        if not workbook.worksheets or len(workbook.worksheets) > 32:
            raise invalid_file("The workbook must contain between 1 and 32 worksheets.")
        cells = rows = 0
        for worksheet in workbook.worksheets:
            worksheet.reset_dimensions()
            for row in worksheet.iter_rows():
                rows += 1
                cells += len(row)
                if rows > MAX_ROWS or len(row) > MAX_COLUMNS or cells > 1_000_000:
                    raise invalid_file("The workbook exceeds the row or cell validation limit.")
    finally:
        workbook.close()


def validate_parquet(upload):
    with pq.ParquetFile(
        upload, pre_buffer=False, arrow_extensions_enabled=False,
        thrift_string_size_limit=8 * 1024 * 1024,
        thrift_container_size_limit=100_000, schema_depth_limit=32,
    ) as source:
        metadata = source.metadata
        if metadata.num_rows > MAX_ROWS or metadata.num_columns > MAX_COLUMNS or metadata.num_row_groups > 2048:
            raise invalid_file("The Parquet file exceeds the row, column or row-group validation limit.")
        expanded = sum(metadata.row_group(index).total_byte_size for index in range(metadata.num_row_groups))
        if expanded > MAX_EXPANDED_BYTES:
            raise invalid_file("The Parquet file exceeds the expanded-size validation limit.")
        decoded = 0
        for batch in source.iter_batches(batch_size=1024, use_threads=False):
            batch.validate(full=True)
            decoded += batch.nbytes
            if decoded > MAX_EXPANDED_BYTES:
                raise invalid_file("The Parquet file exceeds the decoded-size validation limit.")


def validate_upload(upload):
    filename = PurePosixPath(upload.name.replace("\\", "/")).name
    if len(filename) > 255 or CONTROL_CHARACTERS.search(filename):
        raise invalid_file("Choose a filename of at most 255 characters without control characters.")
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in Dataset.Format.values:
        raise invalid_file("Choose a CSV, TSV, JSON, XLSX or Parquet file.")
    if not upload.size:
        raise invalid_file("Empty files cannot be uploaded.")
    if upload.size > settings.DATASET_MAX_FILE_SIZE_BYTES:
        raise DatasetError("The file exceeds the upload size limit.", code="file_too_large", status=413, fields={"file": ["The file exceeds the upload size limit."]})
    validators = {"csv": lambda value: validate_delimited(value, ","), "tsv": lambda value: validate_delimited(value, "\t"), "json": validate_json, "xlsx": validate_xlsx, "parquet": validate_parquet}
    try:
        upload.seek(0)
        validators[extension](upload)
    except DatasetError:
        raise
    except Exception as error:
        # Parser exceptions may contain file contents or internal storage details.
        raise invalid_file(f"The file is not a supported, readable {extension.upper()} file.") from error
    finally:
        upload.seek(0)
    return filename, extension
