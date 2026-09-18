"""Structured errors for the NBA Official Injury Report PDF parser."""

from __future__ import annotations


class OfficialInjuryParseError(Exception):
    """Fail-closed parser failure. Callers must not invent rows from this."""

    def __init__(self, code: str, message: str, *, details: dict | None = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(f"[{code}] {message}")


class InvalidPdfError(OfficialInjuryParseError):
    def __init__(self, message: str = "PDF invalid or unreadable", *, details: dict | None = None):
        super().__init__("INVALID_PDF", message, details=details)


class TitleMissingError(OfficialInjuryParseError):
    def __init__(self, message: str = "Report title missing", *, details: dict | None = None):
        super().__init__("TITLE_MISSING", message, details=details)


class TitleTimestampUnparseableError(OfficialInjuryParseError):
    def __init__(
        self,
        message: str = "Report title timestamp unparseable",
        *,
        details: dict | None = None,
    ):
        super().__init__("TITLE_TIMESTAMP_UNPARSEABLE", message, details=details)


class TableHeaderMissingError(OfficialInjuryParseError):
    def __init__(
        self,
        message: str = "Expected table header missing",
        *,
        details: dict | None = None,
    ):
        super().__init__("TABLE_HEADER_MISSING", message, details=details)


class TableStructureError(OfficialInjuryParseError):
    def __init__(
        self,
        message: str = "Table structure impossible to reconstruct",
        *,
        details: dict | None = None,
    ):
        super().__init__("TABLE_STRUCTURE", message, details=details)


class UnsupportedLayoutError(OfficialInjuryParseError):
    def __init__(
        self,
        message: str = "Unsupported document layout",
        *,
        details: dict | None = None,
    ):
        super().__init__("UNSUPPORTED_LAYOUT", message, details=details)


class RowAmbiguityError(OfficialInjuryParseError):
    def __init__(
        self,
        message: str = "Unrecoverable row ambiguity",
        *,
        details: dict | None = None,
    ):
        super().__init__("ROW_AMBIGUITY", message, details=details)
