import subprocess
import sys
import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from services.etl_service import claim_next_run, expire_stale_runs, fail_run


class Command(BaseCommand):
    help = "Poll PostgreSQL for ETL jobs and execute each in a time-limited subprocess."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Process at most one queued run, then exit.")
        parser.add_argument("--poll-interval", type=float, default=2)

    def handle(self, *args, **options):
        interval = options["poll_interval"]
        if not 0.1 <= interval <= 60:
            raise CommandError("--poll-interval must be between 0.1 and 60 seconds.")
        try:
            while True:
                close_old_connections()
                expire_stale_runs()
                run = claim_next_run()
                if run is not None:
                    try:
                        subprocess.run([sys.executable, str(settings.BASE_DIR / "manage.py"), "execute_etl_run", str(run.pk), str(run.claim_token)],
                                       check=True, timeout=settings.ETL_RUN_TIMEOUT_SECONDS)
                        # Also fail a child that exited without publishing a terminal state.
                        fail_run(run.pk, run.claim_token, "worker_interrupted", "ETL execution did not finish. Submit a new run.")
                    except subprocess.TimeoutExpired:
                        fail_run(run.pk, run.claim_token, "execution_timeout", "ETL execution exceeded its time limit.")
                    except (subprocess.CalledProcessError, OSError):
                        fail_run(run.pk, run.claim_token, "worker_interrupted", "The ETL worker could not complete this run.")
                if options["once"]:
                    return
                if run is None:
                    time.sleep(interval)
        except KeyboardInterrupt:
            self.stdout.write("ETL worker stopped.")
