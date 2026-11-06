"""Build a private dataset storage backend from explicit environment settings."""

import os
import re
from urllib.parse import urlsplit

from botocore.config import Config
from django.core.exceptions import ImproperlyConfigured


_BUCKET_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")


def _valid_bucket_name(bucket):
    return (
        3 <= len(bucket) <= 63
        and ".." not in bucket
        and not re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}", bucket)
        and all(_BUCKET_LABEL.fullmatch(label) for label in bucket.split("."))
    )


def _required(env, name):
    value = env.get(name, "").strip()
    if not value:
        raise ImproperlyConfigured(f"{name} must be configured for S3 dataset storage.")
    return value


def build_dataset_storage(env=None):
    """Return a Django STORAGES default entry; never infer filesystem fallback."""
    env = os.environ if env is None else env
    backend = env.get("DATASET_STORAGE_BACKEND", "s3").strip().lower()

    if backend == "filesystem":
        return {"BACKEND": "django.core.files.storage.FileSystemStorage"}
    if backend != "s3":
        raise ImproperlyConfigured("DATASET_STORAGE_BACKEND must be 's3' or the explicit test mode 'filesystem'.")

    bucket = _required(env, "AWS_STORAGE_BUCKET_NAME")
    if not _valid_bucket_name(bucket):
        raise ImproperlyConfigured("AWS_STORAGE_BUCKET_NAME must be a valid lowercase S3 bucket name.")
    region = _required(env, "AWS_S3_REGION_NAME")

    access_key = env.get("AWS_ACCESS_KEY_ID", "").strip()
    secret_key = env.get("AWS_SECRET_ACCESS_KEY", "").strip()
    if bool(access_key) != bool(secret_key):
        raise ImproperlyConfigured("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be supplied together.")

    options = {
        "bucket_name": bucket,
        "region_name": region,
        "default_acl": None,
        "querystring_auth": True,
        "file_overwrite": False,
        "addressing_style": env.get("AWS_S3_ADDRESSING_STYLE", "virtual").strip().lower(),
        "signature_version": "s3v4",
        "max_memory_size": 5 * 1024 * 1024,
    }
    if options["addressing_style"] not in {"path", "virtual"}:
        raise ImproperlyConfigured("AWS_S3_ADDRESSING_STYLE must be 'path' or 'virtual'.")

    options["client_config"] = Config(
        signature_version="s3v4",
        connect_timeout=2,
        read_timeout=6,
        retries={"mode": "standard", "total_max_attempts": 2},
        s3={"addressing_style": options["addressing_style"]},
    )

    endpoint = env.get("AWS_S3_ENDPOINT_URL", "").strip()
    if endpoint:
        try:
            parsed = urlsplit(endpoint)
            parsed.port
        except ValueError as exc:
            raise ImproperlyConfigured("AWS_S3_ENDPOINT_URL must be a valid HTTPS endpoint.") from exc
        if (
            parsed.scheme == "https"
            and parsed.hostname
            and not parsed.username
            and not parsed.password
            and not parsed.query
            and not parsed.fragment
        ):
            options["endpoint_url"] = endpoint.rstrip("/")
        elif (
            parsed.scheme == "http"
            and parsed.hostname == "rustfs"
            and not parsed.username
            and not parsed.password
            and not parsed.query
            and not parsed.fragment
        ):
            # This exact service name is reachable only on the private Compose network.
            if not access_key:
                raise ImproperlyConfigured("The internal RustFS endpoint requires explicit application credentials.")
            options["endpoint_url"] = endpoint.rstrip("/")
        else:
            raise ImproperlyConfigured("AWS_S3_ENDPOINT_URL must use HTTPS; only the internal Compose RustFS endpoint may use HTTP.")

    if access_key:
        options["access_key"] = access_key
        options["secret_key"] = secret_key

    return {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": options,
    }
