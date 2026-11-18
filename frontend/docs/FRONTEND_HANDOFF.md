# Frontend handoff

## Current scope

CloudETL provides public landing and account pages plus an authenticated workspace
for saved datasets, pipeline configuration, background execution, run history,
paginated results, and downloads. The UI uses flat surfaces, subtle borders and
minimal rounding, without a new router or UI dependency.
The pipeline editor now uses a workbook layout: compact title/ribbon, a central
source sheet, sheet tabs, and an applied-steps inspector. This presentation update
does not change the backend API or add dependencies.

File bytes remain in private Django storage; PostgreSQL stores owner-scoped metadata
and references. React receives metadata, previews, run state, configuration, bounded
result pages and authenticated download responses. No browser storage/database
credentials or public object-storage links are exposed.

The copied ETL tool remains unchanged. Its standalone demonstration scripts and the
old mock pipeline simulator are not used by the connected workflow. Read the
[dataset backend guide](../../backend/DATASETS.md),
[ETL implementation handoff](../../backend/docs/ETL_IMPLEMENTATION_TEMP.md), and
[ETL test report](../../backend/docs/ETL_TEST_REPORT_TEMP.md) for server behavior,
limits, worker activation and backend verification.
The [workflow test report](../../backend/docs/FRONTEND_WORKFLOW_TEST_REPORT_TEMP.md)
records the frontend integration, verification results and remaining activation steps.
Local activation was subsequently completed on 2026-11-15; see the
[live Docker report](../../backend/docs/DOCKER_VERIFICATION_TEMP.md).

## Source map

- `src/App.js` composes pages, session guards, redirects, titles, and route focus.
- `src/routes.js` registers workspace pages, validates UUID run/result detail
  routes, and allowlists login return paths while preserving query parameters.
- `src/navigation.js` provides real `Link` anchors, `navigate`, and `useLocation`
  through the History API and `useSyncExternalStore`, including back/forward.
- `src/hooks/useSession.js` owns session restoration and expiry.
- `src/api/client.js` sends same-origin credentials, holds one in-memory CSRF token,
  attaches it to mutations, preserves multipart boundaries, and returns structured
  `ApiError` objects. Authentication is never persisted in `localStorage`.
- `src/api/auth.js` and `src/api/datasets.js` own account and dataset requests.
- `src/api/etl.js` owns capabilities, source metadata/previews, submission, run
  history/details, result pages and binary downloads. Downloads use same-origin
  credentials, a temporary object URL and safe API errors; the URL is released.
- `src/pages/DatasetsPage.js` owns upload/list/replace/delete, per-file retry,
  selected pipeline sources, and upload-to-pipeline handoff.
- `src/pages/PipelinesPage.js` owns source loading, original previews, current-page
  draft state, column/cell selection, the source-library toggle, step ordering,
  configuration, validation and submission.
- `src/components/pipeline/WorkbookToolbar.js` groups actions under Columns,
  Clean, Filter and Combine. `SourceTabs.js` provides keyboard-operable source
  sheet tabs and the starting-dataset marker. `AppliedStepsPanel.js` provides
  the right-hand ordered step list and selected step's configuration.
- `src/components/pipeline/WorkflowStepConfig.js` contains the ten supported
  operation forms. `src/lib/pipeline/workflow.js` contains operation defaults,
  dtype mapping, predicted column schemas, used-source tracking and validation.
  Predicted schemas assist configuration; they do not transform data in React.
- `src/hooks/useRun.js` owns abortable run fetching and visible-page polling.
- `src/pages/RunsPage.js` provides filtered/paginated history;
  `RunDetailPage.js` provides status, elapsed time, errors and submitted JSON.
- `src/pages/ResultsPage.js` lists successful runs; `ResultsDetailPage.js` owns
  server-paginated rows, available export formats, and download state.
- `src/components/etl/DataTable.js` and `DataTable.css` provide the read-only sheet,
  column letters, row numbers, sticky headers, cell inspection/copy and optional
  column selection. `Pagination.js` provides shared page controls.
- `src/components/etl/Spinner.js` and `Spinner.css` provide decorative activity
  indicators with visible status text supplied by their callers; reduced-motion
  preferences disable rotation.
- `src/pages/Workbook.css` styles the viewport-oriented pipeline editor.
  `EtlWorkflow.css` styles the other connected ETL pages. `DatasetsPage.css`
  remains scoped to the compact upload strip, queue and library controls.
- `LandingPage.js`, `AuthPage.js`, `DashboardPage.js`, and `NotFoundPage.js` retain
  public/account/overview/error responsibilities. `AuthLayout.js` and
  `DashboardLayout.js` provide account/workspace shells; `App.css` and `index.css`
  contain shared controls and global styles.

## URLs and session behavior

- `/` remains public, including during session-check failure. Signed-in users can
  open `/dashboard` from its main action.
- `/login` and `/register` restore the session and use the allowlisted `next`
  destination after successful authentication.
- `/dashboard/datasets` manages saved sources.
- `/dashboard/pipelines` opens a new draft and allows adding saved sources.
- `/dashboard/pipelines?datasets=<UUID>,<UUID>` preselects saved source IDs; the
  first is initially the starting dataset. IDs are validated and fetched from the
  owner-authorized metadata API, independent of library pagination.
- `/dashboard/pipelines?run=<UUID>` restores a run's configuration and referenced
  source IDs for editing and resubmission. Missing/deleted sources show errors;
  users must resolve them before running. The old run is not edited.
- `/dashboard/runs` shows history; `/dashboard/runs/<UUID>` shows a run.
- `/dashboard/results` shows successful runs;
  `/dashboard/results/<UUID>` browses/downloads one result.

Signed-out workspace visits return to `/login?next=<encoded path and query>`.
Authentication return validation accepts registered workspace paths and valid UUID
detail paths, preserving their query strings; arbitrary origins, paths and malformed
destinations fall back to `/dashboard`. Unknown routes show the not-found page.
Backend authorization remains mandatory despite these frontend guards.

API 401 responses expire the local session. An upload batch stops sending remaining
files after expiry. Failed logout keeps the user/workspace visible for retry;
successful logout opens `/login`. Preserve real links and keyboard navigation when
extending routing.

## Upload and source selection

The upload queue accepts up to ten pending files. New picker/drop selections append;
invalid, empty, oversized or duplicate pending selections produce per-file notices.
Files upload sequentially, with ready/uploading/uploaded/failed outcomes and no
invented percentages. A failed item keeps its `File` for an explicit per-file retry;
successful entries release their file objects and retain returned dataset metadata.
The last twenty completed outcomes are retained while the page remains mounted.
No upload queue is persisted across reloads.

Uploads may store CSV, TSV, JSON, XLSX and Parquet. Processing currently supports
CSV/TSV only: other library rows are marked **Storage only** and cannot be selected
as ETL inputs. Checkbox selections retain source metadata across library pages and
show a removable selected-source list. **Create pipeline** passes the selected IDs
to the builder. **Use uploaded files** passes successful CSV/TSV upload IDs. It does
not silently truncate a batch larger than the processing limit; it directs users
to choose a smaller library selection.

Current source-selection defaults match the backend: six unique files and 25 MiB
combined. The builder retrieves capabilities and Django validates actual limits;
backend capabilities and errors remain authoritative if settings change. The
library's upload limits come from its list response, separately from processing
limits. Keep these boundaries distinct when changing either limit.

The library has explicit loading/empty/populated/error states and server pagination.
Uploads refresh its first page. Successful upload/management outcomes remain
successful even if list refresh fails. Replacement and deletion require explicit
confirmation; successful replacement keeps the dataset ID but clears its pipeline
selection because format/size may change. Deletion also clears selection and any
upload-result handoff for the removed dataset. Both actions preserve cleanup
warnings returned by Django.

## Pipeline configuration and extraction

The builder fetches private metadata and the first ten rows for each selected
source, including inferred column types and total source row count. Users can
switch the displayed source and choose the starting dataset. Failed previews have
retry controls; every selected source needs a successful preview before submission.
Original files remain saved and unchanged.

The desktop editor fits below the workspace top bar. Its title bar contains the
pipeline name, draft state, **Sources** toggle, upload link and **Run pipeline**.
The Sources toggle opens a paginated saved-dataset picker; closing it returns
focus to its trigger. Adding a source opens its original preview and closes the
picker. Source sheets appear as tabs below the grid, with a **Start** marker for
the primary input. Switching the visible tab only changes the preview; **Use as
starting dataset** explicitly changes the pipeline's primary source.

The ribbon organizes the existing ten actions into **Columns**, **Clean**,
**Filter**, and **Combine**. Selecting headers in the sheet prefills applicable
new actions: selected fields for column selection/deduplication/cleaning/casts,
or the first selected field for replacement/dates. Prefill uses fields still
available after earlier steps. Replacement can also prefill the old value from
the inspected cell. Every ribbon command adds a repeatable JSON step; it never
changes the displayed raw cells. The applied-steps panel on the right handles
selection, enable/disable, movement, removal and the active step's settings.

The bottom status bar shows original preview row counts, enabled steps and the
single-output scope. Expand **Preview details** for inference/draft limitations
and the issues disclosure for validation failures that block execution. Submission
errors remain explicit. No simulated after-state is shown in the sheet.

Ten operation forms generate structured JSON, in execution order:

- Select columns, remove duplicates, handle missing values, convert data type,
  clean text, filter rows, replace values, and format dates.
- **Join tables** selects another source, one shared column name, and left/right/
  inner/outer row retention. Multiple matches can increase output row count;
  overlapping non-key names receive `_x` and `_y` suffixes.
- **Append rows** stacks selected files onto current data in selection order,
  showing column differences and warning that missing fields become NULL.

Users add, configure, move, disable and remove steps. Forms restrict options to the
advertised backend capabilities; unsupported options from the former simulator
(such as title case, boolean conversion, median/mode or keeping the last duplicate)
are not offered. Disabled steps remain subject to structural configuration
validation, matching the backend contract. Before submission, validation also
checks missing/removed columns, unused selected sources, numeric-only operations,
source/step limits, schema collisions and the JSON request-size cap.

The source table always contains original extracted rows. There is no simulated
**After** table or client-side ETL executor. Actual transformed rows appear only
after execution. Predicted column schemas are used to configure downstream steps;
the backend computes actual types and results.

## Read-only sheet interaction and compact layout

The shared source/result table is a spreadsheet-style inspection surface, not a
cell editor. Headers show A, B, ... AA letters, original column names and types;
row numbers stay fixed while scrolling horizontally. Column headers remain sticky
while scrolling within the sheet. Result numbering uses the server page offset,
so page two continues after the previous page rather than restarting at one.

Click or focus a cell to inspect its address and full value in the read-only value
bar. Arrow keys move between cells; Home/End move to the first/last column, with
Ctrl/Cmd extending that movement to the first/last row. Tab traverses cells and
leaves the sheet at its edges. Ctrl/Cmd+C copies the selected value; browser copy
behavior is retained as a fallback when the Clipboard API is unavailable. No copy
operation edits the stored dataset or pipeline configuration.

In the pipeline builder, clicking a header selects one column. Ctrl/Cmd toggles
individual columns, Shift selects a contiguous range from the anchor, and
Ctrl/Cmd+Shift adds that range to the selection. A source change resets selection.
Result sheets support cell inspection/copy but do not expose transformation
column-selection controls. NULL, missing fields, empty strings, zero and false
remain distinct in both sheets.

The shared shell uses a 180px desktop sidebar, a 44px top bar and full-width content
with compact padding. Dataset upload is a horizontal strip rather than a tall
dropzone, with tighter queues, toolbars and table cells. At widths up to 640px,
workspace navigation becomes horizontal, account controls condense, the workbook
returns to document flow and its settings stack below the sheet. Data stays
horizontally scrollable; mobile actions retain 40–44px targets. Desktop workbook
scrolling is contained within its sheet, source picker and settings regions.

Loading/submission/download states and running status display an activity spinner
beside readable status text. The spinner is decorative for assistive technology,
and its rotation stops under `prefers-reduced-motion: reduce`.

Drafts exist only on the current page. The builder warns before browser unload
when a draft has edits; it does not save pipeline templates or promise recovery
after navigation/reload. Submitting sends versioned JSON with `name`, `datasetId`
and ordered `{type, enabled, config}` steps. A successful HTTP 202 opens the new
run detail. Reusing configuration creates a new run; completed history is immutable.

Inference is visible behavior, not a data-preserving type declaration. Numeric
phone identifiers can lose leading zeros, invalid integer conversion can become
zero, and automatic date parsing can turn mixed/unrecognized formats into missing
values. Do not imply a later text cast restores already inferred leading zeros.
The source bytes remain available to the backend unchanged. See the ETL handoff
for the preserved tool's additional semantics and limits.

## Runs, results and downloads

Run history supports status filtering and pagination. Result history requests only
successful runs. Opening a pending run polls every two seconds while the document
is visible; hidden documents pause repeat polling and visibility resumes it.
Polling stops on terminal status or request failure; failures offer retry. Unmount
and route changes abort requests and clear timers. Elapsed time is derived from
server timestamps and the last status check, without fake progress percentages.

Details preserve the submitted JSON, display safe failure messages, and link to
**Edit and resubmit**. Successful runs link to their result. Result details fetch
25, 50 or 100 rows per server page and reset to page one when page size changes.
Loading and retry states are separate from successful empty results. The table
distinguishes NULL, missing fields, empty strings, numeric zero, and boolean false.
An empty result keeps its schema and download options.

Download formats come from capabilities: CSV, TSV, XLSX, JSON and Parquet. The
download includes every output row regardless of table pagination. Preparing,
failure and browser-handoff states are explicit; browser handoff is not described
as proof that a file was saved to disk. Downloads remain authenticated, and errors
never display raw proxy responses.

## API boundaries

`src/api/etl.js` calls the following same-origin endpoints:

- `GET /api/etl/capabilities/`: input/output formats, operation choices and limits.
- `GET /api/etl/datasets/<UUID>/`: owner-scoped source metadata.
- `GET /api/etl/datasets/<UUID>/preview/`: ten original rows plus schema/count.
- `POST /api/etl/runs/`: queue a validated pipeline, returning HTTP 202 and a run.
- `GET /api/etl/runs/?page=1&status=running`: owner-scoped paginated history;
  status is optional, with `succeeded` used by result history.
- `GET /api/etl/runs/<UUID>/`: status, summary/error and private-owner-visible
  `configuration` for review and reuse. It does not expose storage keys/secrets.
- `GET /api/etl/runs/<UUID>/rows/?page=1&page_size=25`: bounded result rows,
  columns, page/page-size, total pages and total row count.
- `GET /api/etl/runs/<UUID>/download/?format=parquet`: complete result attachment.

Dataset list/upload/replace/delete continue using `/api/datasets/`. Mutations use
the existing Django session/CSRF flow. Frontend controls are convenience validation;
Django verifies ownership and payloads, queues long work, detects changed inputs,
and accesses private storage. Keep ETL and database business logic out of React.

## Serving, verification and activation

Nginx falls back to `index.html` for SPA paths, enabling run/result deep links.
Preserve its `/api/`, `/admin/`, static asset handling, and the 26 MiB request cap
when changing routes. API requests require a same-origin Django proxy; the default
development server alone does not supply the backend. There is no public media
alias. Larger uploads require coordinated proxy/server/worker changes.

With existing dependencies, run from `frontend/`:

```powershell
$env:CI = 'true'
npm test -- --watchAll=false --runInBand
npm run build
```

Relevant checks include selected IDs across pages, mixed upload success/retry,
capability loading failures, source preview errors, joins/appends and step order,
configuration reuse, double-submission prevention, polling cleanup/visibility,
status filtering, paginated empty/populated results, scalar rendering, download
errors, session expiry, query-preserving login returns and unknown routes. Inspect
both narrow/wide layouts and keyboard interaction, including header modifier
selection, cell copying, sheet tabs, source-picker focus and status disclosures.
Review actual output before
claiming checks passed; no final execution counts are asserted by this guide.
Browser inspection for this layout revision was unavailable because browser
automation could not verify the browser URL; this document does not claim visual
browser testing.

Use the separate `compose.etl-test.yaml` test project and `config.test_settings`
for PostgreSQL tests; exact commands and cleanup are in the ETL test report. Its
database is disposable, with no application volume or published ports. Do not
substitute the application database for tests.

Source edits alone do not update running services. This local stack was rebuilt,
migrated and activated with user approval on 2026-11-15. Activation on another
environment remains subject to the applicable `AGENTS.md` approvals; the backend
ETL handoff gives the required operator sequence. After the backend is
prepared, an approved frontend rebuild can run from the repository root:

```powershell
docker compose build frontend
docker compose up -d frontend
```

Starting services may start configured dependencies. Commands here document the
workflow, not proof of deployment, service activation or migration execution.
The workbook revision was subsequently rebuilt and activated locally on
2026-11-18. [The UI verification report](WORKBOOK_UI_TEST_REPORT_TEMP.md) records
the final checks and the browser-visual verification limitation.
Installations, migrations, data deletion, commits, pushes and deployments still
require the applicable repository approvals.
