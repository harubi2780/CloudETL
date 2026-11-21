import logging
import uuid
from functools import wraps

from django.conf import settings
from django.db import DatabaseError
from django.http import HttpResponse, JsonResponse
from django.views.decorators.cache import never_cache

from datasets.errors import DatasetError
from services import etl_service
from views import _json_error, _method_not_allowed, _read_json_object

from .errors import ETLError
from .serializers import FORMATS, MAX_CELLS, MAX_COLUMNS, MAX_ROWS, MAX_SOURCES, MAX_STEPS, MAX_RESULT_BYTES, OPERATIONS

logger = logging.getLogger(__name__)


def endpoint(methods):
    def decorate(function):
        @never_cache
        @wraps(function)
        def wrapped(request, *args, **kwargs):
            if request.method not in methods:
                return _method_not_allowed(methods)
            if not request.user.is_authenticated:
                return _json_error("authentication_required", "Please log in.", 401)
            try:
                return function(request, *args, **kwargs)
            except (ETLError, DatasetError) as error:
                return _json_error(error.code, error.message, error.status, error.fields)
            except DatabaseError:
                logger.exception("ETL database operation failed")
                return _json_error("etl_unavailable", "The ETL service is temporarily unavailable.", 503)
        return wrapped
    return decorate


@endpoint(["GET"])
def capabilities(request):
    return JsonResponse({"schemaVersion": 1, "inputFormats": ["csv", "tsv"], "outputFormats": list(FORMATS),
                         "operations": OPERATIONS, "limits": {"maxSteps": MAX_STEPS, "maxSources": MAX_SOURCES,
                         "maxCombinedInputBytes": settings.DATASET_MAX_FILE_SIZE_BYTES, "maxResultBytes": MAX_RESULT_BYTES,
                         "maxRows": MAX_ROWS, "maxColumns": MAX_COLUMNS, "maxCells": MAX_CELLS, "previewRows": 10}})


@endpoint(["GET"])
def dataset_preview(request, dataset_id):
    return JsonResponse({"preview": etl_service.dataset_preview(request.user, dataset_id)})


@endpoint(["GET"])
def dataset_rows(request, dataset_id):
    query_parameters(request, ("page", "page_size"))
    page = positive_integer(request, "page", 1)
    page_size = positive_integer(request, "page_size", 25)
    if page_size not in (10, 25, 50, 100):
        raise ETLError("Choose 10, 25, 50, or 100 rows per page.", code="invalid_page")
    return JsonResponse(etl_service.dataset_rows(request.user, dataset_id, page, page_size))


def query_parameters(request, allowed):
    if set(request.GET) - set(allowed) or any(len(request.GET.getlist(key)) != 1 for key in request.GET):
        raise ETLError("Send only the supported query parameters, once each.")


def positive_integer(request, key, default):
    value = request.GET.get(key, str(default))
    if not value.isascii() or not value.isdecimal() or len(value) > 9 or int(value) < 1:
        raise ETLError("Choose a valid page number or page size.", code="invalid_page")
    return int(value)


@endpoint(["GET"])
def dataset_detail(request, dataset_id):
    return JsonResponse({"dataset": etl_service.source_metadata(request.user, dataset_id)})


@endpoint(["GET", "POST"])
def pipelines(request):
    if request.method == "GET":
        query_parameters(request, ("page",))
        return JsonResponse(etl_service.list_pipelines(request.user, positive_integer(request, "page", 1)))
    payload, error = _read_json_object(request, {"name", "datasetId", "steps", "schemaVersion", "updatedAt"})
    if error is not None:
        return error
    return JsonResponse({"pipeline": etl_service.create_pipeline(request.user, payload)}, status=201)


@endpoint(["GET", "PUT", "DELETE"])
def pipeline_detail(request, pipeline_id):
    if request.method == "GET":
        pipeline = etl_service.owned_pipeline(request.user, pipeline_id)
        return JsonResponse({"pipeline": etl_service.public_pipeline(pipeline, include_config=True)})
    if request.method == "PUT":
        payload, error = _read_json_object(request, {"name", "datasetId", "steps", "schemaVersion", "updatedAt"})
        if error is not None:
            return error
        return JsonResponse({"pipeline": etl_service.update_pipeline(request.user, pipeline_id, payload)})
    return JsonResponse(etl_service.delete_pipeline(request.user, pipeline_id))


@endpoint(["GET", "POST"])
def runs(request):
    if request.method == "GET":
        query_parameters(request, ("page", "status"))
        return JsonResponse(etl_service.list_runs(request.user, positive_integer(request, "page", 1), request.GET.get("status", "")))
    payload, error = _read_json_object(request, {"name", "datasetId", "steps", "schemaVersion", "updatedAt"})
    if error is not None:
        return error
    return JsonResponse({"run": etl_service.submit_run(request.user, payload)}, status=202)


@endpoint(["GET"])
def run_detail(request, run_id):
    run = etl_service.owned_run(request.user, run_id)
    return JsonResponse({
        "run": {
            **etl_service.public_run(run),
            "configuration": run.configuration,
            "sources_meta": etl_service.run_sources_meta(run),
        }
    })


@endpoint(["GET"])
def source_rows(request, run_id):
    query_parameters(request, ("page", "page_size", "dataset_id"))
    page = positive_integer(request, "page", 1)
    page_size = positive_integer(request, "page_size", 25)
    if page_size not in (10, 25, 50, 100):
        raise ETLError("Choose 10, 25, 50, or 100 rows per page.", code="invalid_page")
    dataset_id = None
    if "dataset_id" in request.GET:
        try:
            dataset_id = str(uuid.UUID(request.GET["dataset_id"]))
        except ValueError as error:
            raise ETLError("Source dataset not found for this run.", code="dataset_not_found", status=404) from error
    return JsonResponse(etl_service.source_rows(request.user, run_id, page, page_size, dataset_id=dataset_id))


@endpoint(["DELETE"])
def result_file(request, run_id):
    return JsonResponse(etl_service.delete_result(request.user, run_id))


@endpoint(["GET"])
def rows(request, run_id):
    query_parameters(request, ("page", "page_size"))
    page_size = positive_integer(request, "page_size", 25)
    if page_size not in (25, 50, 100):
        raise ETLError("Choose 25, 50, or 100 rows per page.", code="invalid_page")
    return JsonResponse(etl_service.result_rows(request.user, run_id, positive_integer(request, "page", 1), page_size))


@endpoint(["GET"])
def download(request, run_id):
    if set(request.GET) - {"format"} or len(request.GET.getlist("format")) > 1:
        raise ETLError("Send a single format query parameter.")
    file_format = request.GET.get("format", "csv")
    if file_format not in FORMATS:
        raise ETLError("Unsupported export format.")
    content = etl_service.download_result(request.user, run_id, file_format)
    types = {"csv": "text/csv; charset=utf-8", "tsv": "text/tab-separated-values; charset=utf-8"}
    response = HttpResponse(content, content_type=types[file_format])
    response["Content-Disposition"] = f'attachment; filename="result-{run_id}.{file_format}"'
    response["X-Content-Type-Options"] = "nosniff"
    return response
