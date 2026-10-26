import json
from json import JSONDecodeError

from django.core.exceptions import RequestDataTooBig
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils.cache import patch_cache_control
from django.views.decorators.cache import never_cache
from django.views.csrf import csrf_failure as default_csrf_failure

from services.auth_service import (
    AuthServiceError,
    current_profile,
    login_account,
    logout_account,
    public_profile,
    register_account,
)

MAX_JSON_BODY_BYTES = 16 * 1024
MAX_PASSWORD_LENGTH = 1024


def _json_error(code, message, status, fields=None):
    error = {"code": code, "message": message}
    if fields is not None:
        error["fields"] = fields
    response = JsonResponse({"error": error}, status=status)
    patch_cache_control(response, no_store=True)
    return response


def _service_error(error):
    return _json_error(error.code, error.message, error.status, error.fields)


def _validation_error(fields):
    return _json_error("validation_error", "Please check the form.", 400, fields)


def _method_not_allowed(allowed):
    response = _json_error("method_not_allowed", "This method is not allowed.", 405)
    response["Allow"] = ", ".join(allowed)
    return response


def _read_json_object(request, allowed_fields):
    try:
        body = request.body
    except RequestDataTooBig:
        return None, _json_error("invalid_json", "Request body is too large or invalid.", 400)

    if len(body) > MAX_JSON_BODY_BYTES:
        return None, _json_error("invalid_json", "Request body is too large or invalid.", 400)
    if request.content_type != "application/json":
        return None, _json_error("invalid_json", "A JSON request body is required.", 400)

    try:
        payload = json.loads(body.decode(request.encoding or "utf-8"))
    except (UnicodeDecodeError, LookupError, JSONDecodeError, RecursionError):
        return None, _json_error("invalid_json", "Request body must contain valid JSON.", 400)

    if not isinstance(payload, dict):
        return None, _validation_error({"__all__": ["Send a JSON object."]})

    fields = {}
    for key in payload.keys() - allowed_fields:
        fields[key] = ["This field is not allowed."]
    if fields:
        return None, _validation_error(fields)
    return payload, None


def _has_invalid_unicode(value):
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return True
    return False


def _string_fields(payload, required_fields, max_lengths):
    errors = {}
    for field in required_fields:
        if field not in payload:
            errors[field] = ["This field is required."]
            continue
        value = payload[field]
        if not isinstance(value, str):
            errors[field] = ["Enter a valid string."]
        elif _has_invalid_unicode(value):
            errors[field] = ["Enter valid Unicode text."]
        elif len(value) > max_lengths[field]:
            errors[field] = [f"Ensure this value has at most {max_lengths[field]} characters."]
        elif not value:
            errors[field] = ["This field is required."]
    return errors


@never_cache
def csrf_token(request):
    if request.method != "GET":
        return _method_not_allowed(["GET"])
    return JsonResponse({"csrfToken": get_token(request)})


@never_cache
def register(request):
    if request.method != "POST":
        return _method_not_allowed(["POST"])

    allowed = {"username", "email", "password", "password_confirmation"}
    payload, error = _read_json_object(request, allowed)
    if error:
        return error

    field_errors = _string_fields(
        payload,
        allowed,
        {
            "username": 150,
            "email": 254,
            "password": MAX_PASSWORD_LENGTH,
            "password_confirmation": MAX_PASSWORD_LENGTH,
        },
    )
    if field_errors:
        return _validation_error(field_errors)

    try:
        user = register_account(request, payload)
    except AuthServiceError as error:
        return _service_error(error)
    return JsonResponse(
        {"user": public_profile(user), "csrfToken": get_token(request)}, status=201
    )


@never_cache
def login_view(request):
    if request.method != "POST":
        return _method_not_allowed(["POST"])

    allowed = {"username", "password"}
    payload, error = _read_json_object(request, allowed)
    if error:
        return error

    field_errors = _string_fields(
        payload,
        allowed,
        {"username": 150, "password": MAX_PASSWORD_LENGTH},
    )
    if field_errors:
        return _validation_error(field_errors)

    try:
        user = login_account(request, payload)
    except AuthServiceError as error:
        return _service_error(error)
    return JsonResponse({"user": public_profile(user), "csrfToken": get_token(request)})


@never_cache
def me(request):
    if request.method != "GET":
        return _method_not_allowed(["GET"])
    try:
        profile = current_profile(request)
    except AuthServiceError as error:
        return _service_error(error)
    return JsonResponse({"user": profile})


@never_cache
def logout_view(request):
    if request.method != "POST":
        return _method_not_allowed(["POST"])
    logout_account(request)
    return JsonResponse({"user": None, "csrfToken": get_token(request)})


@never_cache
def csrf_failure(request, reason=""):
    if request.path.startswith("/api/"):
        return _json_error("csrf_failed", "CSRF verification failed.", 403)
    return default_csrf_failure(request, reason=reason)
