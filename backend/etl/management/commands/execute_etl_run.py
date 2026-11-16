from django.core.management.base import BaseCommand

from services.etl_service import execute_run


class Command(BaseCommand):
    help = "Execute a claimed ETL run (internal worker subprocess)."

    def add_arguments(self, parser):
        parser.add_argument("run_id")
        parser.add_argument("claim_token")

    def handle(self, *args, **options):
        execute_run(options["run_id"], options["claim_token"])
