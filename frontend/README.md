# CloudETL frontend

Read the [frontend handoff](docs/FRONTEND_HANDOFF.md) before extending routes,
authentication, or ETL features. It describes the current boundaries and next steps.
The [dataset backend guide](../backend/DATASETS.md) covers upload validation,
storage, API contracts, migrations, and PostgreSQL tests.

React with Create React App, plain CSS, and a small browser History API router.
The public landing page, sign-in/registration flow, and authenticated workspace
have separate pages and layouts. Authentication uses the existing Django session
API. The dataset page uploads CSV, TSV, JSON, XLSX, and Parquet files and lists
stored dataset metadata. It supports up to 10 selected files uploaded sequentially,
with per-file results. Pipeline, run, and result pages remain **UI placeholders**.
ETL processing, previews, downloads, and deletion are not implemented.

Run commands from `frontend/` with existing dependencies available:

```powershell
npm start
```

The development server listens on `http://localhost:3000`. API requests use
same-origin `/api/` URLs, so use a setup that routes `/api/` to Django for
authentication and dataset operations. The Docker frontend's Nginx configuration
provides this routing. Authentication and upload requests share Django session
cookies and an in-memory CSRF token through `src/api/client.js`.

To run checks in PowerShell:

```powershell
$env:CI = 'true'
npm test -- --watchAll=false --runInBand
npm run build
```

`npm run build` writes a production bundle to `build/`.

To rebuild and start the frontend in the existing local Docker setup, run from
the repository root:

```powershell
docker compose up -d --build backend frontend
```

This starts or updates local services and may also start configured dependencies.
It is a manual development command, not an automatic cloud deployment. Backend
schema changes require explicit migrations; see the dataset backend guide.
