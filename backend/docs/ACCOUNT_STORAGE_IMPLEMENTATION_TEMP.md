# Temporary account storage implementation handoff

Follow-up 2026-11-19: the current plans are Free500MiB and Premium2GiB with a local
payment simulator. The 1 GiB descriptions below record the original integration.
See [current billing handoff](BILLING_DEMO_IMPLEMENTATION_TEMP.md).

Implemented and activated locally with user approval on 2026-11-18.
All buildable Compose images were rebuilt, `accounts.0001_initial` was applied,
and the five runtime services are running. PostgreSQL is healthy. Live ETL and
quota smoke tests passed 255 and 175 assertions respectively.
See [verification report](ACCOUNT_STORAGE_TEST_REPORT_TEMP.md).

## Product behavior

- Every account defaults to **1 GiB (1,073,741,824 bytes)** across saved uploaded
  datasets and stored canonical Parquet results. Existing metadata counts
  automatically; there is no per-account initialization or destructive backfill.
- Database metadata, bounded previews, temporary parser/export files, browser
  downloads, and transient replacement staging do not count as another saved
  file. This is a logical file allowance, not an infrastructure disk quota.
- Uploads reserve their full size before storing bytes. Replacements reserve
  `max(new_size - current_size, 0)` and retain the original until publication.
  A file with an active replacement cannot be replaced or deleted again.
- Workers calculate the actual Parquet size, reserve capacity, store it, then
  publish the success and remove the reservation in one owner-locked transaction.
  A job may be queued successfully and later fail with `storage_quota_exceeded`
  if its output does not fit when execution finishes. Sources remain available.
- Download conversions do not persist another object or consume more allowance.
- Deleting a dataset removes its source. Deleting a result removes only its
  output file; run status, configuration, timestamps and summary remain available.
  The original sources are preserved. Deleted result reads return `result_deleted`.
- Failed object deletion retains its full charge and returns a safe warning.
  At a full account with pending cleanup, new writes (including replacements)
  wait for space or cleanup. This prevents repeated equal-size replacements from
  accumulating uncharged files. Ordinary legacy over-limit accounts can keep
  data, delete data, and replace with equal/smaller files if no such cleanup blocks
  them. Allowance changes never automatically delete user data.

## Architecture and extension point

The standard Django User remains the authentication model. `accounts/models.py`
adds two separate models in `accounts.0001_initial`:

- `AccountEntitlement`: optional one-to-one record, plan code/name and nullable
  explicit storage allowance. Missing records and null allowances use
  `ACCOUNT_STORAGE_LIMIT_BYTES`; default plan is Free. It is independent of billing.
- `StorageReservation`: durable owner, operation target, private object key, full
  size, reserved growth, state and timestamp. A partial unique constraint permits
  only one live writer per owner/target. Cleanup rows are deliberately retained
  until deletion succeeds.

`services/storage_service.py` centralizes entitlement lookup, usage aggregation,
admission, cleanup and internal `set_storage_entitlement(...)`. A future verified
subscription handler can call this function to set the account's effective limit
and plan. Implement provider verification, billing records and lifecycle rules
when that feature is requested. No checkout, payment SDK, subscriptions, webhooks,
paid tier promises or client-writable allowance endpoint were added here.

Every quota admission and metadata publication takes a PostgreSQL row lock on
the existing owner User. Concurrent web processes and worker processes therefore
share capacity. All callers of `reserve_locked`, `usage_locked`, and
`mark_cleanup_locked` must hold `owner_storage_lock`. Storage/network I/O occurs
outside the owner lock. Never replace these locks with process-local counters.

`used_bytes = uploads + referenced results + pending cleanup`.
`available_bytes = max(0, limit - used - writing reservations)`.
Usage is derived from current Dataset/ETLRun metadata and reservation rows;
there is no cached counter to backfill or drift. Orphans created before this
feature, outside the application, or by direct storage writes cannot be discovered
from these tables and need independent object-store reconciliation.

Dataset create/replace/delete and ETL publication/deletion use the shared service.
Claim-token fencing still controls worker publication. A stale or failed worker
cleans only its attempt's output. Abandonment respects an already committed
replacement's cleanup row, so a lost acknowledgement cannot redirect cleanup
toward its newly published file. All original vendor tool files remain untouched.

## API and UI

`GET /api/account/` is authenticated, read-only, owner-scoped and never cached.
It returns `account` with `id`, `username`, `email`, `status`, `joined_at`,
`plan: {code, name}`, and `storage`:

```json
{
  "limit_bytes": 1073741824,
  "used_bytes": 0,
  "uploaded_bytes": 0,
  "result_bytes": 0,
  "pending_cleanup_bytes": 0,
  "reserved_bytes": 0,
  "available_bytes": 1073741824,
  "over_limit": false
}
```

The dataset list gains the same `storage` object. Upload/replacement errors use
HTTP 413, `storage_quota_exceeded`, and `error.fields.storage` containing the usage
plus `required_bytes` (projected growth). Concurrent updates to one file use 409
`file_busy`. Private object keys and hashes are never exposed in these responses.

Public run metadata gains `result_available`. `download_url` is null for removed
outputs. `DELETE /api/etl/runs/<uuid>/result/` requires owner authentication and
CSRF, is restricted to successful runs, and returns `{deleted: true}` plus an
optional cleanup warning. Repeating deletion of an already removed output is
idempotent. Rows/download endpoints return 404 `result_deleted` after deletion.

React `/dashboard/account` uses `api/account.js` and displays read-only profile,
active status, joined date, plan, used/available storage and its breakdown.
The sidebar includes Account. Shared `StorageUsage` renders the account meter
and compact Datasets meter; dataset mutations refresh server totals. Loading,
retry, stale totals, errors and expired sessions are handled explicitly.
Result detail requires confirmation before deleting; removed outputs hide row
and download controls while the history links remain. No dependencies were added.

## Cleanup operations

Inspect pending detached-object cleanup without changing storage:

```sh
docker compose exec backend python manage.py cleanup_storage_objects
docker compose exec backend python manage.py cleanup_storage_objects --owner-id 123
```

After approval to delete these already detached objects, retry cleanup:

```sh
docker compose exec backend python manage.py cleanup_storage_objects --owner-id 123 --apply
```

Successful deletion releases the matching reservation's charge. Failed deletion
keeps it. The command never cleans WRITING reservations. No cleanup scheduler was
installed; operations must retry pending cleanup when warned.

A process killed during a write can leave a WRITING reservation and consume
capacity or block a replacement. Do not expire it by age or blindly remove it:
the object may already exist. An operator must first fence/stop the writer,
verify its exact key and any Dataset/ETLRun reference, then reconcile under the
owner lock. Unreferenced objects must be moved to charged cleanup before using
the retry command; referenced bytes must remain represented in metadata.
Provider-specific object version retention and bucket lifecycle policy remain
separate from the logical account allowance.

## Local activation completed on 2026-11-18

The new migration creates two tables, their indexes and constraints; it does not
alter or delete datasets/results and does not edit secrets or persistent volumes.
The initial read-only preview failed while PostgreSQL was stopped. After approval,
infrastructure started successfully and the live plan showed only the two account
models. The migration applied successfully. `showmigrations accounts` shows
`[X] 0001_initial`; `migrate --check` exits successfully; `manage.py check` reports
no issues. Storage initialization exited 0, backend/worker/frontend/RustFS are
running, and PostgreSQL is healthy. No database reset was necessary.

The approved activation used the configured credentials and existing volumes.
For a later installation, inspect any unexpected pending migrations before
applying changes, and obtain approval for that environment:

```sh
docker compose build
docker compose up -d --wait db rustfs
docker compose run --rm --no-deps backend python manage.py migrate --plan
docker compose run --rm --no-deps backend python manage.py migrate accounts --noinput
docker compose up -d --wait
docker compose ps
```

Existing installations already have the private `datasets/*` and `etl/*` storage
policy. For a fresh installation, follow the existing storage initialization and
full initial migration runbook instead. Do not delete volumes, run migration
rollback against live data, or change credentials to activate this feature.

Live checks verified an authenticated Free/1 GiB profile, source upload, previews,
worker processing, pagination, all five downloads, quota rejection, equal-size
replacement and reclaimed result space. `scripts/account_storage_smoke_test.py`
uses dedicated accounts, temporarily lowers only its fresh test account's limit
through the internal entitlement service, verifies HTTP 413, restores 1 GiB and
removes its own test files. It retains account/run-history records and records
no passwords or cookies. The general ETL smoke test retains its separate four
uploads and three results for review. Raw reports:
[ETL smoke](DOCKER_SMOKE_2026-11-18_STORAGE.json) and
[storage smoke](ACCOUNT_STORAGE_SMOKE_2026-11-18.json).

## Affected source

- New `backend/accounts/` models, migration, profile endpoint and cleanup command.
- New `backend/services/storage_service.py`; changes to dataset/ETL services and
  views, config/URL settings, Compose environment and `.env.example` (not `.env`).
- New quota/account/concurrency tests and dataset API assertion updates.
- New frontend account API/page/styles/tests and shared storage UI/tests;
  route wiring, Datasets meter, result deletion/availability and their tests.
- README/frontend handoff links and these temporary implementation/test reports.
- New `scripts/account_storage_smoke_test.py` for repeatable live quota verification
  and the two JSON smoke reports.

AWS deployment, browser visual verification, the separate opt-in S3 integration
suite, billing and automatic recovery of killed writers remain outside this work.
Real private RustFS persistence/cleanup was verified through the running stack.
