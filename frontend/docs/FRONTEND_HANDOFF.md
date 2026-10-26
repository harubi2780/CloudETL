# Frontend handoff

## Current scope

CloudETL has a public landing page, Django session authentication, an authenticated
workspace, and working dataset upload/listing. The UI uses white surfaces, dark
text, subtle borders, and minimal rounding. The upload UI adds no frontend runtime
dependencies.

Dataset files persist in backend storage with owner-scoped metadata in PostgreSQL.
Pipeline editing, execution, results, and activity remain previews with coming-soon
actions. There are no URL imports, file previews, downloads, deletion, or ETL
processing. The UI does not invent statistics or sample records. Read the
[dataset backend guide](../../backend/DATASETS.md) for contracts, validation
bounds, storage, migrations, and the dedicated PostgreSQL test database.

## Source map

- `src/App.js` composes route selection, session guards, redirects, page titles,
  and focus/scroll behavior on route changes.
- `src/navigation.js` provides `Link`, `navigate`, and `useLocation` using the
  browser History API and React's `useSyncExternalStore`. It observes `popstate`
  for browser back/forward navigation. `Link` renders real anchors and preserves
  modified clicks, new tabs, and copy-link behavior.
- `src/routes.js` keeps the `workspacePages` registry and route metadata together.
  It also normalizes trailing slashes and allowlists authentication return paths.
- `src/hooks/useSession.js` restores the session and tracks loading, ready, and
  error states. It clears the current user after successful server logout or a
  dataset API 401 through the stable `expire` callback.
- `src/api/client.js` is shared transport for authentication and datasets. It sends
  same-origin credentials, holds one CSRF token in memory, attaches it to mutations,
  serializes JSON, preserves browser-generated `FormData` boundaries, and exposes
  structured `ApiError` objects. It never stores auth tokens in `localStorage`.
- `src/api/auth.js` validates session/authentication responses through this client;
  `src/api/datasets.js` owns dataset list and multipart upload requests.
- `src/pages/LandingPage.js` owns the public home page and its standalone CSS.
- `src/pages/AuthPage.js` owns sign-in/registration forms, loading state, and
  accessible server field errors.
- `src/pages/DashboardPage.js` owns the overview and workspace navigation links.
- `src/pages/DatasetsPage.js` and its stylesheet own file selection, sequential
  upload results, real metadata listing, pagination, and list retry.
- `src/pages/WorkspacePage.js` renders the remaining feature previews from route
  metadata.
- `src/pages/NotFoundPage.js` renders the unknown-route UI.
- `src/components/AuthLayout.js` contains the centered account layout.
- `src/components/DashboardLayout.js` contains workspace navigation, account
  details, and sign-out controls. `DashboardLayout.css` contains its responsive
  sidebar, dashboard, and feature-preview styles.
- `src/App.css` contains shared controls and application layouts;
  `src/index.css` contains global resets and typography.

## URLs and session behavior

- `/` is public and remains the landing page for signed-in users. Their main CTA
  opens `/dashboard`. A failed session check does not hide the landing content.
- `/login` and `/register` show account forms after session restoration. A
  signed-in user is redirected to `/dashboard` or an allowlisted `next` path.
- `/dashboard` shows the authenticated overview.
- `/dashboard/datasets` provides authenticated dataset uploads and metadata.
- `/dashboard/pipelines`, `/dashboard/runs`, and `/dashboard/results` show
  authenticated feature previews.
- A signed-out visit to a registered workspace page redirects to
  `/login?next=<encoded path>`. Successful sign-in or registration returns there.
  `getReturnPath` accepts only exact registered workspace paths; all other values
  fall back to `/dashboard`.
- Successful sign-out navigates to `/login`. Failed sign-out keeps the user and
  workspace visible and offers another attempt.
- Dataset API 401 responses expire the local session; the normal guard returns
  to sign-in with the dataset route as the allowlisted return path. Uploads stop
  before sending remaining files in that batch.
- Unknown URLs show the page-not-found UI. Route guards are frontend navigation
  behavior; backend authorization must enforce access independently.

## Extending the workspace

The dataset page is the first implemented feature boundary. It loads server limits
and accepts up to 10 files per selection. Client checks catch unsupported, empty,
or oversized files; Django validates content and remains authoritative. Each
valid file is sent sequentially in a separate multipart request containing only
`file`. There are no fake progress percentages. A batch keeps per-file ready,
uploading, uploaded, and failed states, preserving completed results when selecting
another batch. No queue is persisted across reloads.

The dataset list has separate loading, successful empty, populated, and error/retry
states, with 20 records per server page. Successful uploads refresh page 1. A list
refresh error does not turn a successful upload into a failed result; a previously
loaded nonempty list is explicitly marked stale after refresh fails. Superseded
list fetches and unmounts abort their requests. Uploaded originals remain private:
there are no public storage links or retrieval controls in this UI.

1. Add navigation metadata to `workspacePages` when adding a workspace route.
   This registry also defines valid post-authentication return paths.
2. Replace the generic `WorkspacePage` with dedicated pages as the remaining
   features are implemented, following `DatasetsPage`. Keep route metadata
   descriptive; do not put ETL business logic in the registry or router.
3. Put API communication in feature modules under `src/api/` and keep reusable
   request/state behavior separate from presentation components where useful.
4. Model loading, successful empty responses, populated results, failures, and
   retry behavior explicitly. Once an API is connected, do not display a preview
   empty state as if fetching succeeded when a request is pending or failed.
5. Preserve real links, current-page indicators, useful focus handling, readable
   errors, mobile layouts, and clear disabled-action explanations.

The backend must authorize every feature request and validate uploaded files and
transformation configurations. Dataset uploads already use Django storage with
PostgreSQL metadata and references; local Compose persists files in `dataset_files`.
S3 is a future storage adapter, not a current connection. Represent transformation
steps as structured JSON sent to Django. Long-running ETL work should run as background jobs, with
progress and results exposed through explicit API contracts. Do not block web
requests on long transformations or expose storage/database credentials in React.

Continue using the existing Django session/CSRF approach. Do not add auth tokens
to `localStorage` or treat frontend route guards as a security boundary. Keep
secrets in environment configuration, outside committed frontend source.

Future larger uploads need coordinated server/proxy bounds and background
validation, potentially with private direct-to-S3 uploads. Retrieval features need
authorized API adapters and controlled access such as short-lived signed URLs.

## Serving and deep links

`frontend/nginx.conf` already falls back to `index.html` for application URLs, so
opening or refreshing a workspace deep link can load the React app. Its `/api/`
and `/admin/` proxy locations and `/static/` handling serve backend and build
assets. Preserve those locations when changing frontend routes; do not replace
them with the SPA fallback.

Nginx permits 26 MiB total requests to fit the backend's maximum 25 MiB file plus
multipart overhead. Lower per-file limits come from the dataset API. Coordinate
future limit changes with backend settings and validators. No media alias is
configured for uploaded files.

The frontend router has no external router dependency. If future routing needs
justify adopting one, plan that dependency/configuration change with the user
before installing it.

## Verification and local operation

From `frontend/`, with dependencies already available, run:

```powershell
$env:CI = 'true'
npm test -- --watchAll=false --runInBand
npm run build
```

Review the actual diff and successful command output before reporting checks as
passed. Useful route scenarios include public home during an API outage,
restored sessions, signed-out deep links, login/registration return paths,
rejection of arbitrary `next` targets, logout failure/retry, browser back/forward,
and unknown URLs. Dataset checks include invalid selections, partial failures,
sequential submission, list refresh failure after successful upload, pagination,
and session expiry. Check both narrow and wide layouts and keyboard navigation.

From the repository root, an operator can rebuild the existing local frontend:

```powershell
docker compose up -d --build backend frontend
```

This updates local containers and may start configured dependencies. It is not a
cloud deployment and does not apply schema migrations. Use the backend guide for
explicit migration/check commands and dedicated-database tests with `--keepdb`.
Do not run installations, migrations, commits, pushes, or deployments without the
approvals required by repository `AGENTS.md`. Commands in these guides document
the workflow; their presence does not claim a successful run.
