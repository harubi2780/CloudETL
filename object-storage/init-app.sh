#!/bin/sh
set -eu

: "${RUSTFS_ROOT_ACCESS_KEY:?RUSTFS_ROOT_ACCESS_KEY is required}"
: "${RUSTFS_ROOT_SECRET_KEY:?RUSTFS_ROOT_SECRET_KEY is required}"
: "${RUSTFS_APP_ACCESS_KEY:?RUSTFS_APP_ACCESS_KEY is required}"
: "${RUSTFS_APP_SECRET_KEY:?RUSTFS_APP_SECRET_KEY is required}"
: "${AWS_STORAGE_BUCKET_NAME:?AWS_STORAGE_BUCKET_NAME is required}"

if [ "$RUSTFS_ROOT_ACCESS_KEY" = "$RUSTFS_APP_ACCESS_KEY" ] || [ "$RUSTFS_ROOT_SECRET_KEY" = "$RUSTFS_APP_SECRET_KEY" ]; then
  echo "RustFS root and application credentials must be distinct" >&2
  exit 1
fi

case "$AWS_STORAGE_BUCKET_NAME" in
  ''|*[!a-z0-9.-]*|.*|*.) echo "AWS_STORAGE_BUCKET_NAME is invalid" >&2; exit 1 ;;
esac
case "$AWS_STORAGE_BUCKET_NAME" in
  *..*) echo "AWS_STORAGE_BUCKET_NAME is invalid" >&2; exit 1 ;;
esac
if [ "${#AWS_STORAGE_BUCKET_NAME}" -lt 3 ] || [ "${#AWS_STORAGE_BUCKET_NAME}" -gt 63 ]; then
  echo "AWS_STORAGE_BUCKET_NAME is invalid" >&2
  exit 1
fi
case "$RUSTFS_APP_ACCESS_KEY" in
  ''|*[!A-Za-z0-9_-]*|rustfsadmin) echo "RUSTFS_APP_ACCESS_KEY is invalid" >&2; exit 1 ;;
esac

export HOME=/tmp/rc-home
mkdir -p "$HOME"
rc alias set bootstrap http://rustfs:9000 "$RUSTFS_ROOT_ACCESS_KEY" "$RUSTFS_ROOT_SECRET_KEY" >/dev/null

ready=0
for attempt in $(seq 1 60); do
  if rc ready bootstrap >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "RustFS did not become ready within 120 seconds" >&2
  exit 1
fi

bucket="bootstrap/$AWS_STORAGE_BUCKET_NAME"
if ! rc ls "$bucket" >/dev/null 2>&1; then
  rc mb "$bucket" >/dev/null
fi

policy_file=/tmp/cloudetl-datasets-policy.json
cat > "$policy_file" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::$AWS_STORAGE_BUCKET_NAME"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::$AWS_STORAGE_BUCKET_NAME"],
      "Condition": {"StringLike": {"s3:prefix": ["datasets/*"]}}
    },
    {
      "Effect": "Allow",
      "Action": ["s3:AbortMultipartUpload", "s3:DeleteObject", "s3:GetObject", "s3:ListMultipartUploadParts", "s3:PutObject"],
      "Resource": ["arn:aws:s3:::$AWS_STORAGE_BUCKET_NAME/datasets/*"]
    }
  ]
}
EOF

rc admin policy create bootstrap cloudetl-datasets "$policy_file" >/dev/null
rc admin user add bootstrap "$RUSTFS_APP_ACCESS_KEY" "$RUSTFS_APP_SECRET_KEY" >/dev/null
rc admin policy attach bootstrap cloudetl-datasets --user "$RUSTFS_APP_ACCESS_KEY" >/dev/null
rc anonymous set private "$bucket" >/dev/null
rm -f "$policy_file"
