class DatasetError(Exception):
    """Safe, structured errors for the upload API."""

    def __init__(self, message, *, code="validation_error", status=400, fields=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.fields = fields


def invalid_file(message):
    return DatasetError(message, fields={"file": [message]})
