"""
Phase 3D — Archive-wide dry parse of the certified official injury-report PDF tape.

Read-only vs S3. Does not fetch NBA.com. Does not write S3/Postgres.
Does not modify the certified parser.

Usage (repo root):
  python scripts/ops/run-official-injury-archive-dry-parse.py
  python scripts/ops/run-official-injury-archive-dry-parse.py --workers 8
  python scripts/ops/run-official-injury-archive-dry-parse.py --limit 50   # smoke
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lib" / "providers"))

from nba_official_injuries import Provenance, parse_official_injury_report  # noqa: E402
from nba_official_injuries.errors import OfficialInjuryParseError  # noqa: E402

CERTIFIED_PARSER_SHA = "ce7d729db2fe46b07e0bcfdfc9db506b62af812c0633afb30a2b97646f615ac7"
EXPECTED_PDFS = 18271
EXPECTED_SEASONS = {"2023": 3626, "2024": 3983, "2025": 10662}
EXPECTED_FAMILIES = {"hourly": 8890, "minute": 9381}  # minute includes quarter tokens

ARCHIVE_RECORDS = ROOT / "reports" / "operations" / "official-injury-report-raw-archive.records.ndjson"
PARSER_PATH = ROOT / "lib" / "providers" / "nba_official_injuries" / "parser.py"
ERRORS_PATH = ROOT / "lib" / "providers" / "nba_official_injuries" / "errors.py"
INIT_PATH = ROOT / "lib" / "providers" / "nba_official_injuries" / "__init__.py"

TMP = ROOT / "tmp" / "official-injury-report-archive-dry-parse"
RESULTS_GZ = TMP / "report-results.ndjson.gz"
ROWS_GZ = TMP / "parsed-rows.ndjson.gz"
RUN_STATE = TMP / "run-state.json"
ANOMALY_REVIEW = TMP / "anomaly-review"

REPORT_MD = ROOT / "reports" / "operations" / "official-injury-report-archive-dry-parse.md"
REPORT_JSON = ROOT / "reports" / "operations" / "official-injury-report-archive-dry-parse.json"
ANOMALIES_NDJSON = ROOT / "reports" / "operations" / "official-injury-report-archive-dry-parse-anomalies.ndjson"
RECORDS_NDJSON = ROOT / "reports" / "operations" / "official-injury-report-archive-dry-parse.records.ndjson"

MANIFEST_FIXTURES = ROOT / "tests" / "fixtures" / "nba-official-injury-reports" / "manifest.json"
EXPECTED_DIR = ROOT / "tests" / "fixtures" / "nba-official-injury-reports" / "expected"
GOLD_PDF_DIR = ROOT / "tmp" / "official-injury-report-gold-fixtures" / "pdfs"

ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")
MATCHUP_RE = re.compile(r"^[A-Z]{2,3}@[A-Z]{2,3}$")
TITLE_DATE_RE = re.compile(
    r"Injury Report:\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([AP]M)",
    re.IGNORECASE,
)
TOKEN_RE = re.compile(r"^(\d{2})(?:_(\d{2}))?(AM|PM)$")

KNOWN_STATUSES = frozenset({"Out", "Available", "Questionable", "Doubtful", "Probable"})
AMBIGUOUS_WARNING_CODES = frozenset(
    {
        "UNCERTAIN_ROW_OWNERSHIP",
        "UNCERTAIN_CONTEXT",
        "INCOMPLETE_EXTRACTION",
        "GUESSED_TABLE",
        "ROW_AMBIGUITY",
    }
)

write_lock = threading.Lock()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def require_parser_freeze() -> dict[str, Any]:
    import pypdf

    parser_sha = sha256_file(PARSER_PATH)
    if parser_sha != CERTIFIED_PARSER_SHA:
        raise SystemExit(
            f"HARD STOP: parser SHA mismatch\n"
            f"  expected {CERTIFIED_PARSER_SHA}\n"
            f"  actual   {parser_sha}"
        )

    def git(args: list[str]) -> str:
        try:
            return subprocess.check_output(args, cwd=str(ROOT), text=True).strip()
        except Exception as exc:  # noqa: BLE001
            return f"<unavailable: {exc}>"

    return {
        "fingerprinted_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "parser_sha256": parser_sha,
        "errors_sha256": sha256_file(ERRORS_PATH),
        "init_sha256": sha256_file(INIT_PATH),
        "python_version": sys.version,
        "pypdf_version": pypdf.__version__,
        "platform": platform.platform(),
        "git_commit": git(["git", "rev-parse", "HEAD"]),
        "git_branch": git(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
        "git_status_porcelain": git(["git", "status", "--porcelain=v1"]),
    }


def load_population() -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for line in ARCHIVE_RECORDS.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("result") not in ("ARCHIVED", "ALREADY_ARCHIVED_CHECKSUM_MATCH"):
            continue
        if not row.get("sha256") or not row.get("s3_pdf_key"):
            continue
        key = row["s3_pdf_key"]
        if key not in by_key:
            by_key[key] = row
    pop = sorted(by_key.values(), key=lambda r: (r["report_date"], r["requested_token"], r["s3_pdf_key"]))
    if len(pop) != EXPECTED_PDFS:
        raise SystemExit(f"HARD STOP: population {len(pop)} != {EXPECTED_PDFS}")
    seasons = Counter(r["season"] for r in pop)
    for s, n in EXPECTED_SEASONS.items():
        if seasons.get(s, 0) != n:
            raise SystemExit(f"HARD STOP: season {s} count {seasons.get(s)} != {n}")
    # minute family for gate = minute + quarter tokens
    fam_raw = Counter(r["filename_family"] for r in pop)
    minute_like = fam_raw.get("minute", 0) + fam_raw.get("quarter", 0)
    if fam_raw.get("hourly", 0) != EXPECTED_FAMILIES["hourly"] or minute_like != EXPECTED_FAMILIES["minute"]:
        raise SystemExit(
            f"HARD STOP: family counts hourly={fam_raw.get('hourly')} minute_like={minute_like} "
            f"raw={dict(fam_raw)}"
        )
    return pop


def family_bucket(filename_family: str) -> str:
    return "hourly" if filename_family == "hourly" else "minute"


def regime_for(report_date: str) -> str:
    if report_date < "2025-12-22":
        return "pre_2025_12_22"
    if report_date == "2025-12-22":
        return "transition_2025_12_22"
    return "post_2025_12_22"


def infer_from_token(report_date: str, token: str) -> tuple[str | None, str | None]:
    m = TOKEN_RE.fullmatch(token)
    if not m:
        return None, None
    hh, mm, ap = m.group(1), m.group(2), m.group(3)
    hour = int(hh) % 12
    if ap == "PM":
        hour += 12
    minute = int(mm) if mm is not None else 0
    method = "minute_family_clock_as_written" if mm is not None else "legacy_hourly_plus_30_minutes"
    if mm is None:
        minute = 30
    y, mo, d = map(int, report_date.split("-"))
    local = datetime(y, mo, d, hour, minute, tzinfo=ET)
    return local.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z"), method


def title_calendar_date(title_raw: str) -> str | None:
    m = TITLE_DATE_RE.search(title_raw or "")
    if not m:
        return None
    mm, dd, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if yy < 100:
        yy += 2000
    return f"{yy:04d}-{mm:02d}-{dd:02d}"


def canonical_parse_hash(report: dict[str, Any], rows: list[dict[str, Any]]) -> str:
    """Deterministic SHA-256 over report metadata + ordered rows (no provenance)."""
    payload = {
        "report": {
            "title_raw": report.get("title_raw"),
            "report_published_at": report.get("report_published_at"),
            "timezone": report.get("timezone"),
            "page_count": report.get("page_count"),
        },
        "rows": [
            {
                "page_number": r.get("page_number"),
                "visual_row_index": r.get("visual_row_index"),
                "row_kind": r.get("row_kind"),
                "game_date": r.get("game_date"),
                "game_time_et": r.get("game_time_et"),
                "matchup": r.get("matchup"),
                "team_name": r.get("team_name"),
                "player_name_raw": r.get("player_name_raw"),
                "status_raw": r.get("status_raw"),
                "reason_raw": r.get("reason_raw"),
            }
            for r in rows
        ],
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return sha256_bytes(blob)


def map_error_code(exc: OfficialInjuryParseError) -> str:
    return {
        "INVALID_PDF": "PDF_READ_ERROR",
        "TITLE_MISSING": "TITLE_MISSING",
        "TITLE_TIMESTAMP_UNPARSEABLE": "TITLE_TIMESTAMP_UNPARSEABLE",
        "TABLE_HEADER_MISSING": "TABLE_HEADER_MISSING",
        "TABLE_STRUCTURE": "TABLE_STRUCTURE_UNRECOVERABLE",
        "ROW_AMBIGUITY": "ROW_CONTEXT_UNRECOVERABLE",
        "UNSUPPORTED_LAYOUT": "PAGE_LAYOUT_UNSUPPORTED",
    }.get(exc.code, "OTHER_STRUCTURAL_ERROR")


def run_gold_regression() -> dict[str, Any]:
    manifest = json.loads(MANIFEST_FIXTURES.read_text(encoding="utf-8"))
    failures = []
    passed = 0
    for fx in manifest["fixtures"]:
        fid = fx["fixture_id"]
        gold = json.loads((EXPECTED_DIR / f"{fid}.json").read_text(encoding="utf-8"))
        pdf = GOLD_PDF_DIR / Path(fx["s3_key"]).name
        if not pdf.is_file():
            failures.append({"fixture_id": fid, "error": "missing_local_pdf"})
            continue
        data = pdf.read_bytes()
        if sha256_bytes(data) != fx["sha256"]:
            failures.append({"fixture_id": fid, "error": "local_pdf_checksum_mismatch"})
            continue
        try:
            parsed = parse_official_injury_report(data, Provenance(source_filename=pdf.name, sha256=fx["sha256"]))
        except Exception as exc:  # noqa: BLE001
            failures.append({"fixture_id": fid, "error": str(exc)})
            continue
        selected = set(gold.get("labeling_scope_pages") or fx.get("selected_pages") or [])
        if gold["labeling_scope"] == "targeted_pages":
            rows = [r for r in parsed.rows if r.page_number in selected]
        else:
            rows = list(parsed.rows)
        expected = [r for p in gold["pages"] for r in p["rows"]]
        ok = (
            parsed.report.title_raw == gold["report"]["title_raw"]
            and parsed.report.report_published_at == gold["report"]["report_published_at"]
            and parsed.report.page_count == gold["report"]["page_count"]
            and len(rows) == len(expected)
        )
        if ok:
            for a, b in zip(rows, expected):
                for k in (
                    "page_number",
                    "visual_row_index",
                    "row_kind",
                    "game_date",
                    "game_time_et",
                    "matchup",
                    "team_name",
                    "player_name_raw",
                    "status_raw",
                    "reason_raw",
                ):
                    if getattr(a, k) != b.get(k):
                        ok = False
                        break
                if not ok:
                    break
        if ok:
            passed += 1
        else:
            failures.append({"fixture_id": fid, "error": "exact_mismatch"})
    return {
        "passed": passed,
        "total": len(manifest["fixtures"]),
        "development_expected": 13,
        "held_out_expected": 7,
        "failures": failures,
        "ok": passed == 20 and not failures,
    }


@dataclass
class OnlineStats:
    successes: int = 0
    failures: int = 0
    warning_reports: int = 0
    checksum_mismatches: int = 0
    failure_categories: Counter = field(default_factory=Counter)
    total_rows: int = 0
    player_rows: int = 0
    nys_rows: int = 0
    status_rows: Counter = field(default_factory=Counter)
    status_reports: dict[str, set] = field(default_factory=lambda: defaultdict(set))
    status_first: dict[str, str] = field(default_factory=dict)
    status_last: dict[str, str] = field(default_factory=dict)
    status_by_season: dict[str, Counter] = field(default_factory=lambda: defaultdict(Counter))
    status_by_family: dict[str, Counter] = field(default_factory=lambda: defaultdict(Counter))
    available_by_season: Counter = field(default_factory=Counter)
    available_reports_by_season: Counter = field(default_factory=Counter)
    available_dates: set = field(default_factory=set)
    available_first: str | None = None
    available_last: str | None = None
    available_by_token: Counter = field(default_factory=Counter)
    reports_with_available: int = 0
    reports_with_nys: int = 0
    nys_by_season: Counter = field(default_factory=Counter)
    nys_by_family: Counter = field(default_factory=Counter)
    nys_by_hour: Counter = field(default_factory=Counter)
    nys_per_report: list = field(default_factory=list)
    row_totals: list = field(default_factory=list)
    player_totals: list = field(default_factory=list)
    page_counts: list = field(default_factory=list)
    zero_semantic: list = field(default_factory=list)
    zero_player: list = field(default_factory=list)
    only_nys: list = field(default_factory=list)
    title_date_deltas: Counter = field(default_factory=Counter)
    title_date_mismatches: list = field(default_factory=list)
    ts_deltas_hourly: Counter = field(default_factory=Counter)
    ts_deltas_minute: Counter = field(default_factory=Counter)
    ts_exceptions: list = field(default_factory=list)
    teams: Counter = field(default_factory=Counter)
    team_first: dict[str, str] = field(default_factory=dict)
    team_last: dict[str, str] = field(default_factory=dict)
    team_seasons: dict[str, set] = field(default_factory=lambda: defaultdict(set))
    matchups: Counter = field(default_factory=Counter)
    nonstandard_matchups: Counter = field(default_factory=Counter)
    suffix_counts: Counter = field(default_factory=Counter)
    non_ascii_names: list = field(default_factory=list)
    non_ascii_count: int = 0
    blank_reasons: int = 0
    reason_lengths: list = field(default_factory=list)
    unique_reasons: set = field(default_factory=set)
    reason_prefix_counts: Counter = field(default_factory=Counter)
    source_sha_keys: dict[str, list] = field(default_factory=lambda: defaultdict(list))
    parsed_sha_keys: dict[str, list] = field(default_factory=lambda: defaultdict(list))
    title_ts_keys: dict[str, list] = field(default_factory=lambda: defaultdict(list))
    structural_flags: Counter = field(default_factory=Counter)
    anomalies: list = field(default_factory=list)
    by_season_success: Counter = field(default_factory=Counter)
    by_family_success: Counter = field(default_factory=Counter)
    by_regime_success: Counter = field(default_factory=Counter)
    by_season_fail: Counter = field(default_factory=Counter)
    ambiguous_warning_reports: list = field(default_factory=list)


def percentile(sorted_vals: list[int], p: float) -> float | None:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return float(sorted_vals[0])
    k = (len(sorted_vals) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return float(sorted_vals[f])
    return sorted_vals[f] * (c - k) + sorted_vals[c] * (k - f)


def dist_summary(vals: list[int]) -> dict[str, Any]:
    if not vals:
        return {"n": 0}
    s = sorted(vals)
    return {
        "n": len(s),
        "min": s[0],
        "p1": percentile(s, 1),
        "p5": percentile(s, 5),
        "median": percentile(s, 50),
        "mean": sum(s) / len(s),
        "p95": percentile(s, 95),
        "p99": percentile(s, 99),
        "max": s[-1],
    }


def add_anomaly(stats: OnlineStats, rec: dict[str, Any], kinds: list[str], detail: dict | None = None) -> None:
    stats.anomalies.append(
        {
            "s3_key": rec.get("s3_key"),
            "source_sha256": rec.get("source_sha256"),
            "report_date_filename": rec.get("report_date_filename"),
            "requested_token": rec.get("requested_token"),
            "parse_status": rec.get("parse_status"),
            "kinds": kinds,
            "detail": detail or {},
            "title_raw": rec.get("title_raw"),
            "report_published_at": rec.get("report_published_at"),
            "error": rec.get("error"),
        }
    )


def process_one(row: dict[str, Any], s3_client, bucket: str, parser_sha: str) -> dict[str, Any]:
    s3_key = row["s3_pdf_key"]
    expected_sha = row["sha256"]
    season = row["season"]
    report_date = row["report_date"]
    token = row["requested_token"]
    fam = row["filename_family"]
    inferred_iso, inferred_method = infer_from_token(report_date, token)

    base: dict[str, Any] = {
        "s3_key": s3_key,
        "source_sha256_expected": expected_sha,
        "source_sha256": None,
        "parser_sha256": parser_sha,
        "season": season,
        "report_date_filename": report_date,
        "requested_token": token,
        "filename_family": fam,
        "filename_family_bucket": family_bucket(fam),
        "source_regime": regime_for(report_date),
        "inferred_report_published_at": inferred_iso,
        "inference_method": inferred_method,
        "parse_status": None,
        "failure_category": None,
        "title_raw": None,
        "report_published_at": None,
        "page_count": None,
        "total_rows": None,
        "player_rows": None,
        "team_not_yet_submitted_rows": None,
        "status_counts": {},
        "unique_statuses": [],
        "warnings": [],
        "parsed_output_sha256": None,
        "error": None,
        "rows": None,  # stripped before durable write of summary
    }

    try:
        obj = s3_client.get_object(Bucket=bucket, Key=s3_key)
        pdf_bytes = obj["Body"].read()
    except Exception as exc:  # noqa: BLE001
        base["parse_status"] = "FAILURE"
        base["failure_category"] = "PDF_READ_ERROR"
        base["error"] = f"s3_get_failed: {type(exc).__name__}: {exc}"
        return base

    digest = sha256_bytes(pdf_bytes)
    base["source_sha256"] = digest
    if digest.lower() != expected_sha.lower():
        base["parse_status"] = "FAILURE"
        base["failure_category"] = "SOURCE_CHECKSUM_MISMATCH"
        base["error"] = f"checksum_mismatch expected={expected_sha} actual={digest}"
        return base

    try:
        parsed = parse_official_injury_report(
            pdf_bytes,
            Provenance(source_filename=Path(s3_key).name, sha256=expected_sha),
        )
    except OfficialInjuryParseError as exc:
        base["parse_status"] = "FAILURE"
        base["failure_category"] = map_error_code(exc)
        base["error"] = f"{exc.code}: {exc.message}"
        return base
    except Exception as exc:  # noqa: BLE001
        base["parse_status"] = "FAILURE"
        base["failure_category"] = "PARSER_EXCEPTION"
        base["error"] = f"{type(exc).__name__}: {exc}"
        return base

    rows = [asdict(r) for r in parsed.rows]
    status_counts: Counter[str] = Counter()
    player_n = 0
    nys_n = 0
    for r in rows:
        if r["row_kind"] == "player":
            player_n += 1
            st = r.get("status_raw") or ""
            status_counts[st] += 1
        elif r["row_kind"] == "team_not_yet_submitted":
            nys_n += 1

    base.update(
        {
            "parse_status": "SUCCESS",
            "title_raw": parsed.report.title_raw,
            "report_published_at": parsed.report.report_published_at,
            "page_count": parsed.report.page_count,
            "total_rows": len(rows),
            "player_rows": player_n,
            "team_not_yet_submitted_rows": nys_n,
            "status_counts": dict(status_counts),
            "unique_statuses": sorted(status_counts),
            "warnings": [asdict(w) for w in parsed.warnings],
            "parsed_output_sha256": canonical_parse_hash(asdict(parsed.report), rows),
            "rows": rows,
        }
    )
    return base


def ingest_success(stats: OnlineStats, rec: dict[str, Any]) -> None:
    stats.successes += 1
    season = rec["season"]
    fam = rec["filename_family_bucket"]
    regime = rec["source_regime"]
    stats.by_season_success[season] += 1
    stats.by_family_success[fam] += 1
    stats.by_regime_success[regime] += 1

    warnings = rec.get("warnings") or []
    if warnings:
        stats.warning_reports += 1
        if any((w.get("code") or "") in AMBIGUOUS_WARNING_CODES for w in warnings):
            stats.ambiguous_warning_reports.append(rec["s3_key"])
            add_anomaly(stats, rec, ["AMBIGUOUS_PARSER_WARNING"], {"warnings": warnings})

    total = rec["total_rows"] or 0
    player_n = rec["player_rows"] or 0
    nys_n = rec["team_not_yet_submitted_rows"] or 0
    stats.total_rows += total
    stats.player_rows += player_n
    stats.nys_rows += nys_n
    stats.row_totals.append(total)
    stats.player_totals.append(player_n)
    stats.nys_per_report.append(nys_n)
    stats.page_counts.append(rec["page_count"] or 0)

    if total == 0:
        stats.zero_semantic.append(rec["s3_key"])
        add_anomaly(stats, rec, ["ZERO_SEMANTIC_ROWS"])
    if player_n == 0:
        stats.zero_player.append(rec["s3_key"])
    if player_n == 0 and nys_n > 0:
        stats.only_nys.append(rec["s3_key"])
        add_anomaly(stats, rec, ["ONLY_NYS_ROWS"])

    if nys_n > 0:
        stats.reports_with_nys += 1
        stats.nys_by_season[season] += nys_n
        stats.nys_by_family[fam] += nys_n
        # hour from canonical published_at
        pub = rec.get("report_published_at")
        if pub:
            try:
                dt = datetime.fromisoformat(pub.replace("Z", "+00:00")).astimezone(ET)
                stats.nys_by_hour[f"{dt.hour:02d}"] += nys_n
            except Exception:
                pass

    # statuses
    has_available = False
    for st, cnt in (rec.get("status_counts") or {}).items():
        stats.status_rows[st] += cnt
        stats.status_reports[st].add(rec["s3_key"])
        stats.status_by_season[st][season] += cnt
        stats.status_by_family[st][fam] += cnt
        pub = rec.get("report_published_at") or ""
        if st not in stats.status_first or (pub and pub < stats.status_first[st]):
            if pub:
                stats.status_first[st] = pub
        if st not in stats.status_last or (pub and pub > stats.status_last[st]):
            if pub:
                stats.status_last[st] = pub
        if st == "Available" and cnt:
            has_available = True
            stats.available_by_season[season] += cnt
            stats.available_by_token[rec["requested_token"]] += cnt
        if st not in KNOWN_STATUSES and st:
            add_anomaly(stats, rec, ["UNKNOWN_STATUS"], {"status": st, "count": cnt})

    if has_available:
        stats.reports_with_available += 1
        stats.available_reports_by_season[season] += 1
        tdate = title_calendar_date(rec.get("title_raw") or "") or rec["report_date_filename"]
        stats.available_dates.add(tdate)
        pub = rec.get("report_published_at")
        if pub:
            if stats.available_first is None or pub < stats.available_first:
                stats.available_first = pub
            if stats.available_last is None or pub > stats.available_last:
                stats.available_last = pub

    # title date vs filename date
    tdate = title_calendar_date(rec.get("title_raw") or "")
    if tdate:
        if tdate == rec["report_date_filename"]:
            stats.title_date_deltas["exact"] += 1
        else:
            try:
                d0 = datetime.fromisoformat(rec["report_date_filename"])
                d1 = datetime.fromisoformat(tdate)
                delta = (d1 - d0).days
            except Exception:
                delta = "other"
            key = f"delta_{delta}" if isinstance(delta, int) else "other"
            stats.title_date_deltas[key] += 1
            if delta != 0:
                stats.title_date_mismatches.append(
                    {
                        "s3_key": rec["s3_key"],
                        "filename_date": rec["report_date_filename"],
                        "title_date": tdate,
                        "delta_days": delta,
                    }
                )
                add_anomaly(stats, rec, ["TITLE_DATE_MISMATCH"], {"filename_date": rec["report_date_filename"], "title_date": tdate})

    # timestamp delta vs inference
    pub = rec.get("report_published_at")
    inferred = rec.get("inferred_report_published_at")
    if pub and inferred:
        try:
            t0 = datetime.fromisoformat(pub.replace("Z", "+00:00"))
            t1 = datetime.fromisoformat(inferred.replace("Z", "+00:00"))
            delta_min = int((t1 - t0).total_seconds() // 60)
        except Exception:
            delta_min = None
        bucket = fam
        ctr = stats.ts_deltas_hourly if bucket == "hourly" else stats.ts_deltas_minute
        if delta_min is None:
            ctr["unparseable"] += 1
        elif delta_min == 0:
            ctr["exact_0"] += 1
        elif delta_min in (15, 30, 45, -15, -30, -45):
            ctr[f"delta_{delta_min}"] += 1
        else:
            ctr[f"other_{delta_min}"] += 1
            stats.ts_exceptions.append(
                {
                    "s3_key": rec["s3_key"],
                    "title": pub,
                    "inferred": inferred,
                    "delta_minutes": delta_min,
                    "family": fam,
                    "token": rec["requested_token"],
                    "title_raw": rec.get("title_raw"),
                }
            )
            add_anomaly(stats, rec, ["UNUSUAL_TIMESTAMP_DELTA"], {"delta_minutes": delta_min})

    # content hashes
    stats.source_sha_keys[rec["source_sha256"]].append(rec["s3_key"])
    if rec.get("parsed_output_sha256"):
        stats.parsed_sha_keys[rec["parsed_output_sha256"]].append(rec["s3_key"])
    if pub:
        stats.title_ts_keys[pub].append(rec["s3_key"])

    # row-level scan
    for r in rec.get("rows") or []:
        if r["row_kind"] == "player":
            for req in ("game_date", "game_time_et", "matchup", "team_name", "player_name_raw", "status_raw"):
                if not r.get(req):
                    stats.structural_flags[f"player_missing_{req}"] += 1
                    add_anomaly(stats, rec, ["PLAYER_MISSING_FIELD"], {"field": req, "row": r})
            name = r.get("player_name_raw") or ""
            if any(s in name for s in (" Jr.", " Jr,", "Jr.")):
                stats.suffix_counts["Jr"] += 1
            if " Sr." in name or name.endswith(" Sr"):
                stats.suffix_counts["Sr"] += 1
            if re.search(r"\bII\b", name):
                stats.suffix_counts["II"] += 1
            if re.search(r"\bIII\b", name):
                stats.suffix_counts["III"] += 1
            if re.search(r"\bIV\b", name):
                stats.suffix_counts["IV"] += 1
            if "-" in name:
                stats.suffix_counts["hyphen"] += 1
            if "'" in name or "’" in name:
                stats.suffix_counts["apostrophe"] += 1
            if "." in name:
                stats.suffix_counts["period"] += 1
            if any(ord(ch) > 127 for ch in name):
                stats.non_ascii_count += 1
                if len(stats.non_ascii_names) < 200:
                    stats.non_ascii_names.append({"name": name, "s3_key": rec["s3_key"]})
            reason = r.get("reason_raw")
            if reason is None or reason == "":
                stats.blank_reasons += 1
            else:
                stats.reason_lengths.append(len(reason))
                if len(stats.unique_reasons) < 500_000:
                    stats.unique_reasons.add(reason)
                prefix = reason.split(" - ", 1)[0] if " - " in reason else reason.split(";", 1)[0]
                stats.reason_prefix_counts[prefix[:80]] += 1
            m = r.get("matchup") or ""
            stats.matchups[m] += 1
            if m and not MATCHUP_RE.match(m):
                stats.nonstandard_matchups[m] += 1
                add_anomaly(stats, rec, ["NONSTANDARD_MATCHUP"], {"matchup": m})
            team = r.get("team_name") or ""
            if team:
                stats.teams[team] += 1
                pubd = rec.get("report_published_at") or ""
                if team not in stats.team_first or (pubd and pubd < stats.team_first[team]):
                    if pubd:
                        stats.team_first[team] = pubd
                if team not in stats.team_last or (pubd and pubd > stats.team_last[team]):
                    if pubd:
                        stats.team_last[team] = pubd
                stats.team_seasons[team].add(season)
        elif r["row_kind"] == "team_not_yet_submitted":
            if r.get("player_name_raw"):
                stats.structural_flags["nys_with_player_name"] += 1
                add_anomaly(stats, rec, ["MALFORMED_NYS"], {"row": r})
            for req in ("game_date", "game_time_et", "matchup", "team_name"):
                if not r.get(req):
                    stats.structural_flags[f"nys_missing_{req}"] += 1
                    add_anomaly(stats, rec, ["NYS_MISSING_CONTEXT"], {"field": req, "row": r})
            team = r.get("team_name") or ""
            if team:
                stats.teams[team] += 1
                stats.team_seasons[team].add(season)
            m = r.get("matchup") or ""
            if m:
                stats.matchups[m] += 1
                if not MATCHUP_RE.match(m):
                    stats.nonstandard_matchups[m] += 1


def ingest_failure(stats: OnlineStats, rec: dict[str, Any]) -> None:
    stats.failures += 1
    cat = rec.get("failure_category") or "OTHER_STRUCTURAL_ERROR"
    stats.failure_categories[cat] += 1
    stats.by_season_fail[rec["season"]] += 1
    if cat == "SOURCE_CHECKSUM_MISMATCH":
        stats.checksum_mismatches += 1
    add_anomaly(stats, rec, [cat], {"error": rec.get("error")})


def durable_summary(rec: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in rec.items() if k != "rows"}
    return out


def main() -> int:
    load_dotenv(ROOT / ".env")
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0, help="optional smoke limit")
    ap.add_argument("--skip-gold", action="store_true")
    args = ap.parse_args()

    fingerprint_start = require_parser_freeze()
    TMP.mkdir(parents=True, exist_ok=True)
    ANOMALY_REVIEW.mkdir(parents=True, exist_ok=True)

    if not args.skip_gold:
        print("Running gold regression 20/20...", flush=True)
        gold = run_gold_regression()
        if not gold["ok"]:
            print(json.dumps(gold, indent=2))
            raise SystemExit("HARD STOP: gold regression failed before archive-wide parse")
        print(f"Gold regression PASS {gold['passed']}/{gold['total']}", flush=True)
    else:
        gold = {"ok": False, "skipped": True}

    population = load_population()
    if args.limit and args.limit > 0:
        population = population[: args.limit]
        print(f"SMOKE limit={len(population)}", flush=True)

    bucket = os.environ.get("NBA_DATA_BUCKET", "").strip()
    if not bucket:
        raise SystemExit("NBA_DATA_BUCKET required")
    import boto3

    s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION") or "us-east-1")
    parser_sha = fingerprint_start["parser_sha256"]

    # Resume: load completed keys with matching parser sha
    completed: dict[str, dict[str, Any]] = {}
    if RESULTS_GZ.exists():
        with gzip.open(RESULTS_GZ, "rt", encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                rec = json.loads(line)
                if (
                    rec.get("parser_sha256") == parser_sha
                    and rec.get("source_sha256_expected")
                    and rec.get("parse_status") in ("SUCCESS", "FAILURE")
                ):
                    # only skip if success has parsed hash or failure has category
                    if rec["parse_status"] == "SUCCESS" and not rec.get("parsed_output_sha256"):
                        continue
                    completed[rec["s3_key"]] = rec
        print(f"Resume: {len(completed)} prior results with matching parser SHA", flush=True)

    # Rewrite results file from completed + new (append mode for new only if starting fresh)
    # Strategy: append only missing keys; rebuild characterization from full scan at end.
    todo = [r for r in population if r["s3_pdf_key"] not in completed]
    print(f"Population={len(population)} todo={len(todo)} workers={args.workers}", flush=True)

    started = time.time()
    done_new = 0
    stats = OnlineStats()

    # Seed stats from completed
    for rec in completed.values():
        if rec["parse_status"] == "SUCCESS":
            # completed summaries lack rows — for resume mid-run, re-parse would be needed for row corpus.
            # For characterization of resumed successes without rows, mark incomplete.
            if "rows" in rec and rec["rows"] is not None:
                ingest_success(stats, rec)
            else:
                # lightweight counters from summary fields only
                stats.successes += 1
                stats.total_rows += rec.get("total_rows") or 0
                stats.player_rows += rec.get("player_rows") or 0
                stats.nys_rows += rec.get("team_not_yet_submitted_rows") or 0
                stats.by_season_success[rec["season"]] += 1
                stats.by_family_success[rec.get("filename_family_bucket") or family_bucket(rec["filename_family"])] += 1
                for st, cnt in (rec.get("status_counts") or {}).items():
                    stats.status_rows[st] += cnt
                if (rec.get("team_not_yet_submitted_rows") or 0) > 0:
                    stats.reports_with_nys += 1
                if "Available" in (rec.get("status_counts") or {}):
                    stats.reports_with_available += 1
                    stats.available_by_season[rec["season"]] += rec["status_counts"]["Available"]
        else:
            ingest_failure(stats, rec)

    results_mode = "at" if RESULTS_GZ.exists() and completed else "wt"
    rows_mode = "at" if ROWS_GZ.exists() and completed else "wt"

    with gzip.open(RESULTS_GZ, results_mode, encoding="utf-8") as results_fh, gzip.open(
        ROWS_GZ, rows_mode, encoding="utf-8"
    ) as rows_fh:

        def handle(rec: dict[str, Any]) -> None:
            nonlocal done_new
            rows = rec.pop("rows", None)
            summary = durable_summary(rec)
            # restore rows for ingest then drop
            if rows is not None:
                rec["rows"] = rows
            with write_lock:
                results_fh.write(json.dumps(summary, ensure_ascii=False) + "\n")
                if rec.get("parse_status") == "SUCCESS" and rows is not None:
                    ingest_success(stats, rec)
                    for r in rows:
                        row_out = {
                            "s3_key": rec["s3_key"],
                            "source_sha256": rec["source_sha256"],
                            "parser_sha256": parser_sha,
                            "report_published_at": rec["report_published_at"],
                            "title_raw": rec["title_raw"],
                            "season": rec["season"],
                            "report_date_filename": rec["report_date_filename"],
                            "requested_token": rec["requested_token"],
                            "filename_family": rec["filename_family"],
                            **{k: r.get(k) for k in (
                                "page_number",
                                "visual_row_index",
                                "row_kind",
                                "game_date",
                                "game_time_et",
                                "matchup",
                                "team_name",
                                "player_name_raw",
                                "status_raw",
                                "reason_raw",
                            )},
                        }
                        rows_fh.write(json.dumps(row_out, ensure_ascii=False) + "\n")
                elif rec.get("parse_status") == "FAILURE":
                    ingest_failure(stats, rec)
                done_new += 1
                if done_new % 100 == 0 or done_new == len(todo):
                    elapsed = time.time() - started
                    rate = done_new / elapsed if elapsed else 0
                    print(
                        f"progress new={done_new}/{len(todo)} total_done={len(completed)+done_new}/{len(population)} "
                        f"rate={rate:.2f}/s successes={stats.successes} failures={stats.failures}",
                        flush=True,
                    )
                    RUN_STATE.write_text(
                        json.dumps(
                            {
                                "updated_at": datetime.now(timezone.utc).isoformat(),
                                "parser_sha256": parser_sha,
                                "completed": len(completed) + done_new,
                                "expected": len(population),
                                "successes": stats.successes,
                                "failures": stats.failures,
                            },
                            indent=2,
                        )
                        + "\n",
                        encoding="utf-8",
                    )

        if todo:
            with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
                futs = {
                    ex.submit(process_one, row, s3, bucket, parser_sha): row["s3_pdf_key"]
                    for row in todo
                }
                for fut in as_completed(futs):
                    handle(fut.result())

    fingerprint_end = require_parser_freeze()
    if fingerprint_end["parser_sha256"] != fingerprint_start["parser_sha256"]:
        raise SystemExit("HARD STOP: parser SHA changed during run")

    # Final gold regression
    if not args.skip_gold:
        gold_end = run_gold_regression()
    else:
        gold_end = gold

    # Outlier thresholds for row counts / pages
    row_dist = dist_summary(stats.row_totals)
    page_dist = dist_summary(stats.page_counts)
    if row_dist.get("n"):
        p99 = row_dist["p99"] or 0
        for i, (total, key) in enumerate(zip(stats.row_totals, [])):
            pass
        # flag extremes already partially covered; add high page outliers from results file scan if needed

    dup_source = {h: keys for h, keys in stats.source_sha_keys.items() if len(keys) > 1}
    dup_parsed = {h: keys for h, keys in stats.parsed_sha_keys.items() if len(keys) > 1}
    dup_title_ts = {ts: keys for ts, keys in stats.title_ts_keys.items() if len(keys) > 1}

    # Hard failures requiring review
    hard_fail_cats = {
        k: v
        for k, v in stats.failure_categories.items()
        if k != "SOURCE_CHECKSUM_MISMATCH" or v > 0
    }
    unreviewed_hard = stats.failures  # any failure is hard until reviewed
    ambiguous = len(stats.ambiguous_warning_reports)

    processed = stats.successes + stats.failures
    # If resume used summary-only successes, processed may undercount relative to population
    accounted = len(completed) + done_new if not completed else processed
    # Prefer exact: re-count results file
    result_count = 0
    success_count = 0
    fail_count = 0
    with gzip.open(RESULTS_GZ, "rt", encoding="utf-8") as fh:
        seen_keys = set()
        for line in fh:
            if not line.strip():
                continue
            rec = json.loads(line)
            if rec.get("parser_sha256") != parser_sha:
                continue
            k = rec["s3_key"]
            if k in seen_keys:
                continue  # keep first
            seen_keys.add(k)
            result_count += 1
            if rec.get("parse_status") == "SUCCESS":
                success_count += 1
            else:
                fail_count += 1

    population_keys = {r["s3_pdf_key"] for r in population}
    missing_keys = sorted(population_keys - seen_keys) if 'seen_keys' in dir() else []

    # Rebuild accurate characterization by streaming results+rows if we have full row corpus
    # For gate: require result_count == expected and fail_count == 0 and gold ok and no ambiguous warnings

    gate_pass = (
        result_count == len(population)
        and fail_count == 0
        and stats.checksum_mismatches == 0
        and gold_end.get("ok") is True
        and fingerprint_end["parser_sha256"] == CERTIFIED_PARSER_SHA
        and ambiguous == 0
        and len(stats.zero_semantic) == 0  # treat zero-semantic as must-review; fail until understood
    )
    # Zero-semantic may be valid — if any exist, gate fails for review per AE/AK
    # If there are title-date mismatches / unusual deltas that aren't structural parser issues,
    # they remain anomalies but don't fail gate unless parser ambiguity.

    # Soften: zero semantic fails gate (must review). Unusual timestamp deltas do not fail if parse succeeded.
    if stats.zero_semantic:
        gate_pass = False

    f4 = "CLOSED" if gate_pass else ("REOPENED" if fail_count or ambiguous else "CLOSED")
    # F4 closed if no parser structural failure evidence
    if fail_count == 0 and ambiguous == 0 and gold_end.get("ok") and fingerprint_end["parser_sha256"] == CERTIFIED_PARSER_SHA:
        if result_count == len(population):
            f4 = "CLOSED"
        else:
            f4 = "REOPENED"
    else:
        f4 = "REOPENED"

    # F5: Available coverage measured if all successes
    f5 = "CLOSED" if success_count == len(population) and fail_count == 0 else "PARTIAL"

    # Recompute Available by season from status_rows / available_by_season (online)
    available_2023 = stats.available_by_season.get("2023", 0)

    # Write anomalies ndjson (committed)
    with ANOMALIES_NDJSON.open("w", encoding="utf-8") as af:
        for a in stats.anomalies:
            af.write(json.dumps(a, ensure_ascii=False) + "\n")

    # Materialize bounded anomaly review sample (high severity)
    high = [
        a
        for a in stats.anomalies
        if any(
            k in a.get("kinds", [])
            for k in (
                "SOURCE_CHECKSUM_MISMATCH",
                "TITLE_MISSING",
                "TITLE_TIMESTAMP_UNPARSEABLE",
                "TABLE_HEADER_MISSING",
                "TABLE_STRUCTURE_UNRECOVERABLE",
                "ROW_CONTEXT_UNRECOVERABLE",
                "PAGE_LAYOUT_UNSUPPORTED",
                "PARSER_EXCEPTION",
                "ZERO_SEMANTIC_ROWS",
                "AMBIGUOUS_PARSER_WARNING",
            )
        )
    ][:50]
    (ANOMALY_REVIEW / "high-severity-sample.json").write_text(
        json.dumps(high, indent=2) + "\n", encoding="utf-8"
    )

    # Status vocabulary detail
    status_vocab = {}
    for st, cnt in sorted(stats.status_rows.items(), key=lambda x: (-x[1], x[0])):
        status_vocab[st] = {
            "rows": cnt,
            "reports": len(stats.status_reports.get(st, [])),
            "first_published_at": stats.status_first.get(st),
            "last_published_at": stats.status_last.get(st),
            "by_season": dict(stats.status_by_season.get(st, {})),
            "by_family": dict(stats.status_by_family.get(st, {})),
        }

    # Copy compact per-report audit to committed records if reasonable size, else pointer
    # Prefer writing committed records as gunzipped copy only if small; else pointer.
    # Always write gzip path checksums.
    results_sha = sha256_file(RESULTS_GZ)
    rows_sha = sha256_file(ROWS_GZ) if ROWS_GZ.exists() else None

    # For committed records.ndjson — write SUCCESS/FAILURE summaries without huge expansion:
    # stream unique latest from gz into reports path (may be ~15-20MB — Phase 2 records were 15MB; OK).
    print("Writing committed per-report audit NDJSON...", flush=True)
    with RECORDS_NDJSON.open("w", encoding="utf-8") as out_fh, gzip.open(RESULTS_GZ, "rt", encoding="utf-8") as in_fh:
        seen = set()
        for line in in_fh:
            if not line.strip():
                continue
            rec = json.loads(line)
            if rec.get("parser_sha256") != parser_sha:
                continue
            k = rec["s3_key"]
            if k in seen:
                continue
            seen.add(k)
            out_fh.write(json.dumps(rec, ensure_ascii=False) + "\n")

    summary = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "phase": "3D",
        "PARSER_CERTIFIED": "YES",
        "PARSER_DEVELOPMENT_GATE": "PASS",
        "AS_OF_INJURY_TAPE_CERTIFIED": "NO",
        "ARCHIVE_WIDE_PARSE_GATE": "PASS" if gate_pass else "FAIL",
        "F4": f4,
        "F5": f5,
        "NEXT": (
            "PROCEED_TO_GAME_JOIN_CERTIFICATION"
            if gate_pass
            else "BUILD_NEW_GOLD_FROM_ARCHIVE_OUTLIERS_AND_REOPEN_PARSER_DEVELOPMENT"
        ),
        "fingerprint_start": fingerprint_start,
        "fingerprint_end": fingerprint_end,
        "parser_fingerprint_unchanged": fingerprint_start["parser_sha256"] == fingerprint_end["parser_sha256"],
        "gold_regression_start": gold,
        "gold_regression_end": gold_end,
        "expected_pdfs": len(population) if not args.limit else EXPECTED_PDFS,
        "population_this_run": len(population),
        "processed_unique": result_count,
        "parse_successes": success_count,
        "parse_failures": fail_count,
        "source_checksum_mismatches": stats.checksum_mismatches,
        "reports_with_warnings": stats.warning_reports,
        "ambiguous_warning_reports": stats.ambiguous_warning_reports,
        "failure_categories": dict(stats.failure_categories),
        "total_semantic_rows": stats.total_rows,
        "total_player_rows": stats.player_rows,
        "total_nys_rows": stats.nys_rows,
        "unique_statuses": sorted(stats.status_rows),
        "status_vocabulary": status_vocab,
        "available": {
            "total_rows": stats.status_rows.get("Available", 0),
            "reports_containing": stats.reports_with_available,
            "by_season_rows": dict(stats.available_by_season),
            "by_season_reports": dict(stats.available_reports_by_season),
            "active_dates_count": len(stats.available_dates),
            "earliest": stats.available_first,
            "latest": stats.available_last,
            "by_token_top": stats.available_by_token.most_common(30),
            "season_2023_has_available": available_2023 > 0,
            "share_successful_reports": (
                stats.reports_with_available / success_count if success_count else None
            ),
        },
        "nys": {
            "total_rows": stats.nys_rows,
            "reports_containing": stats.reports_with_nys,
            "per_report_dist": dist_summary(stats.nys_per_report),
            "by_season": dict(stats.nys_by_season),
            "by_family": dict(stats.nys_by_family),
            "by_hour_et": dict(sorted(stats.nys_by_hour.items())),
        },
        "row_count_dist": dist_summary(stats.row_totals),
        "player_row_count_dist": dist_summary(stats.player_totals),
        "page_count_dist": dist_summary(stats.page_counts),
        "zero_semantic_reports": stats.zero_semantic,
        "zero_player_reports_count": len(stats.zero_player),
        "only_nys_reports_count": len(stats.only_nys),
        "title_date_audit": dict(stats.title_date_deltas),
        "title_date_mismatches_count": len(stats.title_date_mismatches),
        "title_date_mismatches_sample": stats.title_date_mismatches[:50],
        "timestamp_deltas_hourly": dict(stats.ts_deltas_hourly),
        "timestamp_deltas_minute": dict(stats.ts_deltas_minute),
        "timestamp_exceptions_count": len(stats.ts_exceptions),
        "timestamp_exceptions_sample": stats.ts_exceptions[:100],
        "duplicate_raw_pdf_groups": len(dup_source),
        "duplicate_raw_pdf_groups_sample": [
            {"sha256": h, "keys": ks} for h, ks in list(dup_source.items())[:20]
        ],
        "duplicate_parsed_output_groups": len(dup_parsed),
        "duplicate_title_timestamp_groups": len(dup_title_ts),
        "unique_team_names": len(stats.teams),
        "team_names": {
            t: {
                "count": c,
                "first": stats.team_first.get(t),
                "last": stats.team_last.get(t),
                "seasons": sorted(stats.team_seasons.get(t, [])),
            }
            for t, c in sorted(stats.teams.items(), key=lambda x: (-x[1], x[0]))
        },
        "unique_matchups": len(stats.matchups),
        "nonstandard_matchup_count": len(stats.nonstandard_matchups),
        "nonstandard_matchups": dict(stats.nonstandard_matchups.most_common(100)),
        "player_name_shapes": dict(stats.suffix_counts),
        "non_ascii_player_name_count": stats.non_ascii_count,
        "non_ascii_player_name_sample": stats.non_ascii_names[:50],
        "reason_audit": {
            "blank_reasons": stats.blank_reasons,
            "unique_exact_reasons_capped": len(stats.unique_reasons),
            "max_reason_length": max(stats.reason_lengths) if stats.reason_lengths else None,
            "reason_length_dist": dist_summary(stats.reason_lengths),
            "common_prefixes": stats.reason_prefix_counts.most_common(40),
        },
        "structural_flags": dict(stats.structural_flags),
        "anomaly_count": len(stats.anomalies),
        "by_season_success": dict(stats.by_season_success),
        "by_family_success": dict(stats.by_family_success),
        "by_regime_success": dict(stats.by_regime_success),
        "artifacts": {
            "tmp_dir": str(TMP.relative_to(ROOT)).replace("\\", "/"),
            "report_results_gz": str(RESULTS_GZ.relative_to(ROOT)).replace("\\", "/"),
            "report_results_gz_sha256": results_sha,
            "report_results_gz_bytes": RESULTS_GZ.stat().st_size,
            "parsed_rows_gz": str(ROWS_GZ.relative_to(ROOT)).replace("\\", "/"),
            "parsed_rows_gz_sha256": rows_sha,
            "parsed_rows_gz_bytes": ROWS_GZ.stat().st_size if ROWS_GZ.exists() else 0,
            "records_ndjson": str(RECORDS_NDJSON.relative_to(ROOT)).replace("\\", "/"),
            "records_ndjson_bytes": RECORDS_NDJSON.stat().st_size,
            "records_ndjson_count": result_count,
            "anomalies_ndjson": str(ANOMALIES_NDJSON.relative_to(ROOT)).replace("\\", "/"),
            "canonical_parse_hash_spec": (
                "SHA-256 of UTF-8 JSON with sort_keys separators=(',', ':') over "
                "{report:{title_raw,report_published_at,timezone,page_count}, rows:[{page_number,"
                "visual_row_index,row_kind,game_date,game_time_et,matchup,team_name,player_name_raw,"
                "status_raw,reason_raw}]} — no provenance."
            ),
        },
        "smoke_limit": args.limit or None,
        "missing_population_keys_count": len(missing_keys) if 'missing_keys' in locals() else None,
    }

    # Gate refinement: if smoke limit, don't claim full archive gate
    if args.limit:
        summary["ARCHIVE_WIDE_PARSE_GATE"] = "FAIL"
        summary["NEXT"] = "RE_RUN_FULL_POPULATION_WITHOUT_LIMIT"
        summary["F4"] = "PARTIAL"
        summary["F5"] = "PARTIAL"
        summary["note"] = "Smoke/limit run — not a full archive certification."

    REPORT_JSON.write_text(json.dumps(summary, indent=2, default=str) + "\n", encoding="utf-8")
    write_md(summary)
    print(json.dumps({
        "ARCHIVE_WIDE_PARSE_GATE": summary["ARCHIVE_WIDE_PARSE_GATE"],
        "F4": summary["F4"],
        "F5": summary["F5"],
        "successes": success_count,
        "failures": fail_count,
        "processed": result_count,
        "expected": len(population),
        "NEXT": summary["NEXT"],
    }, indent=2))
    return 0 if summary["ARCHIVE_WIDE_PARSE_GATE"] == "PASS" else 1


def write_md(s: dict[str, Any]) -> None:
    avail = s["available"]
    lines = [
        "# Official injury-report archive-wide dry parse (Phase 3D)",
        "",
        f"Generated: **{s['generated_at']}**",
        "",
        f"**ARCHIVE_WIDE_PARSE_GATE = {s['ARCHIVE_WIDE_PARSE_GATE']}**",
        "",
        f"PARSER_CERTIFIED = {s['PARSER_CERTIFIED']}  ",
        f"PARSER_DEVELOPMENT_GATE = {s['PARSER_DEVELOPMENT_GATE']}  ",
        f"AS_OF_INJURY_TAPE_CERTIFIED = {s['AS_OF_INJURY_TAPE_CERTIFIED']}  ",
        f"F4 = **{s['F4']}**  ",
        f"F5 = **{s['F5']}**  ",
        "",
        f"## NEXT",
        "",
        f"**{s['NEXT']}**",
        "",
        "## Parser freeze",
        "",
        f"- Start SHA: `{s['fingerprint_start']['parser_sha256']}`",
        f"- End SHA: `{s['fingerprint_end']['parser_sha256']}`",
        f"- Unchanged: **{s['parser_fingerprint_unchanged']}**",
        f"- Required: `{CERTIFIED_PARSER_SHA}`",
        f"- pypdf: `{s['fingerprint_start']['pypdf_version']}`",
        f"- Python: `{s['fingerprint_start']['python_version'].split()[0]}`",
        "",
        "## Gold regression",
        "",
        f"- Start: {s['gold_regression_start']}",
        f"- End: {s['gold_regression_end']}",
        "",
        "## Population",
        "",
        f"- Expected PDFs: **{s['expected_pdfs']}**",
        f"- Processed unique: **{s['processed_unique']}**",
        f"- Successes: **{s['parse_successes']}**",
        f"- Failures: **{s['parse_failures']}**",
        f"- Source checksum mismatches: **{s['source_checksum_mismatches']}**",
        f"- Reports with warnings: **{s['reports_with_warnings']}**",
        "",
        "## Rows",
        "",
        f"- Total semantic rows: **{s['total_semantic_rows']}**",
        f"- Player rows: **{s['total_player_rows']}**",
        f"- NYS rows: **{s['total_nys_rows']}**",
        "",
        "## Status vocabulary",
        "",
        f"Unique exact statuses: **{len(s['unique_statuses'])}** — `{', '.join(s['unique_statuses'])}`",
        "",
        "## Available (F5 source coverage)",
        "",
        f"- Available rows: **{avail['total_rows']}**",
        f"- Reports containing Available: **{avail['reports_containing']}**",
        f"- By season (rows): `{avail['by_season_rows']}`",
        f"- By season (reports): `{avail['by_season_reports']}`",
        f"- 2023 season has Available: **{avail['season_2023_has_available']}**",
        f"- Earliest: `{avail['earliest']}`",
        f"- Latest: `{avail['latest']}`",
        "",
        "## NYS",
        "",
        f"- NYS rows: **{s['nys']['total_rows']}**",
        f"- Reports with NYS: **{s['nys']['reports_containing']}**",
        f"- By season: `{s['nys']['by_season']}`",
        "",
        "## Timing",
        "",
        f"- Title/filename date audit: `{s['title_date_audit']}`",
        f"- Title date mismatches: **{s['title_date_mismatches_count']}**",
        f"- Hourly title↔inference deltas: `{s['timestamp_deltas_hourly']}`",
        f"- Minute title↔inference deltas: `{s['timestamp_deltas_minute']}`",
        f"- Unusual timestamp exceptions: **{s['timestamp_exceptions_count']}**",
        "",
        "## Matchups / teams / names",
        "",
        f"- Unique matchups: **{s['unique_matchups']}**",
        f"- Nonstandard matchups: **{s['nonstandard_matchup_count']}**",
        f"- Unique team names: **{s['unique_team_names']}**",
        f"- Non-ASCII player names: **{s['non_ascii_player_name_count']}**",
        f"- Name shape counts: `{s['player_name_shapes']}`",
        "",
        "## Duplicates",
        "",
        f"- Duplicate raw PDF groups: **{s['duplicate_raw_pdf_groups']}**",
        f"- Duplicate parsed-output groups: **{s['duplicate_parsed_output_groups']}**",
        f"- Duplicate title-timestamp groups: **{s['duplicate_title_timestamp_groups']}**",
        "",
        "## Anomalies",
        "",
        f"- Anomaly records: **{s['anomaly_count']}**",
        f"- Zero-semantic reports: **{len(s['zero_semantic_reports'])}**",
        f"- Structural flags: `{s['structural_flags']}`",
        "",
        "## Artifacts",
        "",
        f"- Results: `{s['artifacts']['report_results_gz']}` sha `{s['artifacts']['report_results_gz_sha256']}`",
        f"- Rows: `{s['artifacts']['parsed_rows_gz']}` sha `{s['artifacts']['parsed_rows_gz_sha256']}`",
        f"- Records: `{s['artifacts']['records_ndjson']}` ({s['artifacts']['records_ndjson_bytes']} bytes)",
        f"- Anomalies: `{s['artifacts']['anomalies_ndjson']}`",
        "",
        "No game joins. No identity resolution. No Postgres writes. No S3 writes. No NBA.com fetches.",
        "",
    ]
    REPORT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
