# Temporary billing demo implementation handoff

Implemented and activated locally with user approval on 2026-11-19. The billing
and Free allowance migrations are applied and the rebuilt stack is running.
The full backend/frontend suites and three live smoke tests passed. See the
[billing test report](BILLING_DEMO_TEST_REPORT_TEMP.md) for executed checks.

## Scope and plans

The authenticated Account page includes **Plans and demo payments**, a local
simulation for the SaaS storage entitlement workflow:

- **Free:** 500 MiB (524,288,000 bytes) by default, without a subscription period.
  `ACCOUNT_STORAGE_LIMIT_BYTES` configures this default.
- **Premium:** 2 GiB (2,147,483,648 bytes) for a 30-day demo period.
- **Simulated price:** 59,000 VND per 30-day period. No money is charged, no real
  MoMo connection is made, and no payment credentials are collected. There is no
  automatic payment, automatic renewal, refund processing or gateway network call.

Uploads, saved Parquet results, pending cleanup and write reservations retain the
existing account-storage accounting rules. Temporary download conversions do not
create another charged stored result. The unchanged vendored ETL tool is outside
the billing implementation.

## User workflow

Open `/dashboard/account` and review profile, current allowance and usage. The
billing panel advertises Free/Premium from the server catalog and clearly labels
all checkout actions as simulated.

**Upgrade to Premium (demo)** creates a server-owned order. The checkout offers
**Simulate success**, **Simulate failure**, or **Cancel demo order**. Failure and
cancellation retain the existing entitlement. Success activates Premium and
refreshes account storage and subscription information.

Only one pending demo order is allowed per account. Repeating order creation
resumes that order rather than producing another pending charge. Checkout expires
15 minutes after creation; expired orders cannot activate Premium. Recent history
shows the latest 20 owner-scoped orders, including terminal outcomes. An unexpired
pending order can be reopened with **Resume demo checkout**, including after a
page reload. This is bounded recent history, not a complete billing ledger UI.

Replaying the same completed outcome is idempotent. A replayed successful order
does not extend the subscription twice. Trying to change a completed order to a
different outcome is rejected. **Renew Premium (demo)** requires a new order;
success adds 30 days to the later of the current time and existing period end.
There is no automatic renewal.

For demonstrations, **Expire Premium now (demo)** opens an explicit confirmation.
**Keep Premium** leaves the period intact; **Confirm demo expiry** ends the current
demo period immediately. Existing data remains saved. This control is available
only in demo mode with an active demo subscription.

## Period enforcement and storage preservation

`services/storage_service.py` resolves the effective entitlement on reads and every
storage admission. An enabled, unexpired demo subscription grants 2 GiB. Otherwise,
the account falls back to its configured/default entitlement: normally Free with
500 MiB. Explicit independently managed entitlement overrides remain applicable.

This resolution runs for upload/replacement admission and the worker's result
reservation immediately before saving a generated result. A queued ETL job does
not reserve Premium forever merely because it was submitted during an active
period. No cron job, page visit or scheduled downgrade is needed for enforcement.
The Account page is a view of this policy, not the mechanism that applies expiry.

Period expiry does not delete files, discard result history, or reset charged
usage. If existing data plus reservations exceeds the fallback allowance,
available capacity is zero and new net growth is rejected. Existing result
viewing/download and explicit deletions remain available. Equal/smaller
replacements follow the existing over-quota rules; charged pending cleanup may
still block writes until reconciliation succeeds. See the
[account storage handoff](ACCOUNT_STORAGE_IMPLEMENTATION_TEMP.md) for those rules.

Disabling the demo feature immediately removes demo Premium from subsequent
entitlement resolution, even if a stored period end is in the future. The demo
subscription/order history remains stored. Apply consistent feature configuration
to both the backend and worker so they enforce the same effective policy.

## Code and persistence

- `billing/models.py` adds `Subscription` and `PaymentOrder`; migration
  `billing/0001_initial.py` creates their PostgreSQL tables.
- `Subscription` holds one owner-bound provider and current period end. Demo
  checkout refuses to overwrite a non-demo subscription.
- `PaymentOrder` holds owner, UUID, provider, plan snapshot, amount/currency,
  30-day duration, storage snapshot, status and lifecycle timestamps. Database
  constraints validate states/positive values and prevent multiple pending demo
  orders for one owner.
- `billing/service.py` owns catalog, checkout creation/completion, idempotency,
  manual renewal, recent history and explicit demo expiry. It uses the existing
  owner-row lock to serialize entitlement changes with storage admission.
- `billing/views.py`/`urls.py` provide session-authenticated, CSRF-protected mutation
  endpoints and safe JSON errors. No client-supplied price or quota is accepted.
- `frontend/src/api/billing.js` validates responses and owns request payloads.
  `components/billing/BillingPanel.js` renders plans, outcomes, expiry confirmation
  and history inside `AccountPage`. It refreshes account usage after successful
  activation or explicit expiry. Errors, retry, loading, duplicate-click prevention
  and request cleanup follow the existing frontend approach.

The additional data migration `accounts/0002_free_default_allowance.py` normalizes
only `AccountEntitlement` records with `plan_code="free"` and an explicit
`storage_limit_bytes=1073741824` (the former 1 GiB default) to `NULL`, so they follow
the current Free setting. Other explicit allowances and other plan codes remain
unchanged. The migration does not change file bytes or remove datasets/results.
Its reverse is a no-op: it does not reconstruct which normalized records
previously stored the old default explicitly. Review this data change before
application migration approval.

## API contract

All endpoints use the existing session cookie. POST requires the existing CSRF
token/header flow and `application/json`. Responses are private/no-store and
ownership always comes from the authenticated user.

- `GET /api/billing/`: returns `demo_enabled`, the server `plans` catalog,
  `subscription` (`status` of `free`, `active` or `expired`, plus nullable
  `current_period_end`), and the latest 20 `orders`.
- `POST /api/billing/demo/orders/` with `{"plan_code":"premium"}`: HTTP 201
  `{"order": ...}` for a newly created or resumed pending order. Plan price,
  allowance and period are assigned server-side.
- `POST /api/billing/demo/orders/<order-uuid>/complete/` with
  `{"outcome":"succeeded"}`, `{"outcome":"failed"}` or
  `{"outcome":"cancelled"}`: HTTP 200 with the completed order, or the same
  terminal order for an identical replay.
- `POST /api/billing/demo/expire/` with `{}`: HTTP 200 `{"expired":true}` after
  explicitly ending an active demo period.

Public orders include ID, plan code/name, amount VND, currency, period days, status,
created/expiry timestamps and nullable completion timestamp. They expose neither
credentials nor object-storage references. An elapsed pending checkout is presented
as expired; subsequent checkout creation also persists expiry before creating a
replacement pending order.

Relevant errors include unauthenticated HTTP 401; disabled demo HTTP 403
`demo_disabled`; invalid plan/outcome HTTP 400; other-owner or unknown order HTTP
404 `order_not_found`; already completed conflicting outcome HTTP 409
`order_finished`; expired checkout HTTP 410 `checkout_expired`; and HTTP 409 when
there is no active demo period to expire or a non-demo subscription conflicts.
Quota rejection remains the existing HTTP 413 `storage_quota_exceeded`.

## Environment and deployment boundary

`BILLING_DEMO_ENABLED` defaults to **false** in Django and base `compose.yaml`.
The local `compose.override.yaml` explicitly defaults it to **true** for both
backend and worker through the shared development environment mapping. Test
settings enable it for isolated checks. `.env.example` leaves the flag commented
so copying the example does not accidentally override the local default.

For any deployment, explicitly set **`BILLING_DEMO_ENABLED=false`** for both backend
and worker, and use the intended deployment Compose files. Do not rely only on
the base default while loading the local override: that override enables the
simulator unless the explicit environment value disables it. No secret is needed
by the demo. Source configuration changes alone do not update running processes.

Real payment integration requires a separate payment provider boundary, validated
server-created orders, server-held credentials, verified/signed provider webhooks,
ownership/amount/currency checks, replay protection and a deliberate subscription
policy. Do not expose this demo's client-selected success endpoint as a real
payment completion mechanism, or connect it directly to real MoMo transactions.

## Activation and verification

After user approval, backend/worker/frontend images built successfully and both
reviewed migrations applied successfully. The five runtime services are running;
PostgreSQL is healthy and storage-init exited 0. No secrets or volumes changed.
Production demo mode must remain disabled. The local Account page is available at
`http://localhost:8080/dashboard/account`.

Executed checks: 171 backend tests (165 passed, six opt-in S3 skips), 237 frontend
tests, full frontend ESLint, production Docker build, migration consistency and
594 live assertions across billing, account storage and ETL. Details and raw
reports are linked in [the billing test report](BILLING_DEMO_TEST_REPORT_TEMP.md).

`scripts/billing_demo_smoke_test.py` is the new manual local-stack check. It creates
fresh dedicated accounts, exercises real HTTP/session/CSRF/database paths through
simulated failure/cancellation/success/replay/renewal/expiry and owner isolation,
uploads a tiny test file, and deletes only that test file. It retains demo
payment/subscription history and test-account records and charges no money.
It requires a new report filename, for example after approved activation:

```powershell
python scripts/billing_demo_smoke_test.py --base-url http://localhost:8080 --report backend/docs/billing-demo-live-report.json
```

Use a new report path when rerunning; do not overwrite historical JSON reports.
The separate
`scripts/account_storage_smoke_test.py` now discovers and restores the server's
initial default allowance rather than assuming the former 1 GiB default.
