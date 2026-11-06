# Private dataset object storage

Dataset bytes go to an S3-compatible bucket; PostgreSQL stores the owner,
original filename, format, size, SHA-256, timestamp, and object key. The model and
API contract do not change. Locally, Docker runs RustFS; on AWS, use Amazon S3.
The frontend never receives storage credentials or direct object URLs.

## Local configuration

Keep your existing root `.env`. Add these settings using distinct, unique values
for the four credential placeholders; do not copy the placeholder strings as
working credentials or commit `.env`:

```dotenv
RUSTFS_ROOT_ACCESS_KEY=replace-with-a-unique-root-access-key
RUSTFS_ROOT_SECRET_KEY=replace-with-a-long-random-root-secret
RUSTFS_APP_ACCESS_KEY=replace-with-a-different-app-access-key
RUSTFS_APP_SECRET_KEY=replace-with-a-different-long-random-app-secret
AWS_STORAGE_BUCKET_NAME=cloudetl-datasets
AWS_S3_REGION_NAME=us-east-1
```

Docker Compose automatically combines `compose.yaml` and `compose.override.yaml`
for local development. The override contains RustFS and its initialization service;
the base file contains the application and PostgreSQL.

The root credentials belong only to RustFS and the one-shot `storage-init`
service. Django uses the separate application key scoped to the dataset bucket.
RustFS does not publish a host port. Its API is reachable only on the Compose
network; neither the bucket nor the console is exposed through Nginx.

After configuring `.env`, these commands build images and recreate local
containers. Stop using uploads while applying the change:

```powershell
docker compose build backend frontend storage-init
docker compose up -d rustfs
docker compose run --rm storage-init
```

Inspect the initialization output before continuing. Initialization creates the
private bucket and application identity. No application schema migration is
required for this storage change. Existing uploads need the copy procedure below
before the backend starts using the new store.

When ready, start/recreate the application:

```powershell
docker compose up -d backend frontend
docker compose logs --tail=50 backend
```

The new object-store volume persists across rebuilds and normal `compose down`.
Keep both it and the old `dataset_files` volume. Never use `docker compose down -v`
to resolve a configuration problem; it removes persisted data.

## Copy existing uploads

The old `dataset_files` volume is mounted read-only at `/app/legacy-media`. No
copy happens automatically. The command reads only files referenced by dataset
metadata and checks the generated owner/UUID key, byte size, and SHA-256. It never
updates PostgreSQL rows or removes source files. It refuses to overwrite a target
whose content differs from the recorded metadata.

Pause uploads throughout the copy and switch. First preview:

```powershell
docker compose run --rm --no-deps backend python manage.py copy_dataset_objects --source-root /app/legacy-media --dry-run
```

After reviewing the preview, explicitly apply the copy:

```powershell
docker compose run --rm --no-deps backend python manage.py copy_dataset_objects --source-root /app/legacy-media --apply
```

Each copied object is read back and verified. Matching target objects are skipped
on subsequent runs. A failure can leave some objects already copied; resolve the
failure and rerun. A network interruption can leave an object needing verification.
Keep the legacy volume as a backup after a successful copy. These commands operate
on the configured database and bucket, so verify configuration before running them.

For a new project with no existing dataset records, no copy is needed. This command
does not import arbitrary unreferenced files from the old volume.

## AWS

Create a dedicated S3 bucket in the deployment region. Enable all S3 Block Public
Access settings and keep Object Ownership set to bucket-owner-enforced (ACLs
disabled). Use server-side encryption and TLS. The application does not provision
AWS infrastructure or change a bucket's permissions automatically.

Set the backend's `DATASET_STORAGE_BACKEND=s3`, `AWS_STORAGE_BUCKET_NAME`, and
`AWS_S3_REGION_NAME`. Omit `AWS_S3_ENDPOINT_URL` for AWS and use virtual-hosted
addressing. Attach a least-privilege IAM role to the EC2 instance or ECS task and
omit static AWS access keys. `django-storages`/boto3 then use the role credential
chain. Local RustFS credentials must never be used for the AWS application.

To select AWS explicitly, use both named files; this skips the automatically
loaded local override and requires no RustFS credentials:

```powershell
docker compose -f compose.yaml -f compose.aws.yaml config --quiet
docker compose -f compose.yaml -f compose.aws.yaml up -d --build
```

The second command recreates the configured application containers and starts
PostgreSQL locally; run it only on the intended deployment host after provisioning
the private bucket, role, TLS, and production environment. It is an operator
example, not an automatic AWS deployment. Existing local files and objects do not
transfer to AWS automatically. AWS bucket provisioning, IAM role attachment, and
deployment remain explicit operator steps.

The role should permit `s3:ListBucket` only for the dataset prefix, and
`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload`, and
`s3:ListMultipartUploadParts` only for
`arn:aws:s3:::YOUR_BUCKET/datasets/*`. Delete access supports cleanup of a newly
written object if the database insert fails. A KMS key requires the corresponding
KMS permissions when using SSE-KMS. Do not grant public or anonymous access.

## Ownership and failure handling

Every request uses the authenticated Django session and server-side validation.
The owner comes from `request.user`; form fields cannot select another owner.
Listing always filters the ORM query by that owner. Objects use generated keys
`datasets/<user-id>/<dataset-uuid>.<format>`; duplicate original filenames do not
overwrite one another. A key prefix organizes files and is not itself an access
control mechanism. The private bucket and backend authorization enforce access.

An upload reports success only after the object write and metadata insert both
finish. Ordinary insert failures attempt to remove only the newly written object;
storage failures return a safe error. Object storage and PostgreSQL do not share
a transaction: process crashes or uncertain network responses can leave orphaned
objects. Reconciliation, antivirus scanning, per-user quotas, and rate limiting
remain future work. Retrieval is not exposed by this feature; a future download
or preview API must check the current owner before accessing the object.

## Validation

Frontend tests cover queue editing, drag and drop, rejected files, submission
locking, partial failures, and session expiry. Backend tests explicitly override
storage with temporary files so unit tests never write to a deployment bucket.
The opt-in `tests.test_object_storage_integration` module requires
`CLOUDETL_TEST_OBJECT_STORAGE=1`, an isolated RustFS endpoint, and a bucket name
starting with `cloudetl-integration-`; it refuses other storage configurations.
Its tests write and remove only temporary test objects. Run it with an isolated
test database and container, never the application bucket. See
[DATASETS.md](DATASETS.md) for the dedicated PostgreSQL test-database procedure
and request validation limits.
