"""Retry only objects already detached from user-visible file metadata."""
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand

from accounts.models import StorageReservation
from services.storage_service import cleanup_reservation


class Command(BaseCommand):
    help = "Inspect pending object cleanups. --apply retries deletion and releases their quota after success."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--owner-id", type=int)

    def handle(self, *args, **options):
        rows = StorageReservation.objects.filter(state=StorageReservation.State.CLEANUP).select_related("owner")
        if options["owner_id"] is not None:
            rows = rows.filter(owner_id=options["owner_id"])
        processed = failed = total_bytes = 0
        for row in rows.iterator():
            total_bytes += row.size_bytes
            if not options["apply"] or cleanup_reservation(row, default_storage):
                processed += 1
            else:
                failed += 1
        action = "cleaned" if options["apply"] else "would clean"
        self.stdout.write(f"{processed} {action}, {failed} failed; {total_bytes} bytes inspected.")
