# Temporary billing demo verification report

Verified and activated locally on 2026-11-19 with user approval. No real payment
provider is connected. All simulated amounts and outcomes are explicitly labelled.
See [implementation handoff](BILLING_DEMO_IMPLEMENTATION_TEMP.md).

## Executed checks

- Full Django discovery: **171 tests, 165 passed, six skipped**, 41.158 seconds,
  using disposable PostgreSQL and temporary file storage. System checks passed.
  The skips are the existing opt-in real-S3 integration tests. Vendor SHA256
  integrity checks passed; none of the eight copied tool files changed.
- New billing tests alone: **21 passed** in 2.153 seconds. Covers auth/CSRF/owner
  isolation, malformed payloads, server-owned pricing, pending-order reuse,
  success/failure/cancellation, checkout timeout, terminal conflicts, replay,
  early renewal, expired-period renewal, disabled mode and retained history.
  Also tests automatic time-based quota expiry without visiting Account,
  preserving over-quota datasets/results, legacy-Free migration normalization,
  and blocking a demo from overwriting a non-demo subscription. Two independent
  PostgreSQL-session tests prove concurrent creation reuses one pending order
  and simultaneous successful completion extends the period only once.
- Full frontend: **237 tests passed across 17 suites**, 40.849 seconds. Includes
  billing API validation/CSRF transport, demo labels, checkout outcomes, pending
  resume, loading/error/retry/401, expiry confirmation, disabled mode, duplicate
  click protection, unmount safety and Account quota/history refresh after actions.
- Frontend ESLint across `src`: passed with `--max-warnings=0`.
- Docker backend/worker/frontend build: passed. Frontend production compilation
  succeeded; existing dependency layers reused, manifests unchanged.
- Django `makemigrations --check --dry-run`: no changes detected.
- `docker compose config --quiet` and `git diff --check`: passed.

No unexpected test failures remain. No browser visual inspection was performed;
component interaction tests and actual HTTP/asset serving were verified.

## Local activation

The inspected live migration plan contained exactly:

- `accounts.0002_free_default_allowance`: change explicit legacy Free 1 GiB
  overrides to null so they follow the new 500 MiB default. Other custom/plan
  overrides remain; this does not delete user files or metadata.
- `billing.0001_initial`: create Subscription and PaymentOrder tables and their
  constraints/indexes.

Both applied with `OK`. `showmigrations accounts billing` confirms both `[X]`;
`migrate --check` completed and Django system checks reported no issues.
`docker compose up -d --wait` recreated backend, worker and frontend successfully.
The five runtime services are running, database healthy, storage-init exited 0.
Recent backend/worker logs contain no ERROR/CRITICAL/Traceback lines.

Base configuration defaults demo payments off. Local Compose explicitly enables
the demo for both web and worker. Free is 524,288,000 bytes, Premium 2,147,483,648
bytes. Real deployment must explicitly disable `BILLING_DEMO_ENABLED`.
`.env`, dependency manifests, persistent volumes and vendor tool bytes were not
modified. No commits, pushes, AWS deployment or actual charges were made.

Served production assets: `main.d1fc9129.js` and `main.f26a915c.css`.

## Live verification: 594 assertions passed

The scripts used dedicated test accounts and the actual HTTP/session/CSRF,
PostgreSQL, worker and private RustFS stack. They stored no passwords or cookies
in reports. Assertion counts include request/status checks and polling, so a later
run can have a different count while covering the same behaviors.

1. **Billing demo: 140 assertions, 5.489 seconds.** Verified Free500MiB and
   Premium2GiB, protected catalog, fixed server-owned 59,000 VND simulated amount,
   failure/cancellation preserving Free, pending reuse, ownership, successful
   upgrade, duplicate success without a second period, conflicting completion,
   early renewal adding exactly 30 days, confirmed expiry restoring Free,
   preserved uploads, owner-only history and cleanup of its test upload. Its two
   accounts and four distinct simulated payment orders/history remain; the repeated
   checkout ID in the report demonstrates pending-order reuse.
   [Raw billing report](BILLING_DEMO_SMOKE_2026-11-19.json).
2. **Account storage: 181 assertions, 9.424 seconds.** Verified 500 MiB default,
   source preview, actual Parquet output bytes, pagination, exports without double
   charging, HTTP413 at a reduced test-account allowance, replacement behavior,
   output deletion and reclaimed capacity. The test discovered/restored its own
   initial 524,288,000-byte allowance and removed its own file bytes. Two test
   accounts and completed run history remain.
   [Raw storage report](ACCOUNT_STORAGE_SMOKE_2026-11-19_DEMO.json).
3. **ETL regression: 273 assertions, 17.973 seconds.** Verified multi-source
   sample join/cleaning, expected data, all five export formats, 63-row pagination
   at 25/50/100, 66-row append, owner/session/CSRF boundaries and frontend deep
   links. This script retains two test accounts, four sources and three outputs
   for review. [Raw ETL report](DOCKER_SMOKE_2026-11-19_DEMO.json).

## Reproduce

With the existing local test image/dependencies, run the isolated suite:

```powershell
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests up -d --wait etl-test-db
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests run --rm --no-deps tests python manage.py test --settings=config.test_settings --noinput
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests run --rm --no-deps tests python manage.py makemigrations --check --dry-run --settings=config.test_settings
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests down
```

From frontend, run `npm.cmd test -- --watchAll=false --runInBand` and
`.\node_modules\.bin\eslint.cmd src --max-warnings=0`. Build after Jest finishes.

After approved local activation, a repeatable manual demo verification is:

```powershell
.\.venv\Scripts\python.exe -B scripts/billing_demo_smoke_test.py --report backend/docs/billing-demo-new-report.json
```

Use a fresh report path. This creates dedicated records and removes only its own
test upload; it never transfers money. Live smoke verification does not require
MoMo registration, API keys, a test wallet app or a public callback URL.

## Remaining scope

No genuine gateway, recurring charges, refunds, invoices or merchant integration
is implemented. A future real provider must use verified server callbacks rather
than client-selected outcomes. The demo expiry action is a local demonstration
control; natural expiry is enforced on every quota admission without a scheduler.
Hard-killed storage writers still require the existing operator reconciliation.
