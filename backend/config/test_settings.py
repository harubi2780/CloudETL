"""Isolated PostgreSQL test settings; never load application credentials or .env.

Use only with a disposable PostgreSQL instance (see the ETL handoff documents).
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = "isolated-tests-only-not-for-deployment"
DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost"]
INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    "datasets.apps.DatasetsConfig", "etl.apps.EtlConfig",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware", "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware", "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware", "django.contrib.messages.middleware.MessageMiddleware",
]
ROOT_URLCONF = "config.urls"
CSRF_FAILURE_VIEW = "views.csrf_failure"
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "APP_DIRS": True,
              "OPTIONS": {"context_processors": ["django.template.context_processors.request",
              "django.contrib.auth.context_processors.auth", "django.contrib.messages.context_processors.messages"]}}]
DATABASES = {"default": {
    "ENGINE": "django.db.backends.postgresql",
    "NAME": os.getenv("ETL_TEST_DB_NAME", "cloudetl_etl_tests"),
    "USER": "cloudetl_test",
    "PASSWORD": "isolated-test-only",
    "HOST": os.getenv("ETL_TEST_DB_HOST", "cloudetl-etl-test-db"),
    "PORT": os.getenv("ETL_TEST_DB_PORT", "5432"),
    "TEST": {"NAME": "test_cloudetl_etl_tests"},
}}
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
STATIC_URL = "/static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "UTC"
DATASET_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
FILE_UPLOAD_HANDLERS = [
    "datasets.upload_handlers.DatasetSizeLimitHandler", "django.core.files.uploadhandler.MemoryFileUploadHandler",
    "django.core.files.uploadhandler.TemporaryFileUploadHandler",
]
FILE_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 16 * 1024
ETL_RUN_TIMEOUT_SECONDS = 300
MEDIA_ROOT = os.getenv("ETL_TEST_MEDIA_ROOT", "/tmp/cloudetl-etl-test-media")
