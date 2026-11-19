"""Per-owner admission, durable write reservations, and conservative cleanup.

All metadata mutations and reservations take the same existing User row lock.
Object I/O never holds that lock. Never expire a reservation solely by age: a
crashed writer may already have stored bytes that require reconciliation.
"""
import logging
import re
from contextlib import contextmanager

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from accounts.models import AccountEntitlement, StorageReservation
from datasets.errors import DatasetError
from datasets.models import Dataset
from etl.models import ETLRun

logger = logging.getLogger(__name__)


@contextmanager
def owner_storage_lock(user):
    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=user.pk)
        yield


def entitlement(user):
    stored = AccountEntitlement.objects.filter(owner=user).first()
    # Resolve time-bound demo access on EVERY admission/read, including worker
    # result publication. Expiry does not depend on visiting the Account page.
    if settings.BILLING_DEMO_ENABLED:
        from billing.models import Subscription
        from billing.catalog import PREMIUM_BYTES
        if Subscription.objects.filter(owner=user, provider="demo", current_period_end__gt=timezone.now()).exists():
            return {"plan": {"code": "premium", "name": "Premium"}, "limit_bytes": PREMIUM_BYTES}
    return {
        "plan": {"code": stored.plan_code, "name": stored.plan_name} if stored else {"code": "free", "name": "Free"},
        "limit_bytes": (stored.storage_limit_bytes if stored and stored.storage_limit_bytes is not None
                        else settings.ACCOUNT_STORAGE_LIMIT_BYTES),
    }


def _sum(queryset, field):
    return queryset.aggregate(total=Sum(field))["total"] or 0


def usage_locked(user):
    """Called inside owner_storage_lock, including the admission transaction."""
    limit = entitlement(user)["limit_bytes"]
    uploads = _sum(Dataset.objects.filter(owner=user), "size_bytes")
    results = _sum(ETLRun.objects.filter(owner=user).exclude(result=""), "size_bytes")
    pending = StorageReservation.objects.filter(owner=user)
    cleanup = _sum(pending.filter(state=StorageReservation.State.CLEANUP), "size_bytes")
    reserved = _sum(pending.filter(state=StorageReservation.State.WRITING), "reserved_bytes")
    used = uploads + results + cleanup
    return {"limit_bytes": limit, "used_bytes": used, "uploaded_bytes": uploads,
            "result_bytes": results, "pending_cleanup_bytes": cleanup, "reserved_bytes": reserved,
            "available_bytes": max(0, limit - used - reserved), "over_limit": used + reserved > limit}


def storage_usage(user):
    with owner_storage_lock(user):
        return usage_locked(user)


def ensure_target_idle_locked(user, target):
    if StorageReservation.objects.filter(owner=user, target=target, state=StorageReservation.State.WRITING).exists():
        raise DatasetError("This file is being updated. Please try again shortly.", code="file_busy", status=409)


def reserve_locked(user, *, target, object_key, size_bytes, credit_bytes=0):
    ensure_target_idle_locked(user, target)
    growth = max(0, size_bytes - credit_bytes)
    usage = usage_locked(user)
    # Equal/smaller replacements remain possible for legacy accounts over quota.
    # Once failed cleanups fill the account, require cleanup before staging any
    # more bytes: repeated zero-growth replacements must not accumulate orphans.
    cleanup_blocks_write = usage["pending_cleanup_bytes"] > 0 and usage["used_bytes"] + usage["reserved_bytes"] >= usage["limit_bytes"]
    if (growth and growth > usage["available_bytes"]) or cleanup_blocks_write:
        raise DatasetError("Your account does not have enough storage. Free up space and try again.",
                           code="storage_quota_exceeded", status=413,
                           fields={"storage": {**usage, "required_bytes": growth}})
    return StorageReservation.objects.create(owner=user, target=target, object_key=object_key,
                                             size_bytes=size_bytes, reserved_bytes=growth)


def mark_cleanup_locked(reservation, *, object_key=None, size_bytes=None):
    reservation.state = StorageReservation.State.CLEANUP
    reservation.reserved_bytes = 0
    if object_key is not None:
        reservation.object_key = object_key
    if size_bytes is not None:
        reservation.size_bytes = size_bytes
    reservation.save(update_fields=["state", "reserved_bytes", "object_key", "size_bytes"])


def cleanup_reservation(reservation, storage):
    """Only release charged bytes after an idempotent object deletion succeeds."""
    if reservation.state != StorageReservation.State.CLEANUP:
        raise ValueError("A live write cannot be cleaned up.")
    try:
        storage.delete(reservation.object_key)
        with owner_storage_lock(reservation.owner):
            StorageReservation.objects.filter(pk=reservation.pk, state=StorageReservation.State.CLEANUP,
                                              object_key=reservation.object_key).delete()
    except Exception:
        logger.exception("Storage cleanup failed for reservation %s; bytes remain charged", reservation.pk)
        return False
    return True


def abandon_reservation(reservation, storage, *, object_key=None):
    """A failed write may have persisted bytes even when save raised an error."""
    with owner_storage_lock(reservation.owner):
        current = StorageReservation.objects.select_for_update().filter(pk=reservation.pk).first()
        if current is None:
            return True
        # Publication may have committed even if its acknowledgement failed.
        # A cleanup row then belongs to the detached OLD object; never redirect
        # it toward the replacement that is now referenced by the dataset.
        if current.state == StorageReservation.State.WRITING:
            mark_cleanup_locked(current, object_key=object_key)
    return cleanup_reservation(current, storage)


def set_storage_entitlement(user, *, limit_bytes, plan_code="free", plan_name="Free"):
    """Internal extension point for a future verified subscription handler.

    Never expose this through a client-writable profile endpoint. Reducing an
    allowance preserves existing data and simply prevents further growth.
    """
    if (isinstance(limit_bytes, bool) or not isinstance(limit_bytes, int) or not 0 < limit_bytes <= 2**63 - 1
            or not isinstance(plan_code, str) or not re.fullmatch(r"[-a-zA-Z0-9_]{1,64}", plan_code)
            or not isinstance(plan_name, str) or not plan_name.strip() or len(plan_name) > 80):
        raise ValueError("Enter a valid storage allowance and plan.")
    with owner_storage_lock(user):
        record, _ = AccountEntitlement.objects.update_or_create(owner=user, defaults={
            "storage_limit_bytes": limit_bytes, "plan_code": plan_code, "plan_name": plan_name.strip(),
        })
        return record
