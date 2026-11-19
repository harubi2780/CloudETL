"""Explicit manual smoke test for account storage on the local Docker stack.

Creates two dedicated accounts. Only the first account's allowance is temporarily
lowered to exercise real HTTP quota rejection without filling its default allowance.
Restores that original allowance and removes only this script's own uploaded/result files.
Account and run-history records remain. Never records passwords or session tokens.
Requires Docker Compose access for the internal test-account entitlement setup.
"""
import argparse
import json
import re
import secrets
import subprocess
import sys
import time
import uuid
from pathlib import Path

from docker_smoke_test import LocalSession, SmokeFailure, local_base_url

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def set_test_allowance(owner_id, limit):
    if type(owner_id) is not int or owner_id <= 0 or type(limit) is not int or limit <= 0:
        raise SmokeFailure("Invalid test-account allowance setup.")
    # Numeric values are validated above. No credentials or user-entered strings
    # are interpolated, and subprocess runs an argv list without a shell.
    code = (
        "from django.contrib.auth import get_user_model; "
        "from services.storage_service import set_storage_entitlement; "
        f"user = get_user_model().objects.get(pk={owner_id}); "
        f"set_storage_entitlement(user, limit_bytes={limit}); "
        "print('smoke-allowance-updated')"
    )
    try:
        outcome = subprocess.run(
            ["docker", "compose", "exec", "-T", "backend", "python", "manage.py", "shell", "-c", code],
            cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=30, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise SmokeFailure("Could not configure the dedicated smoke account's allowance.") from None
    if outcome.returncode or "smoke-allowance-updated" not in outcome.stdout:
        raise SmokeFailure("Dedicated smoke account allowance update failed.")


def post_file(session, path, content, *, status=201):
    boundary = "cloudetl-quota-" + secrets.token_hex(16)
    data = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="quota.csv"\r\n'
            "Content-Type: text/csv\r\n\r\n").encode("ascii")
    data += content + f"\r\n--{boundary}--\r\n".encode("ascii")
    return session.json(path, method="POST", content=data,
                        content_type=f"multipart/form-data; boundary={boundary}", status=status)


def smoke(base_url, report):
    def check(condition, message):
        report["assertions"] += 1
        if not condition:
            raise SmokeFailure(message)

    anonymous = LocalSession(base_url, check)
    anonymous.request("/api/account/", status=401)
    suffix = uuid.uuid4().hex[:12]
    owner = LocalSession(base_url, check)
    outsider = LocalSession(base_url, check)
    for session, role in ((owner, "owner"), (outsider, "other")):
        name = f"quota_smoke_{suffix}_{role}"
        session.register(name, "Quota-" + secrets.token_urlsafe(24) + "-9aA!")
        report["usernames"].append(name)
    account = owner.json("/api/account/")["account"]
    owner_id = account["id"]
    initial_limit = account["storage"]["limit_bytes"]
    check(account["status"] == "active" and account["plan"] == {"code": "free", "name": "Free"},
          "The new account did not report active Free status.")
    check(type(initial_limit) is int and initial_limit > 0 and account["storage"]["used_bytes"] == 0,
          "The new account did not start with a valid default allowance and zero usage.")
    check(account["storage"]["available_bytes"] == initial_limit, "Initial storage availability is incorrect.")
    html, _ = owner.request("/dashboard/account", accept="text/html")
    check(b'id="root"' in html, "Account deep link did not serve the React application.")
    assets = re.findall(rb'(?:src|href)="(/static/[^\"]+)"', html)
    check(bool(assets), "The application shell did not reference production assets.")
    report["frontend_assets"] = [asset.decode("ascii") for asset in assets]
    for asset in report["frontend_assets"]:
        body, _ = owner.request(asset, accept="*/*")
        check(bool(body), "A production frontend asset was empty.")
    report["checks"].append("active Free account, server-configured default allowance, account deep link and production assets")

    content = b"id,value\n" + b"".join(f"{number},A\n".encode("ascii") for number in range(1, 64))
    dataset_id = owner.upload("quota.csv", content)
    report["dataset_ids"].append(dataset_id)
    storage = owner.json("/api/account/")["account"]["storage"]
    check(storage["uploaded_bytes"] == len(content) and storage["used_bytes"] == len(content),
          "Uploaded bytes were not charged exactly once.")
    preview = owner.json(f"/api/etl/datasets/{dataset_id}/preview/")["preview"]
    check(len(preview["rows"]) == 10 and preview["final_rows"] == 63, "Source preview was not limited to ten rows.")
    run_id = owner.submit(dataset_id, "Quota smoke result " + suffix, [])
    report["run_ids"].append(run_id)
    run = owner.await_success(run_id)
    check(run.get("result_available") is True, "Completed output was not available.")
    result = owner.download(run_id, "parquet")
    check(result.startswith(b"PAR1") and result.endswith(b"PAR1"), "The result is not a valid Parquet container.")
    result_size = len(result)
    total = len(content) + result_size
    storage = owner.json("/api/account/")["account"]["storage"]
    check(storage["used_bytes"] == total and storage["result_bytes"] == result_size,
          "Account totals did not match uploaded and actual result bytes.")
    check(storage["reserved_bytes"] == 0 and storage["pending_cleanup_bytes"] == 0,
          "Successful publication left charged reservations.")
    check(owner.json("/api/datasets/")["storage"] == storage, "Dataset and account totals differ.")
    rows = owner.json(f"/api/etl/runs/{run_id}/rows/?page=3&page_size=25")
    check(len(rows["rows"]) == 13 and rows["total_count"] == 63, "Result pagination returned incorrect rows.")
    owner.download(run_id, "csv")
    check(owner.json("/api/account/")["account"]["storage"] == storage, "Download conversion charged extra storage.")
    report["measured_bytes"] = {"upload": len(content), "parquet_result": result_size, "combined": total}
    report["checks"].append("real private storage upload, ten-row preview, worker Parquet publication, pagination and quota totals")

    try:
        set_test_allowance(owner_id, total)
        limited = owner.json("/api/account/")["account"]["storage"]
        check(limited["available_bytes"] == 0 and limited["limit_bytes"] == total,
              "The internal entitlement change was not reflected in the API.")
        rejected = post_file(owner, "/api/datasets/", b"id\n1\n", status=413)["error"]
        check(rejected["code"] == "storage_quota_exceeded", "A full account accepted another upload.")
        check(rejected["fields"]["storage"]["available_bytes"] == 0,
              "Quota rejection did not include remaining capacity.")
        oversized = post_file(owner, f"/api/datasets/{dataset_id}/replace/", content + b"64,A\n", status=413)
        check(oversized["error"]["code"] == "storage_quota_exceeded", "A full account accepted replacement growth.")
        replaced = post_file(owner, f"/api/datasets/{dataset_id}/replace/", content.replace(b",A", b",B"), status=200)
        check(replaced["dataset"]["size_bytes"] == len(content) and not replaced.get("warning"),
              "An equal-size replacement did not complete and clean the old source.")
        check(owner.json("/api/account/")["account"]["storage"] == limited,
              "An equal-size replacement double-charged storage.")
        report["checks"].append("internal entitlement extension point, full-quota HTTP 413, replacement growth rejection and equal-size replacement")

        other_account = outsider.json(f"/api/account/?owner_id={owner_id}")["account"]
        check(other_account["id"] != owner_id and other_account["storage"]["used_bytes"] == 0,
              "An account could request another owner's profile or usage.")
        url = f"/api/etl/runs/{run_id}/result/"
        outsider.request(url, method="DELETE", status=404)
        owner.request(url, method="DELETE", status=403, csrf=False)
        deleted = owner.json(url, method="DELETE")
        check(deleted.get("deleted") is True and not deleted.get("warning"), "Result cleanup did not complete.")
        after = owner.json("/api/account/")["account"]["storage"]
        check(after["used_bytes"] == len(content) and after["result_bytes"] == 0,
              "Deleting the result did not release its exact byte charge.")
        check(after["available_bytes"] == result_size and after["pending_cleanup_bytes"] == 0,
              "Reclaimed result capacity is incorrect.")
        removed = owner.json(f"/api/etl/runs/{run_id}/")["run"]
        check(removed["status"] == "succeeded" and removed["result_available"] is False and removed["download_url"] is None,
              "Removed output remained available or changed run status.")
        check(removed["summary"] == run["summary"] and removed["configuration"] == run["configuration"],
              "Result deletion changed retained history.")
        for suffix in ("rows/", "download/"):
            error = owner.json(f"/api/etl/runs/{run_id}/{suffix}", status=404)["error"]
            check(error["code"] == "result_deleted", "Deleted result was still readable.")
        check(owner.json(url, method="DELETE").get("deleted") is True, "Result deletion was not idempotent.")
        extra_id = owner.upload("reclaimed.csv", b"id\n1\n")
        report["dataset_ids"].append(extra_id)
        check(owner.json("/api/account/")["account"]["storage"]["used_bytes"] == len(content) + 5,
              "Reclaimed capacity could not be reused for an upload.")
        report["checks"].append("profile/ownership/CSRF isolation, result deletion, retained history, deleted-read rejection and capacity reuse")

        for identifier in report["dataset_ids"]:
            check(owner.json(f"/api/datasets/{identifier}/", method="DELETE").get("deleted") is True,
                  "A dedicated test upload could not be removed.")
        final = owner.json("/api/account/")["account"]["storage"]
        check(final["used_bytes"] == 0 and final["reserved_bytes"] == 0 and final["pending_cleanup_bytes"] == 0,
              "Dedicated test files left charged bytes after cleanup.")
        report["test_files_removed"] = True
    finally:
        set_test_allowance(owner_id, initial_limit)
        report["test_allowance_restored_bytes"] = initial_limit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", type=local_base_url, default="http://localhost:8080")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.report.exists() or not args.report.parent.is_dir():
        parser.error("Use a new report file in an existing directory.")
    report = {"status": "running", "base_url": args.base_url, "assertions": 0, "checks": [],
              "usernames": [], "dataset_ids": [], "run_ids": [], "test_files_removed": False}
    started = time.monotonic()
    try:
        smoke(args.base_url, report)
        report["status"] = "passed"
    except SmokeFailure as error:
        report.update(status="failed", error=str(error))
    except Exception:
        report.update(status="failed", error="Unexpected local smoke-test response; no private details recorded.")
    report["duration_seconds"] = round(time.monotonic() - started, 3)
    serialized = json.dumps(report, indent=2, ensure_ascii=True) + "\n"
    try:
        with args.report.open("x", encoding="utf-8") as output:
            output.write(serialized)
    except OSError:
        print("Could not write the smoke-test report.", file=sys.stderr)
        return 1
    print(serialized)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
