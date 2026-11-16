# CloudETL frontend

React with Create React App, plain CSS, and a browser History API router. The
workspace connects to Django session authentication, private dataset storage,
background ETL runs, paginated results, and full-file downloads. No new frontend
dependencies were introduced for this workflow.

Read the [frontend handoff](docs/FRONTEND_HANDOFF.md) before extending the UI. The
[dataset guide](../backend/DATASETS.md) covers uploads and storage; the
[ETL handoff](../backend/docs/ETL_IMPLEMENTATION_TEMP.md) covers the processing
contract, worker, migration, resource limits, and preserved tool behavior.

## User workflow

1. Upload one or more files on **Datasets**. The queue supports ten pending files,
   sequential uploads, per-file outcomes, and retrying a failed file without
   repeating successful uploads. CSV, TSV, JSON, XLSX, and Parquet can be stored.
2. Select saved CSV/TSV sources across dataset pages and choose **Create pipeline**,
   or choose **Use uploaded files** after a successful upload. Current processing
   limits are six sources and 25 MiB combined; other formats are marked storage only.
3. The **Pipelines** page loads each source's first ten rows and inferred columns.
   Choose the starting dataset, then configure ordered transformation steps,
   including **Join tables** and **Append rows**. Source previews show original
   data; transformed rows appear after backend execution.
4. **Run pipeline** sends validated structured JSON to Django and opens the run.
   **Runs** provides paginated, status-filtered history. Pending run details refresh
   every two seconds while visible; completed or failed runs retain configuration
   for **Edit and resubmit**.
5. **Results** lists successful runs. Result details fetch 25, 50, or 100 rows per
   page and offer CSV, TSV, XLSX, JSON, and Parquet downloads containing the complete
   output, independently of the current table page.

The pipeline builder fetches backend capabilities and validates against them;
Django remains authoritative. Drafts exist only on the current page until submitted,
not as saved pipeline templates. Numeric inference can remove leading zeros, and
the preserved tool can turn unrecognized or mixed-format dates into missing values.

## Development and verification

Run from `frontend/` with existing dependencies available:

```powershell
npm start
```

The development server listens on `http://localhost:3000`. Requests use same-origin
`/api/` URLs, so route `/api/` to Django; the Docker frontend's Nginx configuration
already supplies this routing. Session cookies and the in-memory CSRF token are
shared through `src/api/client.js`; `src/api/etl.js` owns ETL requests and binary
downloads. The frontend does not hold storage or database credentials.

```powershell
$env:CI = 'true'
npm test -- --watchAll=false --runInBand
npm run build
```

The build command writes `build/`. These commands describe verification, not a
record of successful execution. See the [ETL test report](../backend/docs/ETL_TEST_REPORT_TEMP.md)
and [handoff](docs/FRONTEND_HANDOFF.md) for focused cases and the disposable backend
test Compose workflow.

## Activation

The local Docker stack was activated and passed live API/worker/storage smoke
checks on 2026-11-15: [Docker verification](../backend/docs/DOCKER_VERIFICATION_TEMP.md).

Source changes do not update already running containers. Backend migration and
worker activation require the separate approval described by repository AGENTS.md;
see the ETL handoff for operator commands. Once that backend is prepared, an
approved frontend rebuild can use `docker compose build frontend` followed by
`docker compose up -d frontend` from the repository root. Starting services can
also start configured dependencies. No deployment or application migration is
implied by this README.
