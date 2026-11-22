import os
import signal
import subprocess
import sys
import time

DISABLED_VALUES = {"0", "false", "no", "off"}
SHUTDOWN_TIMEOUT_SECONDS = 10.0
POLL_INTERVAL_SECONDS = 0.5


def is_etl_worker_enabled() -> bool:
    """Return True unless ENABLE_ETL_WORKER is explicitly set to a falsy value."""
    value = os.environ.get("ENABLE_ETL_WORKER", "true").strip().lower()
    return value not in DISABLED_VALUES


def terminate_children(children: list[tuple[str, subprocess.Popen]]) -> None:
    """Send SIGTERM to all running child processes."""
    for _name, proc in children:
        if proc.poll() is None:
            try:
                proc.terminate()
            except OSError:
                pass


def wait_or_kill_children(
    children: list[tuple[str, subprocess.Popen]],
    timeout: float = SHUTDOWN_TIMEOUT_SECONDS,
) -> None:
    """Wait up to timeout seconds for children to exit, then SIGKILL stragglers."""
    deadline = time.monotonic() + timeout
    for _name, proc in children:
        if proc.poll() is not None:
            continue
        remaining = max(0.0, deadline - time.monotonic())
        try:
            proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
            except OSError:
                pass
            try:
                proc.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                pass


def start_processes() -> list[tuple[str, subprocess.Popen]]:
    """Start Gunicorn and optionally the background ETL worker."""
    gunicorn_workers = os.environ.get("GUNICORN_WORKERS", "3").strip() or "3"
    commands: list[tuple[str, list[str]]] = [
        (
            "gunicorn",
            [
                sys.executable,
                "-m",
                "gunicorn",
                "config.wsgi:application",
                "--bind",
                "0.0.0.0:8000",
                "--workers",
                gunicorn_workers,
                "--access-logfile",
                "-",
                "--error-logfile",
                "-",
            ],
        ),
    ]
    if is_etl_worker_enabled():
        commands.append(
            ("etl-worker", [sys.executable, "manage.py", "run_etl_worker"])
        )

    children: list[tuple[str, subprocess.Popen]] = []
    try:
        for name, cmd in commands:
            proc = subprocess.Popen(cmd)
            children.append((name, proc))
    except Exception:
        terminate_children(children)
        wait_or_kill_children(children)
        raise
    return children


def main() -> int:
    """Run collectstatic, supervise Gunicorn and the ETL worker, and handle shutdown."""
    subprocess.run([sys.executable, "manage.py", "collectstatic", "--noinput"], check=True)

    children = start_processes()
    stopping = False

    def handle_signal(_signum: int, _frame: object) -> None:
        nonlocal stopping
        if not stopping:
            stopping = True
            terminate_children(children)

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    while True:
        if stopping:
            wait_or_kill_children(children)
            return 0

        for name, proc in children:
            rc = proc.poll()
            if rc is not None:
                if stopping:
                    wait_or_kill_children(children)
                    return 0
                print(
                    f"{name} exited unexpectedly with code {rc}",
                    file=sys.stderr,
                    flush=True,
                )
                terminate_children(children)
                wait_or_kill_children(children)
                return rc if rc != 0 else 1

        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
