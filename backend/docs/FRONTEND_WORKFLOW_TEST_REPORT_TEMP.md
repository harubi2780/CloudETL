# Temporary frontend workflow implementation and test report

Date: 2026-11-15. Follow-up to the preserved-tool backend integration.

Subsequent activation: Docker services and the application migration were activated
with user approval. See [the live Docker report](DOCKER_VERIFICATION_TEMP.md).
The operational boundaries below describe the earlier implementation-only checks.

## Delivered workflow

1. Datasets accepts one/many uploads with independent success/failure states. A
   failed file can be retried without uploading successful files again. Saved
   CSV/TSV sources can be selected across library pages or used directly after
   upload. Other upload formats are marked Storage only for this ETL version.
2. Pipelines resolves real source UUIDs and shows the first ten extracted rows,
   inferred types and total source rows. Sources remain separate stored originals.
3. The builder submits ordered JSON for all ten supported operations, including
   single-key joins and row concatenation. Column projection accounts for removed
   columns, numeric casts, join suffixes and appended columns; the backend remains
   authoritative. Selected files must actually be referenced in the pipeline.
4. Runs shows paginated/status-filtered history and queued/running/succeeded/failed
   details. Pending details poll every two seconds while visible. Configuration
   persists with a run and can be opened for editing/resubmission.
5. Results fetches 25/50/100 server rows per page, reports the displayed range,
   distinguishes null/empty/zero/false, and downloads the complete file in a
   backend-advertised format. New results use 4,096-row Parquet groups. There is
   no simulated transformed preview and no full-table browser pagination.

## Files and responsibilities

- `frontend/src/pages/DatasetsPage.js` and CSS: upload retry and pipeline handoff.
- `frontend/src/pages/PipelinesPage.js`: real source selection/extraction,
  ordered editing, review/validation and submission.
- `frontend/src/components/pipeline/WorkflowStepConfig.js`: reusable forms for ten
  operations, capability-constrained options and join/append explanations.
- `frontend/src/lib/pipeline/workflow.js`: UI schema projection and validation;
  does not transform dataset rows.
- `frontend/src/pages/RunsPage.js`, `RunDetailPage.js`, `ResultsPage.js`, and
  `ResultsDetailPage.js`: execution and result browsing.
- `frontend/src/components/etl/`: shared scalar-aware table and pagination.
- `frontend/src/hooks/useRun.js`: polling, visibility, abort and retry lifecycle.
- `frontend/src/api/etl.js`: shared JSON transport plus authenticated binary
  downloads/object-URL cleanup.
- `frontend/src/App.js`, `routes.js`, dashboard shell/overview: real feature and
  UUID detail routes, query-preserving login return paths and accurate navigation.
- `backend/etl/views.py`, `urls.py`, `adapter.py`, `services/etl_service.py`:
  source metadata, owner-scoped run history/configuration and result-row paging.
- Backend/frontend test files and handoff/README documentation were updated.
  The eight copied tool files remain byte-for-byte unchanged. No dependencies
  were added in this follow-up and no new model migration was required.

## Executed checks

- Full frontend Jest: **127 tests passed in 9 suites**.
- Whole-source ESLint: `eslint src --max-warnings=0`, exit 0.
- Production frontend build: compiled successfully; output remains in ignored
  `frontend/build/`. This does not publish or replace a running frontend.
- Full backend suite on disposable PostgreSQL: **117 discovered, 111 passed,
  6 skipped**. The six existing opt-in live object-storage tests were not enabled.
- After changing Parquet row grouping, the 38 adapter/browsing tests passed again.
- `makemigrations --check --dry-run`: No changes detected.
- All 59 backend Python files parsed; all eight vendor checksums matched the
  manifest and original directory. `git diff --check` passed (Windows newline
  conversion notices are informational).

Frontend coverage includes upload selection across pages, partial failures/retry,
size/count limits, extraction errors and retry, all operation forms and schemas,
unsupported options, joining/appending payloads, dropped-column validation,
duplicate submission, request errors preserving configuration, run reuse,
history/status polling/visibility, result pagination/scalar fidelity, download
errors, deep links and safe login return paths. `Workflow.test.js` exercises the
actual App/router and API adapters from two saved sources through joining, run
submission, completion, two result pages and a full-file download using mocked
HTTP responses. This is an integration test of UI/API wiring, not a live browser
or AWS deployment test.

Backend browsing tests cover ownership on metadata/history/configuration/rows,
filtering and pagination, stable row order across Parquet groups, zero-row output,
supported sizes and invalid/repeated queries, not-ready runs, integrity failures,
and complete downloads independent of the selected page. Earlier worker,
concurrency, authentication and dataset tests remain in the full suite.

## Problems found and fixed

- A virtual API-module mock left over from writing pages before the adapter
  existed caused the first combined frontend run to use the real transport.
  Removing the virtual marker fixed module resolution; the full suite passed.
- Retrying a failed source-library fetch initially shared the builder's
  initialization counter and could reset a draft. A separate library retry
  counter and regression test now preserve the name and steps.
- Schema projection initially treated mixed integer/float appends as text and
  omitted `enabled` as false. Projection/validation now match numeric promotion
  and the backend's enabled-by-default behavior. Text cleaning projects string
  types before subsequent numeric-operation validation.
- Async test synchronization produced React act warnings. Tests now wait for
  authentication resolution and flush immediate multi-upload chains explicitly.
- One pre-existing auth/upload test exceeded its five-second timeout while the
  production compiler ran concurrently. The final serial frontend run passed
  without increasing test timeouts.

## Operational boundaries

Application schema migrations and runtime container/worker activation remain
pending separate approval. No application records, secrets, or persistent database
volumes were changed. Backend tests used the separate `cloudetl-etl-tests` Compose
project with tmpfs PostgreSQL and temporary filesystem storage; its cleanup is
performed after checks. Live RustFS/S3 checks and a live browser smoke test were
not performed in this follow-up.

ETL is currently CSV/TSV only, at most six unique sources and the current combined
input limit (default 25 MiB). Dataset upload still supports five formats. Frontend
picker checks are convenience; the builder fetches capabilities and Django
independently validates all inputs. Drafts stay on the current page until submitted;
there is no saved-template API, branch-specific transforms, arbitrary join-key
renaming, per-step execution preview, URL import or database transfer in this version.
The original tool's inference/coercion limitations remain documented.

See `ETL_IMPLEMENTATION_TEMP.md` for activation commands and
`../../frontend/docs/FRONTEND_HANDOFF.md` for UI routes, APIs and development commands.
