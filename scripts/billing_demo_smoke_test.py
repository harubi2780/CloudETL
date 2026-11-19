"""Manual local demo-billing check. Creates two test accounts; charges no money.

Exercises the real HTTP/CSRF/database stack. Retains simulated payment/history
records but deletes its own uploaded file. Never records credentials or cookies.
"""
import argparse
from datetime import datetime, timedelta
import json
from pathlib import Path
import secrets
import sys
import time
import uuid

from docker_smoke_test import LocalSession, SmokeFailure, local_base_url


def smoke(base_url, report):
    def check(condition, message):
        report["assertions"] += 1
        if not condition:
            raise SmokeFailure(message)

    owner, other = LocalSession(base_url, check), LocalSession(base_url, check)
    suffix = uuid.uuid4().hex[:12]
    for session, role in ((owner, "owner"), (other, "other")):
        username = f"billing_demo_{suffix}_{role}"
        session.register(username, "Demo-" + secrets.token_urlsafe(24) + "-9aA!")
        report["usernames"].append(username)

    def profile():
        return owner.json("/api/account/")["account"]

    def checkout():
        order = owner.json("/api/billing/demo/orders/", method="POST", payload={"plan_code": "premium"}, status=201)["order"]
        report["order_ids"].append(order["id"])
        check(order["status"] == "pending" and order["amount_vnd"] == 59000 and order["currency"] == "VND",
              "Checkout did not use the server-owned demo price.")
        return order

    def complete(order, outcome, status=200):
        return owner.json(f"/api/billing/demo/orders/{order['id']}/complete/", method="POST", payload={"outcome": outcome}, status=status)

    free = profile()
    check(free["plan"]["code"] == "free" and free["storage"]["limit_bytes"] == 500 * 1024**2,
          "Free allowance is not 500 MiB.")
    overview = owner.json("/api/billing/")
    check(overview["demo_enabled"] is True, "Local demo mode is not enabled.")
    check(overview["plans"][1]["storage_limit_bytes"] == 2 * 1024**3, "Premium catalog does not offer 2 GiB.")
    LocalSession(base_url, check).request("/api/billing/", status=401)
    owner.request("/api/billing/demo/orders/", method="POST", payload={"plan_code": "premium"}, csrf=False, status=403)
    owner.json("/api/billing/demo/orders/", method="POST", payload={"plan_code": "premium", "amount_vnd": 1}, status=400)
    report["checks"].append("Free500MiB/Premium2GiB catalog, authenticated demo mode, CSRF and server-owned price")

    for outcome in ("failed", "cancelled"):
        order = checkout()
        check(complete(order, outcome)["order"]["status"] == outcome, "Simulated outcome did not persist.")
        check(profile()["plan"]["code"] == "free", "An unsuccessful payment granted Premium.")
    order = checkout()
    check(checkout()["id"] == order["id"], "Repeated checkout created duplicate pending orders.")
    other.request(f"/api/billing/demo/orders/{order['id']}/complete/", method="POST", payload={"outcome": "succeeded"}, status=404)
    check(complete(order, "succeeded")["order"]["status"] == "succeeded", "Successful demo payment did not persist.")
    premium = profile()
    check(premium["plan"]["code"] == "premium" and premium["storage"]["limit_bytes"] == 2 * 1024**3,
          "Successful demo payment did not grant 2 GiB.")
    first_end = owner.json("/api/billing/")["subscription"]["current_period_end"]
    complete(order, "succeeded")
    check(owner.json("/api/billing/")["subscription"]["current_period_end"] == first_end,
          "Replaying a successful payment extended access again.")
    complete(order, "failed", status=409)
    renewed = checkout()
    complete(renewed, "succeeded")
    second_end = owner.json("/api/billing/")["subscription"]["current_period_end"]
    check(datetime.fromisoformat(second_end) - datetime.fromisoformat(first_end) == timedelta(days=30),
          "Early renewal did not extend the existing end by 30 days.")
    report["checks"].append("failure/cancellation, pending reuse, owner isolation, successful upgrade, idempotency and 30-day renewal")

    dataset_id = owner.upload("billing-demo.csv", b"id,value\n1,demo\n")
    report["dataset_id"] = dataset_id
    used = profile()["storage"]["used_bytes"]
    check(used == 16, "Uploaded file bytes are incorrect.")
    check(owner.json("/api/billing/demo/expire/", method="POST", payload={})["expired"] is True,
          "Demo expiry did not complete.")
    expired = profile()
    check(expired["plan"]["code"] == "free" and expired["storage"]["limit_bytes"] == 500 * 1024**2,
          "Expiry did not restore Free500MiB.")
    check(expired["storage"]["used_bytes"] == used and owner.json("/api/datasets/")["total_count"] == 1,
          "Expiry removed an existing file.")
    check(owner.json("/api/billing/")["subscription"]["status"] == "expired", "Expiry status was not visible.")
    check(len(owner.json("/api/billing/")["orders"]) == 4, "Demo payment history did not retain all four orders.")
    check(other.json("/api/billing/")["orders"] == [], "Payment history leaked across accounts.")
    owner.json(f"/api/datasets/{dataset_id}/", method="DELETE")
    check(profile()["storage"]["used_bytes"] == 0, "Test file cleanup left charged bytes.")
    report["checks"].append("expiry returns Free without deleting files, persistent owner-only history and test-file cleanup")
    report["test_file_removed"] = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", type=local_base_url, default="http://localhost:8080")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.report.exists() or not args.report.parent.is_dir():
        parser.error("Choose a new report file in an existing directory.")
    started = time.monotonic()
    report = {"status": "running", "assertions": 0, "checks": [], "usernames": [], "order_ids": [], "test_file_removed": False}
    try:
        smoke(args.base_url, report)
        report["status"] = "passed"
    except SmokeFailure as error:
        report.update(status="failed", error=str(error))
    except Exception:
        report.update(status="failed", error="Unexpected local response; no private details recorded.")
    report["duration_seconds"] = round(time.monotonic() - started, 3)
    serialized = json.dumps(report, indent=2) + "\n"
    with args.report.open("x", encoding="utf-8") as output:
        output.write(serialized)
    print(serialized)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
