import logging
from functools import wraps

from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.cache import never_cache

from billing import service
from datasets.errors import DatasetError
from views import _json_error, _method_not_allowed, _read_json_object

logger = logging.getLogger(__name__)


def endpoint(method):
    def decorate(function):
        @never_cache
        @wraps(function)
        def wrapped(request, *args, **kwargs):
            if request.method != method:
                return _method_not_allowed([method])
            if not request.user.is_authenticated:
                return _json_error("authentication_required", "Please log in.", 401)
            try:
                return function(request, *args, **kwargs)
            except DatasetError as error:
                return _json_error(error.code, error.message, error.status, error.fields)
            except DatabaseError:
                logger.exception("Billing database operation failed")
                return _json_error("billing_unavailable", "Demo billing is temporarily unavailable.", 503)
        return wrapped
    return decorate


@endpoint("GET")
def overview(request):
    return JsonResponse(service.overview(request.user))


@endpoint("POST")
def orders(request):
    payload, error = _read_json_object(request, {"plan_code"})
    if error is not None:
        return error
    return JsonResponse({"order": service.create_order(request.user, payload.get("plan_code"))}, status=201)


@endpoint("POST")
def complete(request, order_id):
    payload, error = _read_json_object(request, {"outcome"})
    if error is not None:
        return error
    return JsonResponse({"order": service.complete_order(request.user, order_id, payload.get("outcome"))})


@endpoint("POST")
def expire(request):
    _, error = _read_json_object(request, set())
    if error is not None:
        return error
    return JsonResponse(service.expire_subscription(request.user))
