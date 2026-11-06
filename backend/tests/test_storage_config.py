from unittest import TestCase

from django.core.exceptions import ImproperlyConfigured

from storage_config import build_dataset_storage


class DatasetStorageConfigTests(TestCase):
    def test_filesystem_backend_is_explicit(self):
        self.assertEqual(
            build_dataset_storage({"DATASET_STORAGE_BACKEND": "filesystem"}),
            {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        )

    def test_s3_is_default_and_uses_role_chain_without_static_credentials(self):
        storage = build_dataset_storage({
            "AWS_STORAGE_BUCKET_NAME": "cloudetl-datasets",
            "AWS_S3_REGION_NAME": "us-east-1",
        })
        options = storage["OPTIONS"]
        self.assertEqual(storage["BACKEND"], "storages.backends.s3.S3Storage")
        self.assertEqual(options["bucket_name"], "cloudetl-datasets")
        self.assertEqual(options["default_acl"], None)
        self.assertTrue(options["querystring_auth"])
        self.assertFalse(options["file_overwrite"])
        self.assertNotIn("access_key", options)
        self.assertNotIn("secret_key", options)
        self.assertEqual(options["client_config"].connect_timeout, 2)
        self.assertEqual(options["client_config"].read_timeout, 6)
        self.assertEqual(options["client_config"].retries["total_max_attempts"], 2)
        self.assertEqual(options["client_config"].s3["addressing_style"], "virtual")
        self.assertEqual(options["client_config"].signature_version, "s3v4")

    def test_internal_rustfs_endpoint_and_static_credentials_are_explicit(self):
        options = build_dataset_storage({
            "AWS_STORAGE_BUCKET_NAME": "cloudetl-datasets",
            "AWS_S3_REGION_NAME": "us-east-1",
            "AWS_S3_ENDPOINT_URL": "http://rustfs:9000/",
            "AWS_S3_ADDRESSING_STYLE": "path",
            "AWS_ACCESS_KEY_ID": "CLOUDETL_APP",
            "AWS_SECRET_ACCESS_KEY": "test-only-secret-value",
        })["OPTIONS"]
        self.assertEqual(options["endpoint_url"], "http://rustfs:9000")
        self.assertEqual(options["addressing_style"], "path")
        self.assertEqual(options["client_config"].s3["addressing_style"], "path")
        self.assertEqual(options["access_key"], "CLOUDETL_APP")
        self.assertEqual(options["secret_key"], "test-only-secret-value")

    def test_incomplete_or_unsafe_s3_configuration_fails_without_echoing_secrets(self):
        configurations = (
            ({}, "AWS_STORAGE_BUCKET_NAME"),
            ({"AWS_STORAGE_BUCKET_NAME": "bad..bucket", "AWS_S3_REGION_NAME": "us-east-1"}, "AWS_STORAGE_BUCKET_NAME"),
            ({"AWS_STORAGE_BUCKET_NAME": "cloudetl-datasets"}, "AWS_S3_REGION_NAME"),
            ({"AWS_STORAGE_BUCKET_NAME": "cloudetl-datasets", "AWS_S3_REGION_NAME": "us-east-1", "AWS_ACCESS_KEY_ID": "only-one"}, "AWS_ACCESS_KEY_ID"),
            ({"AWS_STORAGE_BUCKET_NAME": "cloudetl-datasets", "AWS_S3_REGION_NAME": "us-east-1", "AWS_S3_ENDPOINT_URL": "http://rustfs:9000"}, "application credentials"),
            ({"AWS_STORAGE_BUCKET_NAME": "cloudetl-datasets", "AWS_S3_REGION_NAME": "us-east-1", "AWS_S3_ENDPOINT_URL": "https://objects.example.com:bad"}, "valid HTTPS endpoint"),
            ({"AWS_STORAGE_BUCKET_NAME": "cloudetl-datasets", "AWS_S3_REGION_NAME": "us-east-1", "AWS_S3_ENDPOINT_URL": "http://objects.example.com", "AWS_ACCESS_KEY_ID": "private-access", "AWS_SECRET_ACCESS_KEY": "private-secret"}, "HTTPS"),
            ({"DATASET_STORAGE_BACKEND": "unknown"}, "DATASET_STORAGE_BACKEND"),
        )
        for env, message in configurations:
            with self.subTest(env=sorted(env)):
                with self.assertRaises(ImproperlyConfigured) as raised:
                    build_dataset_storage(env)
                self.assertIn(message, str(raised.exception))
                self.assertNotIn("private-access", str(raised.exception))
                self.assertNotIn("private-secret", str(raised.exception))
