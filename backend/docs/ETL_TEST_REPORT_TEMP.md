# Temporary ETL verification report

Follow-up: the frontend workflow was implemented and verified on 2026-11-15.
See [the workflow report](FRONTEND_WORKFLOW_TEST_REPORT_TEMP.md) for current
integration status and expanded checks. The results below record the initial
backend integration on 2026-11-14.

Verified on 2026-11-14. This is the backend implementation report; the application
database was not migrated, application containers were not replaced, and no AWS
deployment or frontend integration was performed.

## Final results

Default Django test discovery completed successfully against disposable PostgreSQL:

```text
Found 111 test(s).
System check identified no issues (0 silenced).
Ran 111 tests in 20.461s
OK (skipped=6)
```

105 tests passed; six existing opt-in real-object-storage integration tests were
skipped because `CLOUDETL_TEST_OBJECT_STORAGE` was not enabled. The ETL tests used
temporary filesystem storage. Real RustFS/S3 result persistence has not been
verified in this task; storage failure and no-fallback behavior were tested.

Additional checks executed successfully:

- The separate backend Docker test image built with Python 3.14, Django 6.1.2,
  pandas 3.1.1, NumPy 2.5.4, PyArrow 26.0.0 and the existing requirements.
- `python -m pip check`: `No broken requirements found.`
- Normal `config.settings` also passed `manage.py check` using explicit throwaway
  credentials and filesystem storage; no application connection was used.
- Final standalone adapter/vendor checks passed: 34 tests in 0.245 seconds in the
  Windows project `.venv` without a database.
- `makemigrations --check --dry-run`: `No changes detected`.
- Local Compose, explicit AWS Compose, and isolated test Compose passed
  `config --quiet`. The resolved local worker command, storage/database equality
  with the backend, and dependency on storage initialization were also checked.
  No credentials were printed by this comparison.
- All 58 backend Python files parsed successfully with Python's AST parser.
- `git diff --check` succeeded. Git emitted newline-conversion notices for existing
  text files; the vendor files have explicit `-text` attributes to preserve bytes.
- All eight vendored files were rehashed against both the manifest and the external
  original directory after implementation; all matched.

## Test coverage

`tests/test_etl_vendor.py` checks all eight checksums and excludes the standalone
upstream demonstration runner from default unittest discovery.

`tests/test_etl_adapter.py` exercises all ten transformations, JSON contract
normalization/rejection, ordered steps, disabled steps, exact matching, numeric
coercion, null handling, literal contains, date output formats, unsupported frontend
choices, finite/scalar validation, unknown/dropped columns, header validation,
source integrity, size/memory/cell limits, join growth before allocation (including
null keys), concatenation limits, preview normalization and five export roundtrips.
It verifies XLSX formula-like strings remain text and overlong Excel cells fail
before opening a streaming workbook.

`tests/test_etl_api.py` exercises:

- Sessions, CSRF, HTTP methods, structured errors and private/no-store responses.
- Owner checks on main/join/concat inputs, previews, run status and downloads.
- HTTP 202 queuing without doing extraction in the submission request.
- Input deletion/replacement/storage corruption after submission.
- Unknown columns, unsupported input formats, queue capacity and not-ready results.
- Sample orders/customers join, deduplication, mean fill and replacement, with
  exact CSV output matching `ket_qua_lam_sach.csv`; TSV/JSON/XLSX/Parquet downloads.
- Failed storage saves without a local fallback or exposed internal error message.
- Result integrity, invalid export parameters, claim-token fencing, stale job
  expiration, timeout reporting and stale result cleanup.
- A real worker subprocess reading committed records from the test database,
  extracting the sample file, saving Parquet and publishing success.

`tests/test_etl_queue.py` uses separate PostgreSQL sessions and synchronization
events/barriers to prove that workers skip locked jobs without double claims, and
two simultaneous submissions at nine pending runs admit exactly one request.
These two checks also passed independently in 0.225 seconds.

The existing authentication, upload, replacement/deletion, legacy storage-copy and
storage-configuration suites ran with the new tests. No frontend tests were run
because frontend code was not changed.

## Errors encountered and resolutions

1. Initially pandas was absent. The first sandboxed installation failed because
   outbound sockets were denied. Installation succeeded with the approved network
   access. pandas/NumPy are now pinned in `requirements.txt` and installed in the
   project `.venv` and Docker test image.
2. The original tool's `.venv` references a missing Python 3.13 executable. It was
   not repaired or used. The vendored modules use the project's environment.
3. The Windows environment has psycopg but lacks native libpq, so it could not run
   PostgreSQL-backed tests. The Docker image provides libpq; all database tests
   ran there against a separate disposable PostgreSQL 17 instance.
4. Docker inspection initially failed in the sandbox. The approved elevated
   read-only inspection succeeded; subsequent isolated Docker tests succeeded.
5. Writing a generated migration from a read-only container source mount failed
   with `OSError: Read-only file system`. Django's dry run then generated the
   migration content; that content was saved through the workspace file editor.
   Migration consistency was verified afterward. Only test schemas were migrated.
6. The first full suite run reported two connection-closed errors: a worker command
   test ran inside `TestCase`'s outer transaction, then its closed connection
   affected the next test. Moving the worker-command test to `TransactionTestCase`
   fixed the setup. The subsequent 107-test run and final 111-test run passed.

## Preserved tool limitations observed

- Sample customer phone `0901234567` becomes numeric `901234567` through pandas
  inference. The adapter does not silently change the tool's read behavior.
- After sample deduplication, normalizing the four mixed-format order dates with
  the original function produced `2026-10-01` followed by three missing dates.
  This is pandas' inferred-format/coercion behavior; no tool code was modified.
- Integer conversion replaces invalid values with zero; invalid floats/dates can
  become missing. Incompatible custom fills can fail instead of converting types.
- The frontend simulator supports operations the preserved tool does not. The
  backend rejects these options and advertises capabilities instead of skipping
  or approximating them.

## Repeatable isolated commands

From the repository root, with Docker Desktop running:

```powershell
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests build tests
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests up -d --wait etl-test-db
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests run --rm --no-deps tests python manage.py test --settings=config.test_settings --noinput
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests run --rm --no-deps tests python manage.py makemigrations --check --dry-run --settings=config.test_settings
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests run --rm --no-deps tests python -m pip check
docker compose -f compose.etl-test.yaml -p cloudetl-etl-tests down
```

This project name/configuration is intentionally separate from application Compose.
The PostgreSQL data directory is tmpfs, with no published ports or persistent named
database volume. Tests use throwaway credentials and temporary files. Django creates,
migrates and destroys only `test_cloudetl_etl_tests` in this disposable instance.
The final `down` removes only the test project's containers/network and its tmpfs data.
That cleanup was executed successfully after verification.
Do not substitute application database credentials or normal Compose commands.

For fast serializer/adapter/vendor checks without PostgreSQL, from `backend/`:

```powershell
..\.venv\Scripts\python.exe -B -m unittest tests.test_etl_adapter tests.test_etl_vendor
```

Remaining work: frontend API integration; separate approval to apply application
migrations and start the worker; live object-storage checks; production workload
limits, output retention and orphan reconciliation. See `ETL_IMPLEMENTATION_TEMP.md`.
