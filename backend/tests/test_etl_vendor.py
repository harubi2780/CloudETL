"""Verify the preserved ETL tool without importing its demonstration runners."""

import hashlib
import json
from pathlib import Path
from unittest import TestCase
from unittest import TestLoader


class EtlVendorIntegrityTests(TestCase):
    def test_discovery_does_not_import_upstream_demo_runner(self):
        backend_dir = Path(__file__).resolve().parents[1]
        loader = TestLoader()
        suite = loader.discover(str(backend_dir / "vendor"), top_level_dir=str(backend_dir))
        self.assertEqual(loader.errors, [])
        self.assertEqual(suite.countTestCases(), 0)

    def test_supplied_tool_files_match_recorded_sha256(self):
        vendor_dir = Path(__file__).resolve().parents[1] / "vendor" / "etl_tool"
        manifest = json.loads((vendor_dir / "SHA256SUMS.json").read_text(encoding="utf-8"))
        self.assertEqual(set(manifest), {
            "extract.py", "transform.py", "load.py", "tool_ETL.py",
            "test_user_choices.py", "orders_sample.csv", "customers_sample.tsv",
            "ket_qua_lam_sach.csv",
        })
        for filename, expected_sha256 in manifest.items():
            with self.subTest(filename=filename):
                actual_sha256 = hashlib.sha256((vendor_dir / filename).read_bytes()).hexdigest()
                self.assertEqual(actual_sha256, expected_sha256)
