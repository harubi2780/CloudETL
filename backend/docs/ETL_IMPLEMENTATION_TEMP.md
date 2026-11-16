# Temporary ETL integration handoff

Status: backend and frontend integration implemented. The local Docker stack was
activated with user approval on 2026-11-15; `etl.0001_initial` is applied and the
worker is running. See [live Docker verification](DOCKER_VERIFICATION_TEMP.md).
This document describes the code and operating procedure, not authorization to run
application migrations, deploy, delete user data, or change credentials.

## Preserved tool

All eight supplied files are copied into `backend/vendor/etl_tool/`. Their original
bytes are recorded in `SHA256SUMS.json` and protected against Git newline conversion
by `.gitattributes`. No runtime dependency on the external ETL_Tool directory remains.
Do not edit these files to add application behavior; extend the adapter instead.
The new package initializer excludes upstream demonstration scripts from unittest
discovery; none of the eight preserved files were edited.

- `extract.py`: checks CSV/TSV extension and 30 MiB size, reads pandas frames,
  previews ten rows, reports pandas dtypes, and reads multiple files by basename.
- `transform.py`: `joinTables`, `concatTables`, `selectColumns`,
  `removeDuplicates`, `handleNull`, `convertType`, `cleanString`, `replaceValue`,
  `normalizeDate`, and `filterData`.
- `load.py`: CSV/TSV export and result summary, plus standalone S3 upload and
  presigning functions. The application calls only export/review. Its S3 helpers
  use different environment names and silently fall back to local files, so they
  must not be used by the SaaS integration.
- `tool_ETL.py`: demonstration with immediate execution, including storage writes.
  Never import it in Django, a worker, or test discovery.
- `test_user_choices.py`: sample fixed-order configuration runner, with no test
  assertions. Preserved as a reference; not used as the application executor.
- `orders_sample.csv`, `customers_sample.tsv`, `ket_qua_lam_sach.csv`: input
  fixtures and the expected joined/cleaned output.

## Architecture and affected code

`etl/serializers.py` validates the versioned JSON contract using a small serializer
class; no Django REST Framework dependency was introduced. `etl/adapter.py` calls
the original functions and implements staging, resource checks, Parquet and extra
export formats. `services/etl_service.py` owns authorization, input snapshots,
queue admission, status transitions, storage and sanitized error handling.

`etl/models.py` adds `ETLRun`. PostgreSQL stores owner, configuration, input
snapshots, timestamps, status, errors, output size/hash and a private file reference.
Source and result bytes remain in Django storage (RustFS locally, S3 on AWS).
Generated keys are owner/run/attempt scoped; the API never accepts paths, bucket
names, credentials, tenant IDs or download destinations from the client.

Inputs are authorized when queued and again during execution. A source replaced,
deleted or changed in storage fails the run rather than processing new bytes.
Joining/concatenating also requires ownership of every referenced dataset.

The background queue uses PostgreSQL `select_for_update(skip_locked=True)`, so
multiple worker processes can claim distinct jobs. Each job has an attempt UUID.
Updates publishing success/failure require that token and a running status.
Each worker runs one job at a time in a subprocess with a default 300-second
timeout (`ETL_RUN_TIMEOUT_SECONDS`, range 1–3600). Jobs abandoned longer than the
timeout plus 60 seconds are failed by the next polling worker. There are no
automatic retries; users may submit a new run. No Celery/Redis service is needed.

The canonical output is Parquet, with independent CSV/TSV/JSON/XLSX conversions
on download. Excel string cells are explicitly stored as text so leading `=` does
not become a formula. JSON serializes missing/non-finite values as null. Uploads
are never overwritten by a pipeline. Output integrity is checked before download.

## API contract for the frontend worker

All endpoints require session authentication. POST uses the existing CSRF flow
(`GET /api/auth/csrf/`, then `X-CSRFToken`). Responses use `Cache-Control: no-store`.

- `GET /api/etl/capabilities/`: authoritative supported operations and limits.
- `GET /api/etl/datasets/<dataset-uuid>/preview/`: `{preview: {...}}`, up to ten
  rows and inferred pandas column types. Preview runs bounded extraction in the
  web request; large/background preview jobs are a future extension.
- `GET /api/etl/datasets/<dataset-uuid>/`: owner-scoped source metadata for
  opening builder deep links without scanning every dataset-list page.
- `GET /api/etl/runs/?page=1&status=succeeded`: owner-scoped newest-first history,
  20 runs per page; status is optional. List summaries omit preview rows/configuration.
- `POST /api/etl/runs/`: validates and queues, returning HTTP 202 `{run: {...}}`.
- `GET /api/etl/runs/<run-uuid>/`: poll queued/running/succeeded/failed state.
  Includes validated configuration for editing/resubmission. Succeeded runs
  include summary, preview and an authenticated download URL.
- `GET /api/etl/runs/<run-uuid>/rows/?page=1&page_size=25`: authorized rows and
  columns. Page sizes are 25/50/100. Responses include `page`, `page_size`,
  `total_pages`, `total_count`, `columns`, and `rows`. Empty outputs return page 1
  and zero rows. Invalid/repeated/unknown query parameters are rejected; unfinished
  and failed runs return 409.
- `GET /api/etl/runs/<run-uuid>/download/?format=parquet`: download attachment.
  Formats: `parquet` (default), `csv`, `tsv`, `json`, `xlsx`.

There is no pipeline-list/save/edit API or result deletion API in this phase. A
run persists its submitted configuration. Database transfer/export is not implemented.

Example body (replace both IDs with real datasets owned by the signed-in user):

```json
{
  "schemaVersion": 1,
  "name": "Clean joined orders",
  "datasetId": "10000000-0000-0000-0000-000000000001",
  "steps": [
    {"type": "join", "enabled": true, "config": {"datasetId": "10000000-0000-0000-0000-000000000002", "on": "order_id", "how": "left"}},
    {"type": "drop_duplicates", "config": {"rules": [{"allColumns": false, "columns": ["order_id"], "keep": "first"}]}},
    {"type": "handle_null", "config": {"rules": [{"column": "total_amount", "strategy": "mean"}]}},
    {"type": "replace_value", "config": {"column": "city", "oldValue": "Hồ Chí Minh", "newValue": "HCM"}},
    {"type": "select_columns", "config": {"selectedColumns": ["order_id", "city", "total_amount"]}}
  ]
}
```

Step order is the submitted array order. `enabled` defaults to true; disabled
steps are validated but not executed. UI metadata `id`, `name`, and top-level
`updatedAt` are accepted and discarded; unknown fields are rejected. Zero steps
means extract and persist without transformations. Duplicate input column names,
empty headers and unknown columns at a step fail explicitly instead of relying
on the original tool's silent ignore behavior.

Use capabilities to build controls. Supported configuration details:

- `select_columns`: `selectedColumns` is a non-empty unique list in output order.
- `drop_duplicates`: ordered `rules`; each uses either `allColumns: true` with
  empty `columns`, or a non-empty `columns` list. Only `keep: "first"` works.
  Optional frontend `orderBy` must be empty.
- `handle_null`: ordered rules with `column` and `strategy` of `drop`, `mean`, or
  `custom`; custom requires non-null scalar `customValue`. Legacy aliases
  `drop_row`, `fill_mean`, `fill_custom` are normalized. Mean requires numeric data.
- `cast_type`: `conversions` with `column`, `toType` of `integer`, `float`, `string`.
- `string_transform`: `rules` with `column`, boolean `trim`, and `caseMode` of
  `none`, `upper`, `lower`. Legacy `columns`/`trim`/`caseMode` shape also works.
- `filter_rows`: `conditions` with `column`, `operator`, `value`. Numeric operators
  are `greater_than`, `less_than`, `greater_or_equal`, `less_or_equal`, `equals`,
  `not_equals`. `contains` is case-sensitive literal substring matching; the
  adapter escapes the tool's regex input.
- `replace_value`: `column`, scalar `oldValue`, scalar `newValue`; exact matches.
- `format_datetime`: `column`, `inputFormat: "auto"` and `outputFormat` of
  `YYYY-MM-DD`, `YYYY-MM-DD HH:mm:ss`, or `ISO_8601`. The last uses no timezone
  suffix because the tool does not localize dates.
- `join`: `datasetId`, single shared key `on`, `how`: left/right/inner/outer.
- `concat`: `datasetIds` list; appends these datasets to the current frame.

The current UI uses real dataset UUIDs, capabilities and source previews. It sends
ordered JSON, polls run status, and fetches paginated results. It does not use the
old mock-data simulator. The old UI's title-case,
median/mode, boolean casts/filters, duplicate last/min/max, explicit date input
formats and text equality exceed the original tool and are rejected. Text trim
only removes outer whitespace; duplicate and replacement matching are exact and
case-sensitive. Do not infer backend behavior from the old simulator.

## Limits and known tool behavior

- CSV/TSV input only, even though dataset upload supports five formats. Combined
  input bytes must be within `DATASET_MAX_FILE_SIZE_BYTES` (default 25 MiB).
- At most 6 unique sources, 50 steps, 50 rules per step, 10 pending runs per user.
  The JSON request cap remains 16 KiB. Header names are unique, non-empty and no
  longer than 255 characters.
- Frames: at most 500,000 rows, 2,048 columns, 1,000,000 cells, and 128 MiB pandas
  memory. Combined source frames also have a 128 MiB cap. Joins estimate row
  multiplication (including null-key matches) and payload size before merging.
- Each output/export is at most 25 MiB. JSON is an array of row objects. XLSX
  values exceeding Excel's 32,767-character limit fail rather than truncate.
- New Parquet results use 4,096-row groups to support efficient page access.
  Each page verifies the bounded stored file's size/hash, skips unrelated row
  groups, and decodes only the selected range in batches. Old Parquet outputs
  remain readable. There is no server result cache; each request retrieves the
  private result object. Only the requested page is sent to the browser.
- pandas inference loses leading zeros (sample phone numbers demonstrate this).
  Invalid integer conversions become zero; invalid floats become missing. Date
  parsing follows pandas inference and can coerce mixed date formats to missing.
  String conversion and cleaning follow the preserved library's null semantics.
  Mean rounds to two decimal places; incompatible custom fills may fail.
- The subprocess timeout and frame limits are safeguards, not OS memory quotas.
  DataFrames/copies/exports can temporarily allocate more than the frame cap.
  Download conversions run synchronously; add export jobs if workloads grow.
- Storage and PostgreSQL have no distributed transaction. Normal failures attempt
  cleanup of newly saved results. A hard kill between storage save and publication
  can leave an orphan; reconciliation and retention policy remain operational work.
- CSV/TSV preserve tool values, including formula-like strings. Spreadsheet
  applications may interpret those strings when opening delimited exports.

## Local activation on a new environment (requires migration approval)

The migration has been applied to this local application database. For a new
environment, obtain the applicable approval and apply migrations before starting
the worker. The private application storage policy must include both `datasets/*`
and `etl/*` so sources and processed results can be stored/read.

```powershell
docker compose build storage-init backend etl-worker frontend
docker compose up -d db rustfs
docker compose run --rm --no-deps storage-init
docker compose up -d --no-deps backend
docker compose exec backend python manage.py migrate
docker compose up -d --no-deps etl-worker frontend
docker compose exec backend python manage.py check
docker compose logs --tail=100 etl-worker
```

Starting a worker against a database missing the ETL migration will fail. For a
single manually triggered job, use `python manage.py run_etl_worker --once` in the
backend environment. The default polls every two seconds; `--poll-interval` accepts
0.1–60 seconds. Configure AWS with the existing explicit Compose AWS file workflow;
the worker requires the same database and object-storage permissions as the backend.

See `ETL_TEST_REPORT_TEMP.md` for executed checks, failures encountered and the
disposable test commands. Do not point `config.test_settings` at application data.
