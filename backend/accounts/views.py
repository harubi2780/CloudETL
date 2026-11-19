import logging

from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.cache import never_cache

from services.storage_service import entitlement, owner_storage_lock, usage_locked
from views import _json_error, _method_not_allowed

logger = logging.getLogger(__name__)


@never_cache
def profile(request):
    if request.method != "GET":
        return _method_not_allowed(["GET"])
    if not request.user.is_authenticated:
        return _json_error("authentication_required", "Please log in.", 401)
    user = request.user
    try:
        with owner_storage_lock(user):
            account = {"id": user.pk, "username": user.get_username(), "email": user.email or "",
                       "status": "active" if user.is_active else "inactive", "joined_at": user.date_joined.isoformat(),
                       "plan": entitlement(user)["plan"], "storage": usage_locked(user)}
        return JsonResponse({"account": account})
    except DatabaseError:
        logger.exception("Account profile lookup failed")
        return _json_error("account_unavailable", "Your account information is temporarily unavailable.", 503)
