class ETLError(Exception):
    """An error safe to return through the ETL API."""

    def __init__(self, message, *, code="invalid_pipeline", status=400, fields=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.fields = fields
