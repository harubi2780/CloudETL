# Workbook UI refinement and verification

Date: 2026-11-18.

## Changes

The pipeline page is now a viewport-oriented workbook. A compact title bar keeps
the pipeline name, source picker and Run action visible. Ribbon groups expose
Columns, Clean, Filter and Combine commands. Original source previews occupy the
center; sheet tabs switch files below the grid. Applied steps and the selected
step's settings occupy a narrow right pane. Source limits, validation issues and
preview limitations are available through concise status-bar disclosures.

Selecting a header pre-fills new operations for those columns. Ctrl/Cmd toggles
headers and Shift selects ranges. Selecting a cell supplies its column and value
to actions such as Replace values. These actions create explicit pipeline steps;
raw source rows are never edited or simulated in the browser. Step creation and
selection move keyboard focus to the settings heading. Source-library Escape
returns focus to its trigger, and source tabs support arrows, Home and End.

The shared DataTable now provides column letters, row numbers, sticky headers and
row-number cells, compact numeric-aligned cells, roving keyboard navigation,
copying, selection outlines and a read-only full-value bar. Result-page row numbers
continue across pagination. Null, missing, empty string, zero and false remain
distinct. Selection resets for source/page changes while equivalent parent renders
preserve focus.

The sidebar is 180px wide with 12px padding, navigation spacing is reduced, the
top bar is 44px, and workspace content uses the available width. Mobile CSS returns
the workbook to document flow, stacks settings below the grid and retains larger
touch controls. Dataset upload/list spacing, run summaries and result/download
controls are more compact. A small decorative CSS spinner accompanies running
jobs and loading/submission states; queued and terminal job statuses remain
distinct. Reduced-motion preferences stop spinner rotation.

## File map

- `src/pages/PipelinesPage.js` and `Workbook.css`: workbook composition and
  existing data/API state integration.
- `src/components/pipeline/WorkbookToolbar.js`, `SourceTabs.js`, and
  `AppliedStepsPanel.js`: reusable toolbar, file tabs and step inspector.
- `src/components/etl/DataTable.js` and CSS: shared spreadsheet inspection.
- `src/components/etl/Spinner.js` and CSS: reusable status indicator.
- `DashboardLayout.js`/CSS, `DatasetsPage.css`, `EtlWorkflow.css`, and
  run/result pages: shell and shared density improvements.
- Component, page and full workflow tests; frontend README and handoff docs.

No backend code, API contracts, ETL tool files, dependencies or database schema
were changed for this UI revision.

## Executed checks

- Full Jest suite: **158 tests passed across 12 suites**, 22.969 seconds.
- Whole-source ESLint: `eslint src --max-warnings=0` passed with no output.
- Local production build compiled successfully. The frontend Docker image is
  rebuilt from the same final source as part of activation.
- All six updated stylesheets parsed successfully with PostCSS.
- `git diff --check` passed; Git emitted only Windows newline-conversion notices.

Coverage includes the prior upload/auth/API/pipeline/result scenarios plus column
letters beyond Z, cell addressing and full values, header modifier selection,
bounded arrow/Home/End/Tab navigation, copy/clipboard failure handling, source/page
selection resets, disabled interaction, column-based operation setup, numeric zero
replacement, stale projected columns, applied-step focus/errors, source-tab keys,
source-library focus return, running-only job spinners, and reduced-motion CSS.
The full App/API-adapter workflow test still covers source selection, joining,
submission, successful completion, result pagination and full downloads.

## Browser verification limitation

Computer Use could not inspect the browser. Browser inventory reported that the
browser access host was unavailable. Attempting to bind the returned native Brave
window then stopped Computer Use because it could not determine the current
browser URL confidently enough to enforce its policy. No further computer/browser
actions were issued. Desktop/mobile visual appearance has therefore **not** been
verified in a live browser; tests and stylesheet parsing do not replace that check.

## Runtime activation

Executed `docker compose build frontend`, then
`docker compose up -d --no-deps frontend`. The Docker production build compiled
successfully and the new frontend container is running at http://localhost:8080/.
Backend, worker, PostgreSQL and RustFS stayed running. No migrations, credential
changes or persistent data/volume deletions were performed for this revision.

The HTTP smoke check fetched Pipelines/Datasets/Runs/Results deep links, verified
the final JavaScript (`main.9d2cd63a.js`) and CSS (`main.66dbf5e1.css`) include the
workbook/spreadsheet/spinner code, confirmed the Django CSRF proxy returns HTTP 200,
and confirmed anonymous ETL API access still returns HTTP 401. Nginx configuration
validation also passed. No persistent test records were created.

Runtime evidence: [WORKBOOK_UI_RUNTIME_2026-11-18.json](WORKBOOK_UI_RUNTIME_2026-11-18.json).
These checks confirm serving and integration; the browser-visual limitation above
still applies.
