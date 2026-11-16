# Local Docker activation and live test report

Date: 2026-11-15. User authorized Docker setup and testing after implementation.
Local application: **http://localhost:8080/**. This was local activation, not an
AWS deployment.

## Activation executed

1. Validated the resolved Compose configuration and inspected running services.
2. Built `backend`, `etl-worker`, and `frontend`. The production React build
   compiled successfully inside Docker. Existing pinned requirements were used.
3. Found the local RustFS application policy covered only `datasets/*`. Added
   `etl/*` to its exact allowed list/object prefixes; retained private bucket
   access and the existing credentials. Updated the corresponding AWS guidance.
   Built and successfully ran the storage initializer to apply the policy.
4. Recreated the backend without recreating PostgreSQL/RustFS. Reviewed the
   migration plan: only `etl.0001_initial` / Create model ETLRun was pending.
5. Executed `migrate --noinput`: `Applying etl.0001_initial... OK`.
6. Started `etl-worker` and recreated the frontend using their new images.
7. Confirmed Django `check`, applied migration state, runtime `pip check`, and
   `nginx -t` all passed.

All five services were running at final inspection: backend, frontend, ETL worker,
PostgreSQL (healthy), and RustFS. PostgreSQL and RustFS retained their original
containers and persistent volumes. The frontend listens on port 8080; Django,
the worker and RustFS have no published application/storage ports. PostgreSQL's
existing developer port stays bound only to `127.0.0.1:5433`.

## Live verification

Executed through Nginx at localhost using real Django sessions and CSRF tokens:

```powershell
.\.venv\Scripts\python.exe -B scripts/docker_smoke_test.py --report backend/docs/DOCKER_SMOKE_2026-11-15.json
```

Result: **passed, 243 assertions, 14.503 seconds**. Raw sanitized evidence:
[DOCKER_SMOKE_2026-11-15.json](DOCKER_SMOKE_2026-11-15.json).

- Registered two independent smoke accounts, with random credentials kept only
  in memory. Existing account credentials were not read or changed.
- Uploaded original `orders_sample.csv` and `customers_sample.tsv` to private
  RustFS through the real API; extraction returned five/four source rows.
- Queued and completed the join → deduplicate → mean fill → replace → select
  pipeline through the running background worker. The four-row output matched
  `ket_qua_lam_sach.csv`, including the mean `933333.33`.
- Downloaded real Parquet, CSV, TSV, JSON and XLSX files. CSV/TSV/JSON values were
  compared with the expected fixture; Parquet/XLSX container signatures and
  attachment responses were verified.
- Processed a 63-row input. Pagination returned 25/25/13, 50/13, and 63 rows for
  sizes 25, 50 and 100, with stable IDs and correct totals. Its full CSV download
  contained the header plus all 63 rows.
- Appended a separate three-row input to the 63-row dataset, producing one
  correctly ordered 66-row output.
- Verified a different authenticated account cannot access the first account's
  source metadata/previews, runs, result rows or downloads (404). Its dataset/run
  lists remained empty. Anonymous API access returned 401; a mutation without
  a CSRF token returned 403 from the real middleware.
- Verified pipeline, run/result listings and UUID deep links serve the React
  application shell through Nginx. This tests serving/routing, not browser DOM
  interaction; no live visual browser inspection was performed.
- Confirmed the runtime storage backend is `S3Storage` and all three smoke runs
  succeeded, with no pending/running jobs after completion.

The new standalone `object-storage/test_policy.py` test also passed. It checks
that bootstrap application grants cover source and result prefixes, retain the
private bucket command, and do not introduce public or bucket-wide object grants.

## Data and remaining boundaries

Before migration/testing: four existing users, zero datasets, zero ETL runs.
Immediately after migration and service startup: those counts were unchanged.
After the smoke test: six users, four datasets, three successful runs. The added
records belong to the two dedicated `cloudetl_smoke_*` accounts recorded in the
JSON report; they remain for inspection. No existing records or volumes were
deleted, and `.env` was not changed.

`scripts/docker_smoke_test.py` is a repeatable manual test with no extra Python
dependencies. It allows only HTTP loopback targets, constrains redirects to the
selected origin, refuses to overwrite report files, and never prints passwords,
cookies, or CSRF tokens. Each execution creates new retained test data; it is not
part of ordinary Django test discovery. Use a new report filename for reruns.

The previously documented ETL limitations still apply: CSV/TSV inputs, configured
resource limits, inferred types, mixed-date coercion, and current-page drafts.
AWS deployment, production TLS and live browser interaction were not performed.
