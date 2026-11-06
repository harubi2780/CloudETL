"""Opt-in real RustFS checks; refuse buckets that are not explicitly test-only."""

import hashlib
import os
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import skipUnless
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import urlopen

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.files.storage import storages
from django.core.management import call_command
from django.db import IntegrityError
from django.test import Client, TestCase, override_settings

from datasets.models import Dataset


@skipUnless(os.getenv("CLOUDETL_TEST_OBJECT_STORAGE") == "1", "Requires isolated test-only RustFS storage.")
@override_settings(ALLOWED_HOSTS=["testserver"])
class DatasetObjectStorageIntegrationTests(TestCase):
    @classmethod
    def setUpClass(cls):
        config = settings.STORAGES["default"]
        options = config.get("OPTIONS", {})
        bucket = options.get("bucket_name", "")
        if (
            config["BACKEND"] != "storages.backends.s3.S3Storage"
            or not bucket.startswith("cloudetl-integration-")
            or options.get("endpoint_url") != "http://rustfs:9000"
        ):
            raise ImproperlyConfigured("Integration checks require an isolated RustFS bucket named cloudetl-integration-*.")
        cls.bucket = bucket
        super().setUpClass()

    def setUp(self):
        self.storage = storages["default"]
        self.user = get_user_model().objects.create_user(username="object-owner")
        self.other = get_user_model().objects.create_user(username="other-object-owner")

    def session(self, user):
        client = Client(enforce_csrf_checks=True)
        client.force_login(user)
        token = client.get("/api/auth/csrf/").json()["csrfToken"]
        return client, token

    def post(self, client, token, content=b"id,value\n1,private\n"):
        return client.post("/api/datasets/", {"file": SimpleUploadedFile("same.csv", content)},
                           HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="http://testserver")

    def uploaded(self, client, token, content=b"id,value\n1,private\n"):
        response = self.post(client, token, content)
        self.assertEqual(response.status_code, 201, response.content)
        dataset = Dataset.objects.get(pk=response.json()["dataset"]["id"])
        # Cleanup is restricted by the test-only bucket guard above.
        self.addCleanup(self.storage.delete, dataset.file.name)
        return dataset

    def test_original_bytes_metadata_and_two_users_are_separate(self):
        first_client, first_token = self.session(self.user)
        second_client, second_token = self.session(self.other)
        content = b"id,value\n1,private\n"
        first = self.uploaded(first_client, first_token, content)
        second = self.uploaded(second_client, second_token, b"id,value\n2,other\n")
        self.assertNotEqual(first.file.name, second.file.name)
        self.assertEqual(first.file.name, f"datasets/{self.user.pk}/{first.pk}.csv")
        self.assertEqual(second.file.name, f"datasets/{self.other.pk}/{second.pk}.csv")
        with self.storage.open(first.file.name, "rb") as stored:
            self.assertEqual(stored.read(), content)
        self.assertEqual(first.owner_id, self.user.pk)
        self.assertEqual(first.size_bytes, len(content))
        self.assertEqual(first.sha256, hashlib.sha256(content).hexdigest())
        first_list = first_client.get("/api/datasets/", {"owner": self.other.pk}).json()
        second_list = second_client.get("/api/datasets/").json()
        self.assertEqual([item["id"] for item in first_list["datasets"]], [str(first.pk)])
        self.assertEqual([item["id"] for item in second_list["datasets"]], [str(second.pk)])
        self.assertNotIn(first.file.name, str(first_list))
        self.assertNotIn("url", first_list["datasets"][0])

    def test_insert_failure_removes_only_the_new_object(self):
        client, token = self.session(self.user)
        existing = self.uploaded(client, token)
        with patch("services.dataset_service.insert_dataset", side_effect=IntegrityError("private database detail")), \
                patch.object(self.storage, "delete", wraps=self.storage.delete) as deleted, \
                self.assertLogs("services.dataset_service", level="ERROR"):
            response = self.post(client, token)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private database detail", response.content.decode())
        deleted.assert_called_once()
        removed = deleted.call_args.args[0]
        self.assertNotEqual(removed, existing.file.name)
        self.assertFalse(self.storage.exists(removed))
        self.assertTrue(self.storage.exists(existing.file.name))
        self.assertEqual(Dataset.objects.count(), 1)

    def test_multipart_upload_preserves_bytes_with_scoped_credentials(self):
        client, token = self.session(self.user)
        content = b"id,value\n" + (b"1," + b"x" * 90 + b"\n") * 100_000
        self.assertGreater(len(content), 8 * 1024 * 1024)
        dataset = self.uploaded(client, token, content)
        digest = hashlib.sha256()
        with self.storage.open(dataset.file.name, "rb") as stored:
            for chunk in iter(lambda: stored.read(1024 * 1024), b""):
                digest.update(chunk)
        self.assertEqual(digest.hexdigest(), hashlib.sha256(content).hexdigest())
        self.assertEqual(dataset.size_bytes, len(content))

    def test_legacy_copy_preserves_reference_and_verifies_real_s3_object(self):
        content = b"id,value\n1,legacy\n"
        dataset = Dataset(owner=self.user, filename="legacy.csv", format="csv",
                          size_bytes=len(content), sha256=hashlib.sha256(content).hexdigest())
        name = f"datasets/{self.user.pk}/{dataset.pk}.csv"
        dataset.file.name = name
        dataset.save()
        self.addCleanup(self.storage.delete, name)
        with TemporaryDirectory(prefix="cloudetl-legacy-integration-") as directory:
            path = Path(directory) / name
            path.parent.mkdir(parents=True)
            path.write_bytes(content)
            call_command("copy_dataset_objects", "--source-root", directory, stdout=StringIO())
            self.assertFalse(self.storage.exists(name))
            call_command("copy_dataset_objects", "--source-root", directory, "--apply", stdout=StringIO())
            with self.storage.open(name, "rb") as stored:
                self.assertEqual(stored.read(), content)
            self.assertEqual(path.read_bytes(), content)
        dataset.refresh_from_db()
        self.assertEqual(dataset.file.name, name)

    def test_bucket_and_object_are_not_readable_anonymously(self):
        client, token = self.session(self.user)
        dataset = self.uploaded(client, token)
        for suffix in ("", "/" + dataset.file.name):
            with self.subTest(suffix=suffix):
                with self.assertRaises(HTTPError) as raised:
                    with urlopen(f"http://rustfs:9000/{self.bucket}{suffix}", timeout=5) as response:
                        response.read(1)
                self.assertEqual(raised.exception.code, 403)

    def test_anonymous_upload_never_reaches_object_storage(self):
        client = Client(enforce_csrf_checks=True)
        token = client.get("/api/auth/csrf/").json()["csrfToken"]
        with patch.object(self.storage, "save", wraps=self.storage.save) as save:
            response = self.post(client, token)
        self.assertEqual(response.status_code, 401)
        save.assert_not_called()
        self.assertEqual(Dataset.objects.count(), 0)
