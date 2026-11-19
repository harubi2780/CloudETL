# Temporary account storage verification report

Verified and activated locally with user approval on 2026-11-18. The migration is
applied and the rebuilt stack is running. See
[implementation and operations handoff](ACCOUNT_STORAGE_IMPLEMENTATION_TEMP.md).

## Executed checks and results

- Full Django default discovery against isolated PostgreSQL: **149 tests, 143
  passed, 6 skipped**, 27.877 seconds. No system check issues. The test database
  applied the new accounts migration and was destroyed after the run. Tests used
  temporary filesystem storage, not application datasets or application credentials.
- Full frontend Jest: **15 suites, 197 tests passed**, 27.393 seconds.
- ESLint across all frontend `src`: passed with `--max-warnings=0`.
- Local React production build: compiled successfully.
- Docker builds for backend, ETL worker and frontend: passed; existing dependency
  layers were reused and no dependency manifests changed.
- Django `makemigrations --check --dry-run`: **No changes detected**.
- Separate private object-store policy unittest: **1 test passed**.
- `docker compose config --quiet`: passed without displaying resolved secrets.
- `git diff --check`: passed. All eight preserved vendor files passed their SHA256
  integrity test in the full backend suite; no vendor diff exists.

The first focused quota run passed all 30 then-existing new tests. The first full
backend run passed 147 tests with 6 skipped. Review added one acknowledgement/cleanup
regression test and one complete simultaneous-upload test, giving the final 149
above. No unexpected test failures remain. Expected storage/database failure
simulations return safe API errors or charged cleanup warnings as asserted.

The six skipped tests are the existing opt-in real-object-storage integration
tests (`CLOUDETL_TEST_OBJECT_STORAGE` was not enabled). The subsequent live smoke
tests below verified private RustFS through the actual application. Browser visual
verification and AWS S3 verification were not performed.

## New backend coverage

`tests/test_accounts.py` covers the default 1 GiB setting, valid/invalid setting
boundaries, account authentication, owner isolation, read-only requests, no-store
responses, sanitized database errors, existing upload/result sizes, reserved bytes,
pending cleanup, Free/default entitlement, explicit larger future allowance,
nullable default fallback, invalid entitlement changes and allowance reductions
below existing usage without deleting files.

`tests/test_storage_quota.py` covers exact admission boundaries and rejection
before storage, structured quota errors, replacement growth, equal/smaller legacy
replacements, deletion/reclamation, failed cleanup retaining its charge, retry
cleanup dry-run/application, preventing repeated replacement growth during failed
cleanup, partial writes whose save call raises, insert plus cleanup failures,
same-file mutation conflicts, cleanup isolation, and protecting a published
replacement after an ambiguous acknowledgement.

Worker/API coverage includes actual Parquet bytes at the shared upload/output
boundary, quota failure before result storage, downloads in all five formats
without double charging, result deletion retaining configuration/history/summary,
deleted-result read errors, authentication/ownership/CSRF checks, pending-run
rejection, idempotent deletion, failed result cleanup and partial result writes.

`tests/test_storage_quota_concurrency.py` opens independent PostgreSQL sessions
with distinct backend PIDs and bounded thread joins. It proves two reservations
cannot overbook the owner, simultaneous replacements of one target conflict,
another owner's admission is not blocked by the first owner's row lock, and two
actual upload/save/publication service calls admit only one when only one fits.

Existing source validation, ETL adapter, token fencing, real worker subprocess,
queue concurrency, browsing, authentication and storage-policy tests also ran.

## Frontend coverage

New account API, AccountPage and StorageUsage tests cover payload validation,
request abort, read-only values, plan/usage breakdown, zero/full/over-limit/reserved
states, loading/retry/401 handling, route guarding/sidebar navigation, and stale
dataset totals. Dataset tests confirm quota updates after upload/deletion and
clear quota errors.

Result tests cover confirmation-before-delete, cancellation/focus, busy state,
duplicate-click protection, failure/401, cleanup warning, local success and
already-removed outputs. They also check hidden row/download/view controls,
preserved history/configuration links, CSRF-aware DELETE transport and stale
completion isolation when switching runs. Existing mocks without the new
availability flag remain compatible while the real API always sends it.

## Runtime activation and live verification

Initially all five existing application services were stopped. The initial
read-only migration preview failed to resolve host `db`; no migration executed
during that failed preview. After the user approved migration and Docker rebuild,
the following commands completed successfully:

```sh
docker compose build
docker compose up -d --wait db rustfs
docker compose run --rm --no-deps backend python manage.py migrate --plan
docker compose run --rm --no-deps backend python manage.py migrate accounts --noinput
docker compose up -d --wait
docker compose exec -T backend python manage.py showmigrations accounts
docker compose exec -T backend python manage.py migrate --check
docker compose exec -T backend python manage.py check
```

All five buildable images rebuilt successfully (database, storage-init, backend,
worker and frontend). The live plan contained only `accounts.0001_initial` and its
two models. Migration output was `Applying accounts.0001_initial... OK`.
`showmigrations` shows `[X] 0001_initial`, `migrate --check` exits 0, and Django's
system check reports no issues. Existing volumes and `.env` were not changed;
no reset, commits, pushes or AWS deployment were needed.

Final service state: backend, etl-worker, frontend and RustFS running; PostgreSQL
running and healthy; one-shot storage-init exited 0. Recent backend/worker logs
contain no ERROR, CRITICAL or Traceback lines.

`scripts/docker_smoke_test.py` passed **255 assertions** in 16.731 seconds using
the actual HTTP/session/CSRF/worker/private-RustFS stack. It covered sample
multi-source join/cleanup, expected values, all five full-file exports, 63-row
pagination at 25/50/100, 66-row append, owner isolation and React deep links.
Its two dedicated accounts, four sources and three results remain for review.
Raw [ETL smoke report](DOCKER_SMOKE_2026-11-18_STORAGE.json).

New `scripts/account_storage_smoke_test.py` passed **175 assertions** in 8.579
seconds. It verified active Free/1 GiB profiles, account deep link/assets, actual
source/output byte charges, ten-row preview, worker publication, result paging,
downloads without extra charges, dataset/account totals, full-quota HTTP 413,
replacement growth rejection and equal-size replacement. It also verified CSRF
and owner isolation, result deletion preserving summary/configuration/history,
deleted reads returning `result_deleted`, idempotence and reclaimed space reuse.

The quota test temporarily lowered only its new test account's allowance using
the internal entitlement setter and restored it to 1 GiB in a finally block.
The measured source was 315 bytes, Parquet was 1,953 bytes, shared use 2,268 bytes.
Its own uploads and result were removed, leaving zero used/reserved/cleanup bytes.
Its two account records and completed run history remain. Neither smoke report
contains passwords, cookies or tokens.
Raw [account storage smoke report](ACCOUNT_STORAGE_SMOKE_2026-11-18.json).

The served production assets are `main.68a1754d.js` and `main.d92f6d3e.css`.
The application is available at `http://localhost:8080/` and its protected account
page at `http://localhost:8080/dashboard/account`.

Hard-killed WRITING reservations deliberately remain charged until operator
reconciliation; age-based auto-release and a cleanup scheduler are not implemented.
No payment or subscription provider is connected. The internal entitlement setter
is the documented extension point for that future work.

## Reproduce checks

Run from the repository root; this Compose project is separate from CloudETL and
its PostgreSQL data directory is disposable tmpfs:

```sh
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests up -d --wait etl-test-db
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests run --rm --no-deps tests python manage.py test --settings=config.test_settings --noinput
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests run --rm --no-deps tests python manage.py makemigrations --check --dry-run --settings=config.test_settings
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests down
```

The existing `cloudetl-etl-test:local` image is required. To rebuild it if needed,
use the test Compose build after any required installation/build approval; the
backend directory is mounted read-only, and test settings never load `.env`.

From `frontend/` with existing local dependencies:

```sh
npm.cmd test -- --watchAll=false --runInBand
.\node_modules\.bin\eslint.cmd src --max-warnings=0
npm.cmd run build
```

Run production build after Jest finishes. Docker validation/build commands from
the repository root:

```sh
docker compose config --quiet
docker compose build backend etl-worker frontend
```

These build local images; they do not activate the application or run migrations.

After approval to create dedicated local test records (and temporarily change only
the newly created quota test account's allowance), repeat the live checks using
new report paths; existing reports are never overwritten:

```sh
.\.venv\Scripts\python.exe -B scripts/docker_smoke_test.py --report backend/docs/DOCKER_SMOKE_NEW.json
.\.venv\Scripts\python.exe -B scripts/account_storage_smoke_test.py --report backend/docs/ACCOUNT_STORAGE_SMOKE_NEW.json
```
