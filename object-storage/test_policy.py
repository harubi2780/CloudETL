"""Check bootstrap access covers source/results without public or bucket-wide grants."""
import json
from pathlib import Path
from unittest import TestCase


class StoragePolicyTests(TestCase):
    def test_application_access_is_limited_to_source_and_result_prefixes(self):
        script = Path(__file__).with_name("init-app.sh").read_text(encoding="utf-8")
        document = script.split('cat > "$policy_file" <<EOF\n', 1)[1].split('\nEOF', 1)[0]
        statements = json.loads(document)["Statement"]
        self.assertEqual(len(statements), 3)
        listing = next(item for item in statements if "s3:ListBucket" in item["Action"])
        self.assertEqual(set(listing["Condition"]["StringLike"]["s3:prefix"]), {"datasets/*", "etl/*"})
        objects = next(item for item in statements if "s3:PutObject" in item["Action"])
        prefix = "arn:aws:s3:::$AWS_STORAGE_BUCKET_NAME/"
        self.assertEqual(set(objects["Resource"]), {prefix + "datasets/*", prefix + "etl/*"})
        self.assertEqual(set(objects["Action"]), {"s3:AbortMultipartUpload", "s3:DeleteObject", "s3:GetObject", "s3:ListMultipartUploadParts", "s3:PutObject"})
        self.assertTrue(all(item["Effect"] == "Allow" and "Principal" not in item for item in statements))
        self.assertIn('rc anonymous set private "$bucket"', script)
