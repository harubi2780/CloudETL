"""Manual smoke test for an already running local CloudETL Docker stack.

Creates fresh smoke-test accounts, datasets and runs. Existing application records
are never read, updated or deleted. Created records remain available for review.
No credentials, cookies or CSRF tokens are written to the report.

Example (run explicitly after activating the local stack):
    python scripts/docker_smoke_test.py --report smoke-report.json
"""

import argparse
import csv
import http.cookiejar
import io
import json
import re
import secrets
import sys
import time
import uuid
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPCookieProcessor, ProxyHandler, Request, build_opener


class SmokeFailure(Exception):
    """A controlled message that contains no response bodies or credentials."""


def local_base_url(value):
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise argparse.ArgumentTypeError("Choose a valid local HTTP URL.") from error
    if (parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1"}
            or parsed.username or parsed.password or parsed.path not in {"", "/"}
            or parsed.query or parsed.fragment or (port is not None and not 1 <= port <= 65535)):
        raise argparse.ArgumentTypeError("Only http://localhost[:port] or http://127.0.0.1[:port] is allowed.")
    return value.rstrip("/")


class SameOriginRedirects(HTTPRedirectHandler):
    def __init__(self, base_url):
        super().__init__()
        self.origin = urlsplit(base_url).netloc

    def redirect_request(self, request, fp, code, message, headers, new_url):
        destination = urlsplit(new_url)
        if destination.scheme != "http" or destination.netloc != self.origin:
            raise SmokeFailure("The local service attempted a redirect outside the selected origin.")
        return super().redirect_request(request, fp, code, message, headers, new_url)


class LocalSession:
    def __init__(self, base_url, check):
        self.base_url = base_url
        self.check = check
        self.csrf = None
        self.opener = build_opener(
            ProxyHandler({}), HTTPCookieProcessor(http.cookiejar.CookieJar()), SameOriginRedirects(base_url),
        )

    def request(self, path, *, method="GET", payload=None, content=None,
                content_type=None, status=200, csrf=True, accept="application/json", timeout=10):
        headers = {"Accept": accept}
        if method != "GET":
            headers["Origin"] = self.base_url
            headers["Referer"] = self.base_url + "/"
            if csrf and self.csrf:
                headers["X-CSRFToken"] = self.csrf
        if payload is not None:
            content = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
            content_type = "application/json"
        if content_type:
            headers["Content-Type"] = content_type
        request = Request(self.base_url + path, data=content, method=method, headers=headers)
        try:
            try:
                response = self.opener.open(request, timeout=timeout)
            except HTTPError as error:
                response = error
            with response:
                actual_status = response.status
                body = response.read(64 * 1024 * 1024 + 1)
                response_headers = response.headers
        except SmokeFailure:
            raise
        except (URLError, TimeoutError, OSError) as error:
            raise SmokeFailure(f"Could not reach the local service ({type(error).__name__}).") from None
        self.check(actual_status == status, f"{method} {path} returned HTTP {actual_status}; expected {status}.")
        self.check(len(body) <= 64 * 1024 * 1024, "The local response exceeded the smoke-test size limit.")
        return body, response_headers

    def json(self, path, **kwargs):
        body, _ = self.request(path, **kwargs)
        try:
            data = json.loads(body)
        except (ValueError, UnicodeError):
            raise SmokeFailure("The local API returned an invalid JSON response.") from None
        self.check(isinstance(data, dict), "The local API did not return a JSON object.")
        if isinstance(data.get("csrfToken"), str):
            self.csrf = data["csrfToken"]
        return data

    def register(self, username, password):
        self.json("/api/auth/csrf/")
        self.check(bool(self.csrf), "The CSRF endpoint did not return a token.")
        data = self.json("/api/auth/register/", method="POST", status=201, payload={
            "username": username, "email": f"{username}@example.test", "password": password,
            "password_confirmation": password,
        })
        self.check(data.get("user", {}).get("username") == username, "Registration did not return the fresh account.")
        self.check(bool(data.get("csrfToken")), "Registration did not return the rotated CSRF token.")

    def upload(self, filename, content):
        boundary = "cloudetl-smoke-" + secrets.token_hex(16)
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
                "Content-Type: application/octet-stream\r\n\r\n").encode("ascii")
        body += content + f"\r\n--{boundary}--\r\n".encode("ascii")
        response = self.json("/api/datasets/", method="POST", status=201, content=body,
                             content_type=f"multipart/form-data; boundary={boundary}")
        dataset = response.get("dataset", {})
        self.check(valid_uuid(dataset.get("id")), "Upload did not return a dataset UUID.")
        return dataset["id"]

    def submit(self, dataset_id, name, steps):
        response = self.json("/api/etl/runs/", method="POST", status=202, payload={
            "schemaVersion": 1, "name": name, "datasetId": dataset_id, "steps": steps,
        })
        run = response.get("run", {})
        self.check(valid_uuid(run.get("id")), "Submission did not return a run UUID.")
        self.check(run.get("status") == "queued", "Submission did not return a queued run.")
        return run["id"]

    def await_success(self, run_id):
        deadline = time.monotonic() + 60
        while True:
            remaining = deadline - time.monotonic()
            self.check(remaining > 0, "The run did not complete within the 60-second smoke-test deadline.")
            run = self.json(f"/api/etl/runs/{run_id}/", timeout=min(10, remaining)).get("run", {})
            if run.get("status") == "succeeded":
                return run
            if run.get("status") == "failed":
                code = run.get("error", {}).get("code", "unknown")
                code = code if isinstance(code, str) and re.fullmatch(r"[a-z_]{1,64}", code) else "unknown"
                raise SmokeFailure(f"The smoke-test run failed ({code}).")
            self.check(run.get("status") in {"queued", "running"}, "The run returned an unrecognized execution status.")
            remaining = deadline - time.monotonic()
            self.check(remaining > 0, "The run did not complete within the 60-second smoke-test deadline.")
            time.sleep(min(1, remaining))

    def download(self, run_id, file_format):
        content, headers = self.request(f"/api/etl/runs/{run_id}/download/?format={file_format}")
        self.check("attachment" in headers.get("Content-Disposition", ""), "A full-file download lacked attachment headers.")
        return content


def valid_uuid(value):
    try:
        uuid.UUID(value)
        return True
    except (TypeError, ValueError, AttributeError):
        return False


def delimited_rows(content, delimiter=","):
    try:
        return list(csv.DictReader(io.StringIO(content.decode("utf-8-sig")), delimiter=delimiter))
    except (UnicodeError, csv.Error):
        raise SmokeFailure("A downloaded delimited file could not be decoded.") from None


def sample_rows_match(actual, expected):
    if len(actual) != len(expected):
        return False
    numeric = {"total_amount", "customer_phone"}
    for actual_row, expected_row in zip(actual, expected):
        if set(actual_row) != set(expected_row):
            return False
        for key, expected_value in expected_row.items():
            try:
                if key in numeric:
                    if Decimal(str(actual_row[key])) != Decimal(str(expected_value)):
                        return False
                elif actual_row[key] != expected_value:
                    return False
            except (InvalidOperation, TypeError, ValueError):
                return False
    return True


def synthetic_csv(start, count):
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["id", "name", "amount"])
    writer.writerows((number, f"customer-{number}", number * 10) for number in range(start, start + count))
    return output.getvalue().encode("utf-8")


def smoke(base_url, report):
    def check(condition, message):
        report["assertions"] += 1
        if not condition:
            raise SmokeFailure(message)

    fixture_dir = Path(__file__).resolve().parents[1] / "backend" / "vendor" / "etl_tool"
    try:
        fixtures = {name: (fixture_dir / name).read_bytes() for name in (
            "orders_sample.csv", "customers_sample.tsv", "ket_qua_lam_sach.csv",
        )}
    except OSError:
        raise SmokeFailure("The copied ETL sample fixtures are unavailable.") from None
    expected = delimited_rows(fixtures["ket_qua_lam_sach.csv"])
    suffix = secrets.token_hex(6)
    username = f"cloudetl_smoke_{suffix}"
    outsider_name = f"cloudetl_smoke_{suffix}_outsider"
    report["usernames"] = [username, outsider_name]
    owner = LocalSession(base_url, check)
    outsider = LocalSession(base_url, check)
    owner.register(username, "Smoke-" + secrets.token_urlsafe(24) + "-9aA!")
    outsider.register(outsider_name, "Smoke-" + secrets.token_urlsafe(24) + "-9aA!")
    report["checks"].append("fresh independent accounts and real CSRF/session authentication")

    orders_id = owner.upload("orders_sample.csv", fixtures["orders_sample.csv"])
    report["dataset_ids"]["orders"] = orders_id
    customers_id = owner.upload("customers_sample.tsv", fixtures["customers_sample.tsv"])
    report["dataset_ids"]["customers"] = customers_id
    for dataset_id, row_count in ((orders_id, 5), (customers_id, 4)):
        preview = owner.json(f"/api/etl/datasets/{dataset_id}/preview/").get("preview", {})
        check(preview.get("final_rows") == row_count, "Sample extraction returned the wrong input row count.")
        check(len(preview.get("rows", [])) == min(10, row_count), "Sample extraction did not return the expected limited preview.")
    report["checks"].append("original sample CSV/TSV upload and five/four-row extraction")

    steps = [
        {"type": "join", "enabled": True, "config": {"datasetId": customers_id, "on": "order_id", "how": "left"}},
        {"type": "drop_duplicates", "enabled": True, "config": {"rules": [{"allColumns": False, "columns": ["order_id"], "keep": "first"}]}},
        {"type": "handle_null", "enabled": True, "config": {"rules": [{"column": "total_amount", "strategy": "mean"}]}},
        {"type": "replace_value", "enabled": True, "config": {"column": "city", "oldValue": "Hồ Chí Minh", "newValue": "HCM"}},
        {"type": "select_columns", "enabled": True, "config": {"selectedColumns": list(expected[0])}},
    ]
    sample_id = owner.submit(orders_id, f"Smoke sample cleanup {suffix}", steps)
    report["run_ids"]["sample_cleanup"] = sample_id
    completed = owner.await_success(sample_id)
    summary = completed.get("summary", {})
    check(summary.get("final_rows") == 4, "The sample cleanup did not produce four rows.")
    check(sample_rows_match(summary.get("rows", []), expected), "The sample result summary did not match the copied expected fixture.")
    check(Decimal(str(summary["rows"][1]["total_amount"])) == Decimal("933333.33"), "The sample mean was not 933333.33.")
    check(completed.get("configuration", {}).get("steps") == [
        {**step, "config": {"rules": [{"column": "total_amount", "strategy": "mean", "customValue": None}]}}
        if step["type"] == "handle_null" else step for step in steps
    ], "The persisted sample configuration did not preserve the ordered transformations.")

    for file_format in ("parquet", "csv", "tsv", "json", "xlsx"):
        content = owner.download(sample_id, file_format)
        if file_format == "parquet":
            check(content[:4] == b"PAR1" and content[-4:] == b"PAR1", "The Parquet download did not have valid container signatures.")
        elif file_format == "xlsx":
            check(content[:2] == b"PK", "The XLSX download did not have a ZIP container signature.")
        elif file_format in {"csv", "tsv"}:
            rows = delimited_rows(content, "\t" if file_format == "tsv" else ",")
            check(sample_rows_match(rows, expected), "The sample CSV/TSV export did not match the copied expected fixture.")
        else:
            try:
                rows = json.loads(content)
            except (ValueError, UnicodeError):
                raise SmokeFailure("The JSON result export was not valid JSON.") from None
            check(isinstance(rows, list) and len(rows) == 4, "The JSON result export did not contain four rows.")
            check(sample_rows_match(rows, expected), "The JSON result export did not match the copied expected fixture.")
        report["tested_formats"].append(file_format)
    report["checks"].append("ordered join/deduplicate/mean/replace/select sample pipeline and all five full-file exports")

    synthetic_id = owner.upload(f"smoke_paging_{suffix}.csv", synthetic_csv(1, 63))
    report["dataset_ids"]["synthetic63"] = synthetic_id
    paging_id = owner.submit(synthetic_id, f"Smoke pagination {suffix}", [])
    report["run_ids"]["pagination63"] = paging_id
    check(owner.await_success(paging_id).get("summary", {}).get("final_rows") == 63, "The paging run did not preserve all 63 rows.")
    for size, expected_counts in ((25, [25, 25, 13]), (50, [50, 13]), (100, [63])):
        ids = []
        for page, count in enumerate(expected_counts, start=1):
            data = owner.json(f"/api/etl/runs/{paging_id}/rows/?page={page}&page_size={size}")
            rows = data.get("rows", [])
            check(len(rows) == count, f"Result pagination returned an incorrect page length for size {size}.")
            check(data.get("page") == page and data.get("page_size") == size, "Result pagination returned incorrect page metadata.")
            check(data.get("total_count") == 63 and data.get("total_pages") == len(expected_counts), "Result pagination returned incorrect total metadata.")
            ids.extend(row.get("id") for row in rows)
        check(ids == list(range(1, 64)), f"Result pagination lost or reordered IDs for page size {size}.")
    full_csv = owner.download(paging_id, "csv")
    check(len(list(csv.reader(io.StringIO(full_csv.decode("utf-8-sig"))))) == 64, "The paging CSV download did not include its header and all 63 rows.")
    check([int(row["id"]) for row in delimited_rows(full_csv)] == list(range(1, 64)), "The full paging CSV download lost or reordered IDs.")
    report["checks"].append("63-row server pagination at 25/50/100 rows and complete 63-row CSV download")

    extra_id = owner.upload(f"smoke_append_{suffix}.csv", synthetic_csv(64, 3))
    report["dataset_ids"]["synthetic_extra3"] = extra_id
    append_id = owner.submit(synthetic_id, f"Smoke append {suffix}", [
        {"type": "concat", "enabled": True, "config": {"datasetIds": [extra_id]}},
    ])
    report["run_ids"]["append66"] = append_id
    check(owner.await_success(append_id).get("summary", {}).get("final_rows") == 66, "The append run did not produce 66 rows.")
    appended = owner.json(f"/api/etl/runs/{append_id}/rows/?page=1&page_size=100")
    check([row.get("id") for row in appended.get("rows", [])] == list(range(1, 67)), "Append did not preserve source and row order.")
    report["checks"].append("two-source append creates one ordered 66-row result")

    for path in (
        f"/api/etl/datasets/{orders_id}/", f"/api/etl/datasets/{orders_id}/preview/",
        f"/api/etl/runs/{sample_id}/", f"/api/etl/runs/{sample_id}/rows/",
        f"/api/etl/runs/{sample_id}/download/?format=csv",
    ):
        outsider.request(path, status=404)
    outsider_datasets = outsider.json("/api/datasets/")
    outsider_runs = outsider.json("/api/etl/runs/")
    check(outsider_datasets.get("datasets") == [] and outsider_datasets.get("total_count") == 0, "The fresh outsider account could list another account's datasets.")
    check(outsider_runs.get("runs") == [] and outsider_runs.get("total_count") == 0, "The fresh outsider account could list another account's runs.")
    anonymous = LocalSession(base_url, check)
    for path in ("/api/auth/me/", "/api/datasets/", "/api/etl/runs/", f"/api/etl/runs/{sample_id}/"):
        anonymous.request(path, status=401)
    anonymous.request("/api/etl/runs/", method="POST", payload={"name": "Rejected anonymous request", "datasetId": orders_id, "steps": []}, csrf=False, status=403)
    report["checks"].append("ownership isolation, anonymous 401 responses and real middleware CSRF403 rejection")

    for path in ("/dashboard/pipelines", "/dashboard/runs", "/dashboard/results",
                 f"/dashboard/runs/{sample_id}", f"/dashboard/results/{sample_id}"):
        html, headers = owner.request(path, accept="text/html")
        check("text/html" in headers.get("Content-Type", "") and b'id="root"' in html, "A frontend deep link did not serve the React application shell.")
    report["checks"].append("frontend pipeline/history/results and UUID deep links serve the React shell")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", type=local_base_url, default="http://localhost:8080", help="Running local stack origin (HTTP loopback only).")
    parser.add_argument("--report", type=Path, help="Write a JSON report to a new file; existing files are never overwritten.")
    args = parser.parse_args()
    if args.report and (args.report.exists() or not args.report.parent.is_dir()):
        parser.error("The report path must name a new file in an existing directory.")
    start = time.monotonic()
    report = {"status": "running", "base_url": args.base_url, "assertions": 0, "checks": [],
              "usernames": [], "dataset_ids": {}, "run_ids": {}, "tested_formats": [],
              "records_retained": True}
    try:
        smoke(args.base_url, report)
        report["status"] = "passed"
    except SmokeFailure as error:
        report["status"] = "failed"
        report["error"] = str(error)
    except Exception:
        # Unexpected responses must not leak credential-bearing request objects.
        report["status"] = "failed"
        report["error"] = "The smoke test encountered an unexpected response or local validation error."
    report["duration_seconds"] = round(time.monotonic() - start, 3)
    serialized = json.dumps(report, indent=2, ensure_ascii=False)
    if args.report:
        try:
            with args.report.open("x", encoding="utf-8") as output:
                output.write(serialized + "\n")
        except OSError:
            report["status"] = "failed"
            report["report_error"] = "The JSON report could not be saved."
            serialized = json.dumps(report, indent=2, ensure_ascii=False)
    try:
        print(serialized)
    except UnicodeEncodeError:
        print(json.dumps(report, indent=2, ensure_ascii=True))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
