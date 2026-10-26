# Dataset uploads

CloudETL accepts authenticated uploads of CSV, TSV, JSON, XLSX, and Parquet files.
Original bytes go to Django storage; PostgreSQL holds ownership, metadata, and a
storage reference. This feature provides upload and metadata listing only.
Pipelines, execution, URL imports, previews, downloads, and deletion are not
implemented. See the [frontend handoff](../frontend/docs/FRONTEND_HANDOFF.md) for
the page and routing structure.

## Model and storage

`datasets.models.Dataset` uses the Django ORM with a UUID primary key, an owner
foreign key to the user model, the original basename, normalized format, a
`FileField` storage reference, positive byte size, SHA-256 digest, and upload time.
`on_delete=PROTECT` prevents deleting a user while datasets reference that user.
Database checks require `size_bytes > 0` and one of the five supported formats.
The `(owner, -uploaded_at, -id)` index supports owner-scoped, newest-first listing.

The generated storage name is `datasets/<owner-id>/<dataset-uuid>.<format>`;
client filenames never determine the storage location. Paths are reduced to a
basename and filenames with prohibited control characters or more than 255
characters are rejected. Duplicate original filenames are allowed and get
separate UUID storage names. Content is validated and hashed without rewriting
the uploaded bytes. The digest is metadata, not a deduplication constraint.

`services/dataset_service.py` validates, hashes, saves through `FileField`, and
inserts metadata through `dao/dataset_dao.py` inside a database transaction.
If insertion fails after saving a file, the service attempts to remove only that
new file. Cleanup failure is logged; storage and PostgreSQL do not share an atomic
transaction, so operational reconciliation may be needed after a storage failure.

The local backend uses `FileSystemStorage`, `DATASET_STORAGE_ROOT=/app/media`, and
the persistent Compose named volume `dataset_files`. Outside Compose the storage
root defaults to `backend/media`. PostgreSQL has its separate `postgres_data`
volume. Removing either volume deletes its corresponding data; normal rebuilding
does not remove volumes.

All file access goes through Django's storage abstraction so a future S3 adapter
can replace local storage. S3 is not configured now. API responses omit storage
names, storage URLs, owner IDs, and SHA-256 values. There are no public media or
dataset download endpoints; Nginx has no uploaded-media alias.

## API contract

Both methods at `/api/datasets/` require a Django session. POST also requires the
session's CSRF token and a valid origin. Ownership comes from `request.user`;
clients cannot set an owner. List queries always filter by that user.

`GET /api/datasets/?page=1` returns HTTP 200:

```json
{
  "datasets": [
    {
      "id": "d38c546f-28a3-47bd-9c8f-8f5e096723e9",
      "filename": "orders.csv",
      "format": "csv",
      "size_bytes": 2048,
      "uploaded_at": "2026-10-24T10:00:00+00:00"
    }
  ],
  "page": 1,
  "total_pages": 1,
  "total_count": 1,
  "limits": {
    "max_file_size_bytes": 26214400,
    "extensions": ["csv", "tsv", "json", "xlsx", "parquet"]
  }
}
```

Pages contain at most 20 records, ordered by descending upload time and UUID.
An empty collection has `datasets: []`, `total_count: 0`, and `total_pages: 1`.
Page numbers must be positive ASCII decimal strings of at most nine digits and
must refer to an existing page; the default is 1.

`POST /api/datasets/` accepts `multipart/form-data` containing exactly one file
under the field `file`, with no additional text or file fields. The browser must
set the multipart boundary. A successful response is HTTP 201:

```json
{
  "dataset": {
    "id": "d38c546f-28a3-47bd-9c8f-8f5e096723e9",
    "filename": "orders.csv",
    "format": "csv",
    "size_bytes": 2048,
    "uploaded_at": "2026-10-24T10:00:00+00:00"
  }
}
```

Errors use the shared JSON envelope, with optional field errors:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Each row must have the same number of columns.",
    "fields": {"file": ["Each row must have the same number of columns."]}
  }
}
```

Status/code combinations are 400 for `validation_error`, `invalid_request`, or
`invalid_page`; 401 for `authentication_required`; 403 for `csrf_failed`; 405 for
`method_not_allowed` with `Allow: GET, POST`; 413 for `file_too_large` or oversized
multipart parsing (`invalid_request`); and 503 for `upload_failed`. CSRF middleware
can reject POST before the view checks authentication. Parser and storage details
stay out of response messages. Responses are marked `no-store`.

## Validation and resource bounds

The server is authoritative. An allowed filename extension is necessary, and the
matching parser must successfully validate the content; client MIME types are not
trusted. Empty byte streams are rejected. Validation runs synchronously in the
upload request and preserves the original file.

- CSV/TSV use strict `csv.reader` with comma/tab delimiters and UTF-8 decoding
  with optional BOM. Blank rows are skipped; the first nonblank row must have a
  non-whitespace value, and subsequent rows must have the same column count.
  Limits are 500,000 nonblank rows and 2,048 columns. Prohibited control characters
  are rejected. Python's default `csv.field_size_limit()` remains in effect.
- JSON uses UTF-8 with optional BOM and must contain an object or array. Before
  parsing, a string-aware scan limits nesting to 64 and structural markers to
  250,000, counting opening braces/brackets, commas, and colons outside strings.
  Malformed JSON and nonstandard `NaN`/`Infinity` constants are rejected. Decimal
  parsing preserves finite JSON number syntax without converting to binary floats.
- XLSX ZIP archives permit at most 2,000 entries and 128 MiB total declared
  uncompressed entry size. Encrypted entries and `vbaProject.bin` are rejected.
  XML/rels entries are preflighted through `defusedxml` with at most 500,000 XML
  nodes across the archive and XML nesting limited to 64. `openpyxl` uses read-only, data-only mode without
  external links; there must be 1–32 worksheets. Across worksheets the limits are
  500,000 rows and 1,000,000 cells, with 2,048 columns per row. ZIP contents are
  read without extracting them to disk; formulas are not executed.
- Parquet limits are 500,000 rows, 2,048 columns, and 2,048 row groups, with both
  declared row-group uncompressed bytes and accumulated decoded batches capped
  at 128 MiB. The reader limits Thrift strings to 8 MiB, containers to 100,000,
  and schema depth to 32. It validates batches of 1,024 rows with threads,
  prebuffering, and Arrow extension-type deserialization disabled.

`DATASET_MAX_FILE_SIZE_BYTES` defaults to 26,214,400 bytes (25 MiB). It can be
lowered but must be positive and cannot exceed 25 MiB in current settings. The
first upload handler counts actual incoming file chunks and stops an oversized
upload before normal memory/disk buffering; the validator checks size again.
Nginx caps the full request at 26 MiB (`client_max_body_size 26m`) to allow
multipart overhead and returns a JSON 413. Coordinate any future increase with
the proxy, parsers, worker resources, and application limits together.

Django's non-file request-data memory limit is 16 KiB. The file upload memory
buffering threshold is 1 MiB, with a temporary-file handler for larger uploads.
These settings do not replace the per-file byte limit. Stored files use mode
`0600` and created upload directories use `0700`.

## Frontend behavior

`/dashboard/datasets` loads real metadata and server-advertised limits. Users can
select up to 10 files per batch. The page checks extension, empty size, and byte
limit before sending one multipart request per valid file, sequentially. Queue
entries report ready, uploading, uploaded, or failed; there are no simulated
percentages. Completed and failed results remain visible while choosing another
batch. Upload failures do not prevent the remaining batch from being attempted,
except a 401 stops subsequent uploads and returns the session to sign-in.

Successful uploads refresh page 1 of the list. Upload results and list refresh
errors remain separate, so a successful upload is not described as failed if
refresh fails. Loading, empty, error/retry, and paginated list states are explicit.
There is no persistent browser queue or `localStorage` authentication token.

`src/api/client.js` shares an in-memory CSRF token between auth and dataset API
adapters, sends same-origin session credentials, serializes JSON objects, and
lets the browser encode `FormData`. The auth CSRF endpoint initializes the token;
login/registration/logout responses refresh it. Session restoration runs again
after a page reload. Backend authorization remains mandatory for every request.

## Local build and migrations

From the repository root, with the existing environment configured:

```powershell
docker compose build backend frontend
docker compose up -d db backend frontend
docker compose exec backend python manage.py makemigrations --check --dry-run
docker compose exec backend python manage.py showmigrations datasets
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py showmigrations datasets
docker compose exec backend python manage.py check
```

`migrate` changes the configured database schema; building or starting the image
does not apply migrations automatically. The initial dataset migration is in
`datasets/migrations/0001_initial.py`. These commands describe the workflow, not a
record of execution. Verify command output and the applied migration status.

For a future model change, generate its migration in the source checkout with a
configured local Django environment using `python manage.py makemigrations datasets`
from `backend/`, review the migration, then rebuild before applying it.
The Compose backend copies source into its image, so generating a migration only
inside a running container does not update the checkout.

## PostgreSQL tests

The runtime app role has `NOCREATEDB`. An administrator must first create a
dedicated test database owned by that app role. For example, in an administrative
PostgreSQL session, `CREATE DATABASE cloudetl_dataset_tests OWNER cloudetl_app;`
uses the example role name; substitute the configured app role as needed. This
database must be separate from `POSTGRES_DB` and contain no application data.

`DJANGO_TEST_DATABASE_NAME` selects the dedicated database; its fallback is
`test_<POSTGRES_DB>`. Compose does not currently forward this variable, so pass it
explicitly for a test run:

```powershell
docker compose exec -e DJANGO_TEST_DATABASE_NAME=cloudetl_dataset_tests backend python manage.py test tests.test_auth tests.test_datasets --keepdb
```

`--keepdb` reuses the precreated database and preserves it afterward; Django still
applies required test schema migrations and isolates test records. Never point
this variable at the normal application database or clear that database for
tests. Upload tests override `MEDIA_ROOT` with a temporary directory and clean up
only their own test files.

## Remaining boundaries

Current parsing limits bound synchronous work but are not process isolation or
malware scanning. Rate limiting, per-user storage quotas, and antivirus scanning
are not implemented. Larger uploads should move validation and processing into
background workers and use a deliberate direct-to-private-S3 upload design.
Future previews or downloads need authorized API adapters and controlled retrieval
(for example short-lived signed access); do not expose stored references or make
the bucket public. Pipeline configuration should remain structured JSON validated
by Django, with long-running ETL execution handled asynchronously.
