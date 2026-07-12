class ImporterError(Exception):
    """Base class for errors safe to show to an importer user."""


class RetrievalError(ImporterError):
    """The Share page could not be retrieved safely."""


class UnsupportedSharePageFormat(ImporterError):
    """The page does not contain a complete, recognized Share payload."""

    def __init__(self, detail: str):
        super().__init__(f"unsupported share-page format: {detail}")
