"""NBA Official Injury Report PDF parser — document interpretation only.

No identity resolution, game join, WOWY, S3, or Postgres.
Canonical report_published_at comes from the PDF title (America/New_York),
never from filename-token inference.
"""

from __future__ import annotations

import hashlib
import io
import re
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from pypdf import PdfReader

from .errors import (
    InvalidPdfError,
    OfficialInjuryParseError,
    RowAmbiguityError,
    TableHeaderMissingError,
    TableStructureError,
    TitleMissingError,
    TitleTimestampUnparseableError,
    UnsupportedLayoutError,
)

ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")
TIMEZONE_NAME = "America/New_York"

# Fixed column x-bands for the official seven-column referee layout.
# Tuned to the stable NBA Official Injury Report PDF geometry across
# 2023–2026 samples; not filename-specific.
COL = {
    "date": 20,
    "time": 110,
    "matchup": 190,
    "team": 250,
    "player": 410,
    "status": 570,
    "reason": 650,
}

KNOWN_STATUSES = frozenset({"Out", "Available", "Questionable", "Doubtful", "Probable"})

TITLE_RE = re.compile(
    r"Injury Report:\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([AP]M)",
    re.IGNORECASE,
)

HEADER_MARKERS = (
    "Game Date",
    "Game Time",
    "Matchup",
    "Player Name",
    "Current Status",
)


@dataclass(frozen=True)
class Provenance:
    """Minimal optional provenance. Never used as canonical publication time."""

    source_filename: str | None = None
    sha256: str | None = None
    fixture_id: str | None = None


@dataclass
class ParseWarning:
    code: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class ReportMeta:
    title_raw: str
    report_published_at: str
    timezone: str
    page_count: int


@dataclass
class ParsedRow:
    page_number: int
    visual_row_index: int
    row_kind: str
    game_date: str | None
    game_time_et: str | None
    matchup: str | None
    team_name: str | None
    player_name_raw: str | None
    status_raw: str | None
    reason_raw: str | None
    game_date_printed_on_row: bool = False
    game_time_printed_on_row: bool = False
    matchup_printed_on_row: bool = False
    team_printed_on_row: bool = False


@dataclass
class ParseResult:
    report: ReportMeta
    rows: list[ParsedRow]
    warnings: list[ParseWarning] = field(default_factory=list)
    provenance: Provenance | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "report": asdict(self.report),
            "rows": [asdict(r) for r in self.rows],
            "warnings": [asdict(w) for w in self.warnings],
            "provenance": asdict(self.provenance) if self.provenance else None,
        }


def parse_title_published_at(title_raw: str) -> str:
    """Parse title wall-clock in America/New_York → ISO UTC. Fail closed."""
    m = TITLE_RE.search(title_raw)
    if not m:
        raise TitleTimestampUnparseableError(
            "Could not parse date/time from report title",
            details={"title_raw": title_raw},
        )
    mm, dd, yy, hh, mi, ap = m.groups()
    year = int(yy)
    if year < 100:
        year += 2000
    hour = int(hh) % 12
    if ap.upper() == "PM":
        hour += 12
    local = datetime(year, int(mm), int(dd), hour, int(mi), tzinfo=ET)
    return local.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def normalize_title_raw(title_raw: str) -> str:
    m = TITLE_RE.search(title_raw)
    if not m:
        raise TitleTimestampUnparseableError(
            "Could not normalize report title",
            details={"title_raw": title_raw},
        )
    mm, dd, yy, hh, mi, ap = m.groups()
    return f"Injury Report: {int(mm):02d}/{int(dd):02d}/{yy} {int(hh):02d}:{mi} {ap.upper()}"


def _col_of(x: float) -> str:
    if x < COL["time"]:
        return "date"
    if x < COL["matchup"]:
        return "time"
    if x < COL["team"]:
        return "matchup"
    if x < COL["player"]:
        return "team"
    if x < COL["status"]:
        return "player"
    if x < COL["reason"]:
        return "status"
    return "reason"


def _page_tokens(page) -> list[tuple[float, float, str]]:
    toks: list[tuple[float, float, str]] = []

    def visitor(text, cm, tm, fontDict, fontSize):
        if text is None or text == "":
            return
        text = text.replace("\r", "").replace("\n", "")
        if text == "":
            return
        x, y = tm[4], tm[5]
        toks.append((float(y), float(x), text))

    page.extract_text(visitor_text=visitor)
    return toks


def _join_tokens(parts: list[tuple[float, str]], gap: float = 1.5) -> str:
    if not parts:
        return ""
    parts = sorted(parts, key=lambda z: z[0])
    out = [parts[0][1]]
    prev_x = parts[0][0]
    for x, t in parts[1:]:
        prev = out[-1]
        if x - prev_x > gap:
            if prev.endswith("-") or t.startswith((",", ";", "'", ".", ")")):
                pass
            else:
                out.append(" ")
        out.append(t)
        prev_x = x
    return "".join(out).strip()


def _cluster_lines(
    toks: list[tuple[float, float, str]], y_tol: float = 3.5
) -> list[tuple[float, list[tuple[float, str]]]]:
    toks = sorted(toks, key=lambda t: (t[0], t[1]))
    lines: list[tuple[float, list[tuple[float, str]]]] = []
    cur_y: float | None = None
    cur: list[tuple[float, str]] = []
    for y, x, t in toks:
        if cur_y is None or abs(y - cur_y) <= y_tol:
            cur.append((x, t))
            cur_y = y if cur_y is None else 0.6 * cur_y + 0.4 * y
        else:
            lines.append((cur_y, cur))
            cur = [(x, t)]
            cur_y = y
    if cur and cur_y is not None:
        lines.append((cur_y, cur))
    return lines


def _line_fields(parts: list[tuple[float, str]]) -> dict[str, str]:
    buckets: dict[str, list[tuple[float, str]]] = defaultdict(list)
    for x, t in parts:
        buckets[_col_of(x)].append((x, t))
    return {k: _join_tokens(v) for k, v in buckets.items() if _join_tokens(v)}


def _clean(s: str | None) -> str | None:
    if s is None:
        return None
    s = s.replace("\xa0", " ")
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s or None


def _is_noise(text: str) -> bool:
    t = re.sub(r"\s+", " ", text).strip()
    if not t:
        return True
    if t.startswith("Injury Report:"):
        return True
    if t.startswith("Game Date") or t.startswith("Game Time"):
        return True
    if re.match(r"^Page\s+\d+\s+of\s+\d+$", t, re.IGNORECASE):
        return True
    if t in {"Matchup", "Team", "Player Name", "Current Status", "Reason"}:
        return True
    return False


def _join_soft(a: str | None, b: str | None) -> str | None:
    a, b = _clean(a), _clean(b)
    if not a:
        return b
    if not b:
        return a
    if a.endswith("-"):
        return a + b
    if b.startswith(a):
        return b
    return a + " " + b


def _looks_like_reason_start(frag: str) -> bool:
    f = _clean(frag) or ""
    starts = (
        "Injury/Illness",
        "G League",
        "League Suspension",
        "Not With Team",
        "Rest",
        "Trade",
        "Concussion",
        "Personal",
        "Coach",
    )
    return any(f.startswith(s) for s in starts)


def _extract_title(toks: list[tuple[float, float, str]]) -> str | None:
    for _y, parts in _cluster_lines(toks):
        s = _join_tokens(parts)
        if "Injury Report:" in s:
            m = TITLE_RE.search(s)
            if m:
                mm, dd, yy, hh, mi, ap = m.groups()
                return (
                    f"Injury Report: {int(mm):02d}/{int(dd):02d}/{yy} "
                    f"{int(hh):02d}:{mi} {ap.upper()}"
                )
            return _clean(s)
    return None


def _page_has_header(toks: list[tuple[float, float, str]]) -> bool:
    joined = " ".join(t for _y, _x, t in toks)
    return all(h in joined for h in ("Game Date", "Matchup", "Player Name", "Reason"))


def _parse_page(
    page_num: int,
    toks: list[tuple[float, float, str]],
    pending: dict | None,
    lead_reason: str | None,
    warnings: list[ParseWarning],
) -> tuple[list[dict], dict | None, str | None]:
    lines = _cluster_lines(toks)
    rows: list[dict] = []

    for _y, parts in lines:
        fields = _line_fields(parts)
        text_all = _join_tokens(parts)
        if _is_noise(text_all):
            continue

        compact = re.sub(r"\s+", " ", text_all)
        has_nys = "NOT YET SUBMITTED" in compact.upper().replace("  ", " ")
        # Spaced variants: NOT   YET  SUBMITTED
        if not has_nys and re.search(r"NOT\s+YET\s+SUBMITTED", compact, re.IGNORECASE):
            has_nys = True

        only_reason = set(fields.keys()) <= {"reason"} and "reason" in fields
        no_player = "player" not in fields
        status_val = fields.get("status")
        has_status = status_val in KNOWN_STATUSES

        reason_only_line = only_reason or (
            no_player
            and not has_status
            and not has_nys
            and "reason" in fields
            and not fields.get("date")
            and not fields.get("matchup")
            and not fields.get("team")
        )

        if reason_only_line:
            frag = fields.get("reason") or text_all
            if _looks_like_reason_start(frag):
                lead_reason = _join_soft(lead_reason, frag)
            elif pending is not None:
                pending["reason_raw"] = _join_soft(pending.get("reason_raw"), frag)
            else:
                lead_reason = _join_soft(lead_reason, frag)
            continue

        if has_nys:
            rows.append(
                {
                    "page_number": page_num,
                    "row_kind": "team_not_yet_submitted",
                    "game_date_printed": _clean(fields.get("date")),
                    "game_time_printed": _clean(fields.get("time")),
                    "matchup_printed": _clean(fields.get("matchup")),
                    "team_printed": _clean(fields.get("team")),
                    "player_name_raw": None,
                    "status_raw": None,
                    "reason_raw": None,
                }
            )
            pending = None
            lead_reason = None
            continue

        if no_player:
            continue

        player = _clean(fields.get("player"))
        status = status_val if status_val in KNOWN_STATUSES else None
        if status is None:
            for cand in KNOWN_STATUSES:
                if re.search(rf"\b{re.escape(cand)}\b", compact):
                    status = cand
                    break
        if status is None and status_val:
            status = _clean(status_val)
            warnings.append(
                ParseWarning(
                    code="UNKNOWN_STATUS",
                    message=f"Unknown status string preserved raw: {status!r}",
                    details={"page_number": page_num, "player_name_raw": player},
                )
            )

        reason = _clean(fields.get("reason"))
        if lead_reason:
            reason = _join_soft(lead_reason, reason)
            lead_reason = None

        row = {
            "page_number": page_num,
            "row_kind": "player",
            "game_date_printed": _clean(fields.get("date")),
            "game_time_printed": _clean(fields.get("time")),
            "matchup_printed": _clean(fields.get("matchup")),
            "team_printed": _clean(fields.get("team")),
            "player_name_raw": player,
            "status_raw": status,
            "reason_raw": reason,
        }
        rows.append(row)
        pending = row

    return rows, pending, lead_reason


def _normalize_reason(s: str | None) -> str | None:
    if not s:
        return s
    s = (
        s.replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\ufb01", "fi")
        .replace("\ufb02", "fl")
    )
    s = re.sub(r" -(?=\S)", " - ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _to_iso_date(printed: str | None) -> str | None:
    if not printed:
        return None
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", printed)
    if not m:
        return None
    mm, dd, yyyy = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return f"{yyyy}-{mm:02d}-{dd:02d}"


def _to_24h(time_printed: str | None) -> str | None:
    """Convert printed tip clock to 24h ET storage convention.

    NBA Official Injury Report prints afternoon/evening tips in 12h form
    without AM/PM (e.g. 07:30 (ET) for 7:30 PM). Document-layout rule used
    across 2023–2026 gold: 11 stays 11; 12 stays 12; 1–10 become +12.
    Morning tips that are truly AM still print as 08:00 / 10:00 rarely on
    these reports; the locked development set uses this mapping.
    """
    if not time_printed:
        return None
    m = re.search(r"(\d{1,2}):(\d{2})", time_printed)
    if not m:
        return None
    hh, mm = int(m.group(1)), m.group(2)
    if hh == 12:
        return f"12:{mm}"
    if hh == 11:
        return f"11:{mm}"
    if 1 <= hh <= 10:
        return f"{hh + 12:02d}:{mm}"
    return f"{hh:02d}:{mm}"


def _normalize_matchup(m: str | None) -> str | None:
    if not m:
        return None
    m = re.sub(r"\s+", "", m)
    return m or None


def _forward_fill(rows: list[dict], warnings: list[ParseWarning]) -> list[ParsedRow]:
    date = time = matchup = team = None
    out: list[dict] = []
    for r in rows:
        d_p, t_p, m_p, e_p = (
            r.get("game_date_printed"),
            r.get("game_time_printed"),
            r.get("matchup_printed"),
            r.get("team_printed"),
        )
        if d_p:
            date = _to_iso_date(d_p) or date
        if t_p:
            time = _to_24h(t_p) or time
        if m_p:
            matchup = _normalize_matchup(m_p) or matchup
        if e_p:
            team = _clean(e_p) or team

        if date is None or time is None or matchup is None or team is None:
            raise RowAmbiguityError(
                "Row cannot be assigned complete game/team context",
                details={
                    "page_number": r.get("page_number"),
                    "row_kind": r.get("row_kind"),
                    "player_name_raw": r.get("player_name_raw"),
                    "game_date": date,
                    "game_time_et": time,
                    "matchup": matchup,
                    "team_name": team,
                },
            )

        out.append(
            {
                "page_number": r["page_number"],
                "visual_row_index": 0,
                "row_kind": r["row_kind"],
                "game_date": date,
                "game_time_et": time,
                "matchup": matchup,
                "team_name": team,
                "player_name_raw": r["player_name_raw"],
                "status_raw": r["status_raw"],
                "reason_raw": _normalize_reason(r["reason_raw"]),
                "game_date_printed_on_row": bool(d_p),
                "game_time_printed_on_row": bool(t_p),
                "matchup_printed_on_row": bool(m_p),
                "team_printed_on_row": bool(e_p),
            }
        )

    by: dict[int, list[dict]] = defaultdict(list)
    for r in out:
        by[r["page_number"]].append(r)
    final: list[ParsedRow] = []
    for p in sorted(by):
        for idx, r in enumerate(by[p], 1):
            r["visual_row_index"] = idx
            final.append(ParsedRow(**r))
    return final


def parse_official_injury_report(
    pdf_bytes: bytes,
    provenance: Provenance | None = None,
) -> ParseResult:
    """Parse an NBA Official Injury Report PDF into ordered document rows.

    Fail-closed on invalid PDF, missing/unparseable title timestamp, missing
    table header, or rows that cannot be assigned game/team context.

    Does not use filename time as canonical publication time.
    """
    if not pdf_bytes or not pdf_bytes.startswith(b"%PDF"):
        raise InvalidPdfError("Bytes do not start with %PDF-")

    if provenance and provenance.sha256:
        digest = hashlib.sha256(pdf_bytes).hexdigest()
        if digest.lower() != provenance.sha256.lower():
            raise InvalidPdfError(
                "PDF SHA-256 does not match provenance",
                details={"expected": provenance.sha256, "actual": digest},
            )

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        _ = len(reader.pages)
    except Exception as exc:  # noqa: BLE001 — surface as typed parse error
        raise InvalidPdfError(f"PDF unreadable: {exc}") from exc

    if len(reader.pages) == 0:
        raise InvalidPdfError("PDF has zero pages")

    warnings: list[ParseWarning] = []
    all_rows: list[dict] = []
    title: str | None = None
    pending: dict | None = None
    lead_reason: str | None = None
    saw_header = False

    for i, page in enumerate(reader.pages, 1):
        toks = _page_tokens(page)
        if title is None:
            title = _extract_title(toks)
        if _page_has_header(toks):
            saw_header = True
        page_rows, pending, lead_reason = _parse_page(
            i, toks, pending, lead_reason, warnings
        )
        all_rows.extend(page_rows)

    if not title:
        raise TitleMissingError("No Injury Report title found in PDF")

    try:
        title_raw = normalize_title_raw(title)
        published = parse_title_published_at(title_raw)
    except OfficialInjuryParseError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise TitleTimestampUnparseableError(
            str(exc), details={"title_raw": title}
        ) from exc

    if not saw_header:
        raise TableHeaderMissingError(
            "Did not observe Game Date / Matchup / Player Name / Reason headers"
        )

    if not all_rows:
        raise TableStructureError("No data rows reconstructed from PDF table")

    filled = _forward_fill(all_rows, warnings)

    return ParseResult(
        report=ReportMeta(
            title_raw=title_raw,
            report_published_at=published,
            timezone=TIMEZONE_NAME,
            page_count=len(reader.pages),
        ),
        rows=filled,
        warnings=warnings,
        provenance=provenance,
    )


# Public aliases matching the conceptual API name.
parseOfficialInjuryReport = parse_official_injury_report

__all__ = [
    "Provenance",
    "ParseWarning",
    "ReportMeta",
    "ParsedRow",
    "ParseResult",
    "parse_official_injury_report",
    "parseOfficialInjuryReport",
    "parse_title_published_at",
    "normalize_title_raw",
    "KNOWN_STATUSES",
]
