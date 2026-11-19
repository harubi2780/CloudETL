"""Local payment simulator. No gateway credentials, network calls or real money."""
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from billing.models import PaymentOrder, Subscription
from billing.catalog import DEMO_AMOUNT_VND, PERIOD_DAYS, PREMIUM_BYTES
from datasets.errors import DatasetError
from services.storage_service import owner_storage_lock

def plans():
    return [
        {"code": "free", "name": "Free", "storage_limit_bytes": settings.ACCOUNT_STORAGE_LIMIT_BYTES,
         "amount_vnd": 0, "period_days": None},
        {"code": "premium", "name": "Premium", "storage_limit_bytes": PREMIUM_BYTES,
         "amount_vnd": DEMO_AMOUNT_VND, "period_days": PERIOD_DAYS},
    ]


def require_demo():
    if not settings.BILLING_DEMO_ENABLED:
        raise DatasetError("Demo payments are disabled.", code="demo_disabled", status=403)


def ensure_demo_account(user):
    if Subscription.objects.filter(owner=user).exclude(provider="demo").exists():
        raise DatasetError("A demo checkout cannot change a non-demo subscription.", code="demo_subscription_conflict", status=409)


def public_order(order):
    status = order.status
    if status == PaymentOrder.Status.PENDING and order.expires_at <= timezone.now():
        status = PaymentOrder.Status.EXPIRED
    return {"id": str(order.pk), "plan_code": order.plan_code, "plan_name": order.plan_name,
            "amount_vnd": order.amount_vnd, "currency": order.currency, "period_days": order.period_days,
            "status": status, "created_at": order.created_at.isoformat(), "expires_at": order.expires_at.isoformat(),
            "completed_at": order.completed_at.isoformat() if order.completed_at else None}


def overview(user):
    with owner_storage_lock(user):
        subscription = Subscription.objects.filter(owner=user, provider="demo").first()
        status = "free"
        if subscription:
            status = "active" if settings.BILLING_DEMO_ENABLED and subscription.current_period_end > timezone.now() else "expired"
        return {"demo_enabled": settings.BILLING_DEMO_ENABLED, "plans": plans(),
                "subscription": {"status": status, "current_period_end": subscription.current_period_end.isoformat() if subscription else None},
                "orders": [public_order(order) for order in PaymentOrder.objects.filter(owner=user)[:20]]}


def create_order(user, plan_code):
    require_demo()
    if plan_code != "premium":
        raise DatasetError("Choose the Premium demo plan.", code="invalid_plan")
    with owner_storage_lock(user):
        ensure_demo_account(user)
        now = timezone.now()
        PaymentOrder.objects.filter(owner=user, provider="demo", status="pending", expires_at__lte=now).update(status="expired", completed_at=now)
        order = PaymentOrder.objects.filter(owner=user, provider="demo", status="pending").first()
        if order is None:
            order = PaymentOrder.objects.create(owner=user, amount_vnd=DEMO_AMOUNT_VND,
                                                period_days=PERIOD_DAYS, storage_limit_bytes=PREMIUM_BYTES,
                                                expires_at=now + timedelta(minutes=15))
        return public_order(order)


def complete_order(user, order_id, outcome):
    require_demo()
    if outcome not in ("succeeded", "failed", "cancelled"):
        raise DatasetError("Choose a valid simulated payment result.", code="invalid_outcome")
    with owner_storage_lock(user):
        ensure_demo_account(user)
        try:
            order = PaymentOrder.objects.select_for_update().get(owner=user, pk=order_id, provider="demo")
        except PaymentOrder.DoesNotExist as error:
            raise DatasetError("Payment order not found.", code="order_not_found", status=404) from error
        if order.status == PaymentOrder.Status.EXPIRED:
            raise DatasetError("This checkout has expired. Start a new demo checkout.", code="checkout_expired", status=410)
        if order.status != PaymentOrder.Status.PENDING:
            if order.status == outcome:
                return public_order(order)
            raise DatasetError("This payment order has already finished.", code="order_finished", status=409)
        now = timezone.now()
        if order.expires_at <= now:
            raise DatasetError("This checkout has expired. Start a new demo checkout.", code="checkout_expired", status=410)
        if outcome == "succeeded":
            subscription = Subscription.objects.filter(owner=user, provider="demo").first()
            period_start = max(now, subscription.current_period_end) if subscription else now
            Subscription.objects.update_or_create(owner=user, defaults={
                "provider": "demo", "current_period_end": period_start + timedelta(days=order.period_days),
            })
        order.status = outcome
        order.completed_at = now
        order.save(update_fields=["status", "completed_at"])
        return public_order(order)


def expire_subscription(user):
    require_demo()
    with owner_storage_lock(user):
        changed = Subscription.objects.filter(owner=user, provider="demo", current_period_end__gt=timezone.now()).update(current_period_end=timezone.now())
        if not changed:
            raise DatasetError("There is no active demo Premium subscription.", code="subscription_not_active", status=409)
    return {"expired": True}
