"""
Phase 3C — ONE blind held-out certification run.

CRITICAL:
  - Fingerprint parser BEFORE loading held-out expected JSON.
  - Capture raw parser output BEFORE comparison.
  - Never overwrite first-run artifacts.
  - Never modify parser after seeing results.
  - Do not regenerate gold.
"""

from __future__ import annotations

import hashlib
import json
import platform
import subprocess
import sys
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lib" / "providers"))

from nba_official_injuries import (  # noqa: E402
    Provenance,
    parse_official_injury_report,
)
from nba_official_injuries.errors import OfficialInjuryParseError  # noqa: E402

MANIFEST_PATH = ROOT / "tests" / "fixtures" / "nba-official-injury-reports" / "manifest.json"
EXPECTED_DIR = ROOT / "tests" / "fixtures" / "nba-official-injury-reports" / "expected"
ROWS_DIR = ROOT / "tests" / "fixtures" / "nba-official-injury-reports" / "_rows"
EMIT_PATH = ROOT / "tests" / "fixtures" / "nba-official-injury-reports" / "_emit_expected.py"
META_PATH = ROOT / "tests" / "fixtures" / "nba-official-injury-reports" / "_fixture_meta.json"
PDF_DIR = ROOT / "tmp" / "official-injury-report-gold-fixtures" / "pdfs"

FIRST_RUN_JSON = ROOT / "reports" / "operations" / "official-injury-report-parser-held-out-first-run.json"
FIRST_RUN_MD = ROOT / "reports" / "operations" / "official-injury-report-parser-held-out-first-run.md"
CERT_JSON = ROOT / "reports" / "operations" / "official-injury-report-parser-certification.json"
CERT_MD = ROOT / "reports" / "operations" / "official-injury-report-parser-certification.md"
RAW_OUT_DIR = ROOT / "tmp" / "official-injury-report-parser-held-out-first-run" / "raw_parser_output"

PARSER_FILES = [
    ROOT / "lib" / "providers" / "nba_official_injuries" / "parser.py",
    ROOT / "lib" / "providers" / "nba_official_injuries" / "errors.py",
    ROOT / "lib" / "providers" / "nba_official_injuries" / "__init__.py",
]

COMPARE_FIELDS = (
    "row_kind",
    "game_date",
    "game_time_et",
    "matchup",
    "team_name",
    "player_name_raw",
    "status_raw",
    "reason_raw",
)

AMBIGUOUS_WARNING_CODES = frozenset(
    {
        "UNCERTAIN_ROW_OWNERSHIP",
        "UNCERTAIN_CONTEXT",
        "INCOMPLETE_EXTRACTION",
        "GUESSED_TABLE",
        "ROW_AMBIGUITY",
    }
)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def merkle_dir(dirpath: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(dirpath.glob("*.json")):
        h.update(p.name.encode("utf-8"))
        h.update(b"\0")
        h.update(p.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def git_snapshot() -> dict[str, Any]:
    def run(args: list[str]) -> str:
        try:
            return subprocess.check_output(args, cwd=str(ROOT), text=True).strip()
        except Exception as exc:  # noqa: BLE001
            return f"<unavailable: {exc}>"

    return {
        "commit": run(["git", "rev-parse", "HEAD"]),
        "branch": run(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
        "status_porcelain": run(["git", "status", "--porcelain=v1"]),
        "note": "Working tree may include uncommitted Phase 3B/3C artifacts; parser file hashes below are authoritative.",
    }


def build_fingerprint(cert_runner_path: Path) -> dict[str, Any]:
    import pypdf

    files = {}
    for p in PARSER_FILES + [cert_runner_path]:
        files[str(p.relative_to(ROOT)).replace("\\", "/")] = {
            "sha256": sha256_file(p),
            "bytes": p.stat().st_size,
        }
    return {
        "fingerprinted_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "git": git_snapshot(),
        "python_version": sys.version,
        "pypdf_version": pypdf.__version__,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "files": files,
        "parser_entry_point": "parse_official_injury_report",
        "parser_package": "lib/providers/nba_official_injuries",
    }


def verify_gold_integrity(manifest: dict[str, Any]) -> dict[str, Any]:
    fixtures = manifest["fixtures"]
    if len(fixtures) != 20 or manifest.get("fixture_count") != 20:
        raise RuntimeError("Gold integrity fail: fixture_count != 20")
    dev = [f for f in fixtures if f.get("split") == "development"]
    held = [f for f in fixtures if f.get("split") == "held_out"]
    if len(dev) != 13 or len(held) != 7:
        raise RuntimeError(f"Gold integrity fail: split {len(dev)}/{len(held)}")

    # Split field consistency in expected files (integrity only).
    moved = []
    for p in sorted(EXPECTED_DIR.glob("*.json")):
        doc = json.loads(p.read_text(encoding="utf-8"))
        fid = doc.get("fixture_id") or p.stem
        sp = doc.get("split")
        mf = next((x for x in fixtures if x["fixture_id"] == fid), None)
        if mf and mf["split"] != sp:
            moved.append({"fixture_id": fid, "manifest_split": mf["split"], "expected_split": sp})
    if moved:
        raise RuntimeError(f"Gold integrity fail: split moved {moved}")

    return {
        "fixture_count": 20,
        "development": 13,
        "held_out": 7,
        "expected_file_count": len(list(EXPECTED_DIR.glob("*.json"))),
        "rows_file_count": len(list(ROWS_DIR.glob("*.json"))),
        "expected_merkle_sha256": merkle_dir(EXPECTED_DIR),
        "rows_merkle_sha256": merkle_dir(ROWS_DIR),
        "emit_expected_sha256": sha256_file(EMIT_PATH),
        "fixture_meta_sha256": sha256_file(META_PATH),
        "manifest_sha256": sha256_file(MANIFEST_PATH),
        "split_moves": moved,
        "gold_regenerated": False,
    }


def verify_held_out_pdfs(held: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for fx in held:
        name = Path(fx["s3_key"]).name
        path = PDF_DIR / name
        if not path.is_file():
            raise RuntimeError(f"HARD STOP: missing held-out PDF {path}")
        data = path.read_bytes()
        dig = sha256_bytes(data)
        if dig.lower() != fx["sha256"].lower():
            raise RuntimeError(
                f"HARD STOP: SHA-256 mismatch {fx['fixture_id']}: expected {fx['sha256']} got {dig}"
            )
        out.append(
            {
                "fixture_id": fx["fixture_id"],
                "filename": name,
                "sha256": dig,
                "bytes": len(data),
                "path": str(path.relative_to(ROOT)).replace("\\", "/"),
            }
        )
    return out


@dataclass
class FixtureScore:
    fixture_id: str
    labeling_scope: str
    ok: bool
    error: str | None = None
    parse_exception: bool = False
    title_ok: bool = False
    timestamp_ok: bool = False
    timezone_ok: bool = False
    page_count_ok: bool = False
    row_count_expected: int = 0
    row_count_scored: int = 0
    row_count_parser_total: int = 0
    exact_rows: int = 0
    missing_rows: int = 0
    extra_rows: int = 0
    duplicate_rows: int = 0
    row_order_ok: bool = False
    field_mismatches: dict[str, int] = field(default_factory=dict)
    categories: list[str] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)
    ambiguous_warnings: list[dict[str, Any]] = field(default_factory=list)
    first_diffs: list[dict[str, Any]] = field(default_factory=list)
    raw_output_sha256: str | None = None
    unscored_pages: list[int] = field(default_factory=list)
    forward_fill_notes: dict[str, int] = field(default_factory=dict)


def classify_field(field: str) -> str:
    return {
        "title_raw": "REPORT_TITLE",
        "report_published_at": "REPORT_TIMESTAMP",
        "page_count": "PAGE_COUNT",
        "row_order": "ROW_ORDER",
        "row_kind": "ROW_KIND",
        "game_date": "GAME_DATE",
        "game_time_et": "GAME_TIME",
        "matchup": "MATCHUP",
        "team_name": "TEAM",
        "player_name_raw": "PLAYER_NAME",
        "status_raw": "STATUS",
        "reason_raw": "REASON",
    }.get(field, "OTHER_STRUCTURAL")


def detect_nys_coercion(actual_rows: list[Any], expected_rows: list[dict]) -> bool:
    for b in expected_rows:
        if b.get("row_kind") != "team_not_yet_submitted":
            continue
        # look for nearby wrong player coercion in actual (same page/index if available)
    for a in actual_rows:
        if a.row_kind == "player" and (
            (a.player_name_raw or "").strip().lower() in {"submitted", "yet submitted", "not yet submitted"}
            or (a.status_raw or "").upper().find("SUBMITTED") >= 0
        ):
            return True
    # expected NYS count vs actual NYS on scored set
    exp_nys = sum(1 for b in expected_rows if b.get("row_kind") == "team_not_yet_submitted")
    act_nys = sum(1 for a in actual_rows if a.row_kind == "team_not_yet_submitted")
    return exp_nys != act_nys


def score_fixture(
    fx: dict[str, Any],
    raw_result: dict[str, Any] | None,
    parse_error: str | None,
    raw_sha: str | None,
) -> FixtureScore:
    fid = fx["fixture_id"]
    score = FixtureScore(
        fixture_id=fid,
        labeling_scope=fx["labeling_scope"],
        ok=False,
        raw_output_sha256=raw_sha,
    )
    if parse_error:
        score.error = parse_error
        score.parse_exception = True
        score.categories.append("OTHER_STRUCTURAL")
        return score

    assert raw_result is not None
    gold = json.loads((EXPECTED_DIR / f"{fid}.json").read_text(encoding="utf-8"))
    if gold.get("split") != "held_out":
        raise RuntimeError(f"Expected file for {fid} is not held_out")

    report = raw_result["report"]
    warnings = raw_result.get("warnings") or []
    score.warnings = warnings
    score.ambiguous_warnings = [
        w for w in warnings if (w.get("code") or "") in AMBIGUOUS_WARNING_CODES
    ]

    score.title_ok = report.get("title_raw") == gold["report"]["title_raw"]
    score.timestamp_ok = (
        report.get("report_published_at") == gold["report"]["report_published_at"]
    )
    score.timezone_ok = report.get("timezone") == gold["report"].get("timezone", "America/New_York")
    score.page_count_ok = report.get("page_count") == gold["report"]["page_count"]

    cats: list[str] = []
    if not score.title_ok:
        cats.append("REPORT_TITLE")
    if not score.timestamp_ok:
        cats.append("REPORT_TIMESTAMP")
    if not score.page_count_ok:
        cats.append("PAGE_COUNT")

    selected = set(gold.get("labeling_scope_pages") or fx.get("selected_pages") or [])
    all_rows = raw_result["rows"]
    score.row_count_parser_total = len(all_rows)

    if gold["labeling_scope"] == "targeted_pages":
        scored_rows = [r for r in all_rows if r["page_number"] in selected]
        all_pages = set(range(1, report["page_count"] + 1))
        score.unscored_pages = sorted(all_pages - selected)
    else:
        scored_rows = list(all_rows)

    expected_rows = [r for p in gold["pages"] for r in p["rows"]]
    score.row_count_expected = len(expected_rows)
    score.row_count_scored = len(scored_rows)

    # Duplicate detection on scored actual rows (semantic key)
    keys = [
        (
            r.get("page_number"),
            r.get("visual_row_index"),
            r.get("row_kind"),
            r.get("matchup"),
            r.get("team_name"),
            r.get("player_name_raw"),
            r.get("status_raw"),
            r.get("reason_raw"),
        )
        for r in scored_rows
    ]
    c = Counter(keys)
    score.duplicate_rows = sum(v - 1 for v in c.values() if v > 1)

    field_miss: Counter[str] = Counter()
    exact = 0
    n = min(len(scored_rows), len(expected_rows))
    order_ok = True
    for i in range(n):
        a = scored_rows[i]
        b = expected_rows[i]
        row_ok = True
        if a.get("page_number") != b.get("page_number") or a.get("visual_row_index") != b.get(
            "visual_row_index"
        ):
            order_ok = False
            row_ok = False
            field_miss["row_order"] += 1
        for k in COMPARE_FIELDS:
            if a.get(k) != b.get(k):
                row_ok = False
                field_miss[k] += 1
                if len(score.first_diffs) < 8:
                    score.first_diffs.append(
                        {
                            "index": i,
                            "field": k,
                            "actual": a.get(k),
                            "expected": b.get(k),
                            "page_number": b.get("page_number"),
                            "visual_row_index": b.get("visual_row_index"),
                            "player_name_raw_expected": b.get("player_name_raw"),
                        }
                    )
                # diagnostic extras
                if k == "player_name_raw":
                    cats.append("PLAYER_NAME")
                    ea = str(b.get("player_name_raw") or "")
                    aa = str(a.get("player_name_raw") or "")
                    if any(s in ea for s in (" Jr.", " III", " II", " IV", " Sr.")) and (
                        any(s in ea for s in (" Jr.", " III", " II", " IV", " Sr."))
                        and not any(s in aa for s in (" Jr.", " III", " II", " IV", " Sr."))
                    ):
                        cats.append("SUFFIX")
                if k == "reason_raw":
                    cats.append("REASON")
                    cats.append("WRAPPED_TEXT")
                if k in ("game_date", "game_time_et", "matchup", "team_name"):
                    cats.append("FORWARD_FILL")
                    if a.get("page_number") != b.get("page_number"):
                        cats.append("PAGE_BOUNDARY")
                if k == "row_kind":
                    cats.append("ROW_KIND")
        if row_ok:
            exact += 1

    score.exact_rows = exact
    score.missing_rows = max(0, len(expected_rows) - len(scored_rows))
    score.extra_rows = max(0, len(scored_rows) - len(expected_rows))
    if score.missing_rows:
        cats.append("MISSING_ROW")
        order_ok = False
    if score.extra_rows:
        cats.append("EXTRA_ROW")
        order_ok = False
    if not order_ok or field_miss.get("row_order", 0):
        cats.append("ROW_ORDER")
    score.row_order_ok = (
        order_ok and score.missing_rows == 0 and score.extra_rows == 0 and exact == len(expected_rows)
    )
    score.field_mismatches = dict(field_miss)

    # NYS coercion
    class R:
        def __init__(self, d):
            self.__dict__.update(d)

    if detect_nys_coercion([R(r) for r in scored_rows], expected_rows):
        # only flag if there is an actual NYS mismatch
        exp_nys = sum(1 for b in expected_rows if b.get("row_kind") == "team_not_yet_submitted")
        act_nys = sum(1 for a in scored_rows if a.get("row_kind") == "team_not_yet_submitted")
        if exp_nys != act_nys or field_miss.get("row_kind", 0):
            cats.append("NYS_COERCION")

    # Forward-fill leakage counters from field mismatches
    score.forward_fill_notes = {
        "game_date_mismatches": field_miss.get("game_date", 0),
        "game_time_mismatches": field_miss.get("game_time_et", 0),
        "matchup_mismatches": field_miss.get("matchup", 0),
        "team_mismatches": field_miss.get("team_name", 0),
    }

    for k, v in field_miss.items():
        if v and k != "row_order":
            cats.append(classify_field(k))

    # Deduplicate categories while preserving order
    seen = set()
    uniq = []
    for cname in cats:
        if cname not in seen:
            seen.add(cname)
            uniq.append(cname)
    score.categories = uniq

    identity_ok = (
        score.title_ok
        and score.timestamp_ok
        and score.timezone_ok
        and score.page_count_ok
        and score.row_order_ok
        and score.missing_rows == 0
        and score.extra_rows == 0
        and score.duplicate_rows == 0
        and exact == len(expected_rows)
        and all(field_miss.get(k, 0) == 0 for k in COMPARE_FIELDS)
        and not score.ambiguous_warnings
        and field_miss.get("row_order", 0) == 0
    )
    score.ok = identity_ok
    return score


def refuse_overwrite(path: Path) -> None:
    if path.exists():
        raise RuntimeError(
            f"REFUSING to overwrite permanent first-run artifact: {path}. "
            "Phase 3C first-run evidence is immutable."
        )


def write_first_run_md(summary: dict[str, Any], path: Path) -> None:
    lines = [
        "# Official injury-report parser — held-out FIRST RUN (Phase 3C)",
        "",
        f"Generated: **{summary['executed_at']}**",
        "",
        "**IMMUTABLE FIRST-RUN EVIDENCE — DO NOT OVERWRITE**",
        "",
        f"**PARSER_CERTIFIED (this run) = {summary['PARSER_CERTIFIED']}**",
        "",
        f"PARSER_DEVELOPMENT_GATE = {summary['PARSER_DEVELOPMENT_GATE']}",
        "AS_OF_INJURY_TAPE_CERTIFIED = NO",
        "",
        "## Implementation fingerprint",
        "",
        f"- Git commit: `{summary['fingerprint']['git']['commit']}`",
        f"- Branch: `{summary['fingerprint']['git']['branch']}`",
        f"- Python: `{summary['fingerprint']['python_version'].split()[0]}`",
        f"- pypdf: `{summary['fingerprint']['pypdf_version']}`",
        f"- Platform: `{summary['fingerprint']['platform']}`",
        "",
        "### File hashes",
        "",
    ]
    for rel, meta in summary["fingerprint"]["files"].items():
        lines.append(f"- `{rel}`: `{meta['sha256']}` ({meta['bytes']} bytes)")

    lines.extend(
        [
            "",
            "## Gold integrity",
            "",
            f"- Fixtures: {summary['gold_integrity']['fixture_count']} "
            f"(dev {summary['gold_integrity']['development']} / held-out {summary['gold_integrity']['held_out']})",
            f"- expected merkle: `{summary['gold_integrity']['expected_merkle_sha256']}`",
            f"- _rows merkle: `{summary['gold_integrity']['rows_merkle_sha256']}`",
            f"- _emit_expected.py: `{summary['gold_integrity']['emit_expected_sha256']}`",
            "",
            "## Held-out PDF checksums",
            "",
            "| Fixture | SHA-256 | Bytes |",
            "| --- | --- | ---: |",
        ]
    )
    for p in summary["held_out_pdfs"]:
        lines.append(f"| {p['fixture_id']} | `{p['sha256']}` | {p['bytes']} |")

    lines.extend(
        [
            "",
            "## Results",
            "",
            f"- Held-out attempted: **{summary['held_out_attempted']}**",
            f"- Held-out exact: **{summary['held_out_exact']}** / 7",
            f"- Full-PDF: **{summary['full_pdf_passed']}** / {summary['full_pdf_attempted']}",
            f"- Targeted: **{summary['targeted_passed']}** / {summary['targeted_attempted']}",
            f"- Locked rows evaluated: **{summary['locked_rows_evaluated']}**",
            f"- Locked row fields evaluated: **{summary['locked_row_fields_evaluated']}**",
            f"- Exact rows: **{summary['exact_rows']}**",
            f"- Exact field cells: **{summary['exact_field_cells']}**",
            f"- Missing rows: **{summary['missing_rows_total']}**",
            f"- Extra rows: **{summary['extra_rows_total']}**",
            f"- Order failures: **{summary['order_failures']}** {summary['order_failure_ids']}",
            f"- Title failures: **{summary['title_failures']}** {summary['title_failure_ids']}",
            f"- Timestamp failures: **{summary['timestamp_failures']}** {summary['timestamp_failure_ids']}",
            f"- Forward-fill failures: **{summary['forward_fill_failures']}** {summary['forward_fill_failure_ids']}",
            f"- NYS failures: **{summary['nys_failures']}** {summary['nys_failure_ids']}",
            f"- Name/suffix failures: **{summary['name_suffix_failures']}** {summary['name_suffix_failure_ids']}",
            f"- Wrapped-reason failures: **{summary['wrapped_reason_failures']}** {summary['wrapped_reason_failure_ids']}",
            f"- Page-boundary failures: **{summary['page_boundary_failures']}** {summary['page_boundary_failure_ids']}",
            f"- Warnings total: **{summary['warnings_total']}**",
            f"- Ambiguous warnings: **{summary['ambiguous_warnings_total']}**",
            "",
            "## Per-fixture",
            "",
            "| Fixture | Scope | Pass | Exact rows | Missing | Extra | Categories | Error |",
            "| --- | --- | --- | ---: | ---: | ---: | --- | --- |",
        ]
    )
    for f in summary["fixtures"]:
        lines.append(
            f"| {f['fixture_id']} | {f['labeling_scope']} | {'YES' if f['ok'] else 'NO'} | "
            f"{f['exact_rows']}/{f['row_count_expected']} | {f['missing_rows']} | {f['extra_rows']} | "
            f"{','.join(f.get('categories') or [])} | {f.get('error') or ''} |"
        )

    lines.extend(
        [
            "",
            f"## NEXT",
            "",
            f"**{summary['NEXT']}**",
            "",
            "AS_OF_INJURY_TAPE_CERTIFIED remains NO.",
            "",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def aggregate(scores: list[FixtureScore], fingerprint, gold, pdfs, executed_at: str) -> dict[str, Any]:
    held_exact = sum(1 for s in scores if s.ok)
    certified = held_exact == 7 and len(scores) == 7
    full = [s for s in scores if s.labeling_scope == "full_pdf"]
    targeted = [s for s in scores if s.labeling_scope == "targeted_pages"]

    locked_rows = sum(s.row_count_expected for s in scores)
    locked_fields = locked_rows * len(COMPARE_FIELDS)
    exact_rows = sum(s.exact_rows for s in scores)
    # exact field cells: for each fixture, expected*8 - sum mismatches (approx for aligned)
    exact_field_cells = 0
    for s in scores:
        mism = sum(s.field_mismatches.get(k, 0) for k in COMPARE_FIELDS)
        # only count aligned portion
        aligned = min(s.row_count_expected, s.row_count_scored)
        exact_field_cells += aligned * len(COMPARE_FIELDS) - mism

    def ids_with(pred) -> list[str]:
        return [s.fixture_id for s in scores if pred(s)]

    title_fail_ids = ids_with(lambda s: not s.title_ok)
    ts_fail_ids = ids_with(lambda s: not s.timestamp_ok)
    order_fail_ids = ids_with(lambda s: not s.row_order_ok)
    ff_fail_ids = ids_with(
        lambda s: any(
            s.forward_fill_notes.get(k, 0) > 0
            for k in (
                "game_date_mismatches",
                "game_time_mismatches",
                "matchup_mismatches",
                "team_mismatches",
            )
        )
    )
    nys_fail_ids = ids_with(lambda s: "NYS_COERCION" in s.categories)
    name_fail_ids = ids_with(
        lambda s: s.field_mismatches.get("player_name_raw", 0) > 0 or "SUFFIX" in s.categories
    )
    reason_fail_ids = ids_with(lambda s: s.field_mismatches.get("reason_raw", 0) > 0)
    page_bound_ids = ids_with(lambda s: "PAGE_BOUNDARY" in s.categories)

    return {
        "executed_at": executed_at,
        "phase": "3C",
        "blind_first_run": True,
        "PARSER_DEVELOPMENT_GATE": "PASS",
        "PARSER_CERTIFIED": "YES" if certified else "NO",
        "AS_OF_INJURY_TAPE_CERTIFIED": "NO",
        "NEXT": (
            "PROCEED_TO_ARCHIVE_WIDE_DRY_PARSE"
            if certified
            else "REOPEN_PARSER_DEVELOPMENT"
        ),
        "fingerprint": fingerprint,
        "gold_integrity": gold,
        "held_out_pdfs": pdfs,
        "held_out_attempted": len(scores),
        "held_out_exact": held_exact,
        "full_pdf_attempted": len(full),
        "full_pdf_passed": sum(1 for s in full if s.ok),
        "targeted_attempted": len(targeted),
        "targeted_passed": sum(1 for s in targeted if s.ok),
        "locked_rows_evaluated": locked_rows,
        "locked_row_fields_evaluated": locked_fields,
        "exact_rows": exact_rows,
        "exact_field_cells": exact_field_cells,
        "missing_rows_total": sum(s.missing_rows for s in scores),
        "extra_rows_total": sum(s.extra_rows for s in scores),
        "order_failures": len(order_fail_ids),
        "order_failure_ids": order_fail_ids,
        "title_failures": len(title_fail_ids),
        "title_failure_ids": title_fail_ids,
        "timestamp_failures": len(ts_fail_ids),
        "timestamp_failure_ids": ts_fail_ids,
        "forward_fill_failures": len(ff_fail_ids),
        "forward_fill_failure_ids": ff_fail_ids,
        "nys_failures": len(nys_fail_ids),
        "nys_failure_ids": nys_fail_ids,
        "name_suffix_failures": len(name_fail_ids),
        "name_suffix_failure_ids": name_fail_ids,
        "wrapped_reason_failures": len(reason_fail_ids),
        "wrapped_reason_failure_ids": reason_fail_ids,
        "page_boundary_failures": len(page_bound_ids),
        "page_boundary_failure_ids": page_bound_ids,
        "warnings_total": sum(len(s.warnings) for s in scores),
        "ambiguous_warnings_total": sum(len(s.ambiguous_warnings) for s in scores),
        "possible_gold_error": False,
        "parser_modified_during_certification": False,
        "fixtures": [asdict(s) for s in scores],
    }


def main() -> int:
    refuse_overwrite(FIRST_RUN_JSON)
    refuse_overwrite(FIRST_RUN_MD)

    cert_runner = Path(__file__).resolve()
    # 1) Fingerprint BEFORE loading held-out expected content for scoring.
    #    (Gold integrity may open expected files only to verify split labels.)
    fingerprint = build_fingerprint(cert_runner)
    parser_sha_before = fingerprint["files"][
        "lib/providers/nba_official_injuries/parser.py"
    ]["sha256"]

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    gold = verify_gold_integrity(manifest)
    held = [f for f in manifest["fixtures"] if f["split"] == "held_out"]
    if len(held) != 7:
        raise RuntimeError("expected 7 held-out fixtures")
    pdfs = verify_held_out_pdfs(held)

    RAW_OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 2) ONE blind parse pass — capture raw output BEFORE comparison.
    raw_by_id: dict[str, dict[str, Any] | None] = {}
    err_by_id: dict[str, str | None] = {}
    sha_by_id: dict[str, str | None] = {}

    for fx in held:
        fid = fx["fixture_id"]
        pdf_path = PDF_DIR / Path(fx["s3_key"]).name
        data = pdf_path.read_bytes()
        try:
            # Parser receives only PDF bytes + minimal provenance (no expected).
            result = parse_official_injury_report(
                data,
                Provenance(
                    source_filename=pdf_path.name,
                    sha256=fx["sha256"],
                ),
            )
            raw = result.to_dict()
            raw_bytes = json.dumps(raw, sort_keys=True, separators=(",", ":")).encode("utf-8")
            raw_sha = sha256_bytes(raw_bytes)
            out_path = RAW_OUT_DIR / f"{fid}.json"
            refuse_overwrite(out_path)
            out_path.write_bytes(raw_bytes)
            raw_by_id[fid] = raw
            err_by_id[fid] = None
            sha_by_id[fid] = raw_sha
        except OfficialInjuryParseError as exc:
            raw_by_id[fid] = None
            err_by_id[fid] = f"{exc.code}: {exc.message}"
            sha_by_id[fid] = None
            fail_path = RAW_OUT_DIR / f"{fid}.error.json"
            refuse_overwrite(fail_path)
            fail_path.write_text(
                json.dumps({"error": err_by_id[fid], "details": getattr(exc, "details", {})}, indent=2)
                + "\n",
                encoding="utf-8",
            )
        except Exception as exc:  # noqa: BLE001
            raw_by_id[fid] = None
            err_by_id[fid] = f"RUNNER_ERROR: {exc}"
            sha_by_id[fid] = None

    # 3) Compare against locked held-out expectations (scoring layer only).
    scores = [
        score_fixture(fx, raw_by_id[fx["fixture_id"]], err_by_id[fx["fixture_id"]], sha_by_id[fx["fixture_id"]])
        for fx in held
    ]

    # 4) Confirm parser bytes unchanged during run.
    parser_sha_after = sha256_file(PARSER_FILES[0])
    if parser_sha_after != parser_sha_before:
        raise RuntimeError("HARD STOP: parser.py changed during certification")

    executed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    summary = aggregate(scores, fingerprint, gold, pdfs, executed_at)
    summary["parser_sha256_before"] = parser_sha_before
    summary["parser_sha256_after"] = parser_sha_after
    summary["raw_output_dir"] = str(RAW_OUT_DIR.relative_to(ROOT)).replace("\\", "/")

    refuse_overwrite(FIRST_RUN_JSON)
    refuse_overwrite(FIRST_RUN_MD)
    FIRST_RUN_JSON.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    write_first_run_md(summary, FIRST_RUN_MD)

    # Certification report summarizes first-run (may be rewritten later; first-run is permanent).
    CERT_JSON.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    # MD for cert mirrors first-run with certification header
    cert_lines = FIRST_RUN_MD.read_text(encoding="utf-8").replace(
        "held-out FIRST RUN (Phase 3C)",
        "parser CERTIFICATION (Phase 3C)",
    ).replace(
        "IMMUTABLE FIRST-RUN EVIDENCE — DO NOT OVERWRITE",
        "Certification summary derived from immutable first-run evidence",
    )
    CERT_MD.write_text(cert_lines, encoding="utf-8")

    print(
        json.dumps(
            {
                "PARSER_CERTIFIED": summary["PARSER_CERTIFIED"],
                "held_out_exact": f"{summary['held_out_exact']}/7",
                "full": f"{summary['full_pdf_passed']}/{summary['full_pdf_attempted']}",
                "targeted": f"{summary['targeted_passed']}/{summary['targeted_attempted']}",
                "NEXT": summary["NEXT"],
                "first_run_json": str(FIRST_RUN_JSON),
                "first_run_md": str(FIRST_RUN_MD),
            },
            indent=2,
        )
    )
    return 0 if summary["PARSER_CERTIFIED"] == "YES" else 1


if __name__ == "__main__":
    raise SystemExit(main())
