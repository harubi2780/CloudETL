from django.conf import settings
from django.core.files.uploadhandler import FileUploadHandler, StopUpload


class DatasetSizeLimitHandler(FileUploadHandler):
    """Limit file bytes before memory/disk handlers receive an oversized body."""

    def new_file(self, *args, **kwargs):
        super().new_file(*args, **kwargs)
        self.bytes_received = 0

    def receive_data_chunk(self, raw_data, start):
        self.bytes_received += len(raw_data)
        if self.bytes_received > settings.DATASET_MAX_FILE_SIZE_BYTES:
            self.request.dataset_upload_too_large = True
            raise StopUpload(connection_reset=False)
        return raw_data

    def file_complete(self, file_size):
        return None
