from django.core.exceptions import RequestDataTooBig, TooManyFieldsSent, TooManyFilesSent
from django.views.decorators.cache import never_cache

from services.dataset_service import list_datasets, upload_dataset
from views import _json_error, _method_not_allowed
from django.http import JsonResponse

from .errors import DatasetError, invalid_file


@never_cache
def collection(request):
    if request.method not in {"GET", "POST"}:
        return _method_not_allowed(["GET", "POST"])
    if not request.user.is_authenticated:
        return _json_error("authentication_required", "Please log in.", 401)
    try:
        if request.method == "GET":
            raw_page = request.GET.get("page", "1")
            if not raw_page.isascii() or not raw_page.isdecimal() or len(raw_page) > 9 or int(raw_page) < 1:
                raise DatasetError("Choose a valid page number.", code="invalid_page")
            return JsonResponse(list_datasets(request.user, int(raw_page)))
        if request.content_type != "multipart/form-data":
            raise DatasetError("Send the file as multipart form data.", code="invalid_request")
        files = request.FILES
        if getattr(request, "dataset_upload_too_large", False):
            raise DatasetError("The file exceeds the upload size limit.", code="file_too_large", status=413)
        if request.POST or set(files) != {"file"} or len(files.getlist("file")) != 1:
            raise invalid_file("Send exactly one file in the file field.")
        return JsonResponse({"dataset": upload_dataset(request.user, files["file"])}, status=201)
    except DatasetError as error:
        return _json_error(error.code, error.message, error.status, error.fields)
    except (RequestDataTooBig, TooManyFieldsSent, TooManyFilesSent):
        return _json_error("invalid_request", "The upload request is too large or contains too many fields.", 413)
