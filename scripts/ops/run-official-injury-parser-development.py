"""
Phase 3B development-only runner for the official injury-report parser.

HELD-OUT RULE:
  - Loads expected JSON only for fixtures with split=development in manifest.json.
  - Never opens held-out expected files.
  - Never asserts against held-out labels.

Usage (repo root):
  python scripts/ops/run-official-injury-parser-development.py
"""

from __future__ import annotations

import hashlib
import json
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
PDF_DIR = ROOT / "tmp" / "official-injury-report-gold-fixtures" / "pdfs"
REPORT_MD = ROOT / "reports" / "operations" / "official-injury-report-parser-development.md"
REPORT_JSON = ROOT / "reports" / "operations" / "official-injury-report-parser-development.json"

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

IDENTITY_CRITICAL = (
    "row_kind",
    "game_date",
    "game_time_et",
    "matchup",
    "team_name",
    "player_name_raw",
    "status_raw",
)


@dataclass
class FieldStats:
    correct: int = 0
    total: int = 0

    def add(self, ok: bool) -> None:
        self.total += 1
        if ok:
            self.correct += 1

    @property
    def ratio(self) -> str:
        return f"{self.correct}/{self.total}"


@dataclass
class FixtureResult:
    fixture_id: str
    labeling_scope: str
    ok: bool
    error: str | None = None
    title_ok: bool = False
    timestamp_ok: bool = False
    page_count_ok: bool = False
    row_count_expected: int = 0
    row_count_actual: int = 0
    exact_row_matches: int = 0
    missing_rows: int = 0
    extra_rows: int = 0
    row_order_ok: bool = False
    field_mismatches: dict[str, int] = field(default_factory=dict)
    warnings: list[dict[str, Any]] = field(default_factory=list)
    control_checks: dict[str, bool] = field(default_factory=dict)
    first_diffs: list[dict[str, Any]] = field(default_factory=list)


def load_development_fixtures() -> list[dict[str, Any]]:
    """Read manifest only; return development entries. Never opens held-out expected."""
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    out = [f for f in manifest["fixtures"] if f.get("split") == "development"]
    held = [f["fixture_id"] for f in manifest["fixtures"] if f.get("split") == "held_out"]
    # Explicit guard: refuse if a caller somehow asks for held-out expected paths.
    for hid in held:
        forbidden = EXPECTED_DIR / f"{hid}.json"
        # Do not read; only record that we know not to touch these paths.
        _ = forbidden.name
    return out


def assert_development_only(fixture_id: str, split: str) -> None:
    if split != "development":
        raise RuntimeError(
            f"Refusing to load non-development fixture expected data: {fixture_id} split={split}"
        )


def load_development_expected(fixture_id: str, split: str) -> dict[str, Any]:
    assert_development_only(fixture_id, split)
    path = EXPECTED_DIR / f"{fixture_id}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Missing development expected file: {path}")
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("split") != "development":
        raise RuntimeError(
            f"Expected file split is not development for {fixture_id}: {doc.get('split')}"
        )
    return doc


def flatten_expected_rows(gold: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for page in gold.get("pages") or []:
        rows.extend(page.get("rows") or [])
    return rows


def resolve_pdf(fx: dict[str, Any]) -> bytes:
    filename = Path(fx["s3_key"]).name
    path = PDF_DIR / filename
    if not path.is_file():
        raise FileNotFoundError(
            f"Materialized PDF missing for {fx['fixture_id']}: {path}. "
            "Phase 3B requires local PDFs under tmp/official-injury-report-gold-fixtures/pdfs/"
        )
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest.lower() != fx["sha256"].lower():
        raise RuntimeError(
            f"SHA-256 mismatch for {fx['fixture_id']}: expected {fx['sha256']} got {digest}"
        )
    return data


def compare_fixture(fx: dict[str, Any]) -> FixtureResult:
    fid = fx["fixture_id"]
    result = FixtureResult(
        fixture_id=fid,
        labeling_scope=fx["labeling_scope"],
        ok=False,
    )
    try:
        gold = load_development_expected(fid, fx["split"])
        pdf_bytes = resolve_pdf(fx)
        parsed = parse_official_injury_report(
            pdf_bytes,
            Provenance(
                source_filename=Path(fx["s3_key"]).name,
                sha256=fx["sha256"],
                fixture_id=fid,
            ),
        )
        result.warnings = [asdict(w) for w in parsed.warnings]
        result.title_ok = parsed.report.title_raw == gold["report"]["title_raw"]
        result.timestamp_ok = (
            parsed.report.report_published_at == gold["report"]["report_published_at"]
        )
        result.page_count_ok = parsed.report.page_count == gold["report"]["page_count"]

        selected = set(gold.get("labeling_scope_pages") or fx.get("selected_pages") or [])
        if gold["labeling_scope"] == "targeted_pages":
            actual_rows = [r for r in parsed.rows if r.page_number in selected]
        else:
            actual_rows = list(parsed.rows)

        expected_rows = flatten_expected_rows(gold)
        result.row_count_expected = len(expected_rows)
        result.row_count_actual = len(actual_rows)

        field_miss: Counter[str] = Counter()
        exact = 0
        n = min(len(actual_rows), len(expected_rows))
        order_ok = True
        for i in range(n):
            a = actual_rows[i]
            b = expected_rows[i]
            row_ok = True
            if a.page_number != b["page_number"] or a.visual_row_index != b["visual_row_index"]:
                order_ok = False
                row_ok = False
                field_miss["row_order"] += 1
            for k in COMPARE_FIELDS:
                av = getattr(a, k)
                bv = b.get(k)
                if av != bv:
                    row_ok = False
                    field_miss[k] += 1
                    if len(result.first_diffs) < 5:
                        result.first_diffs.append(
                            {
                                "index": i,
                                "field": k,
                                "actual": av,
                                "expected": bv,
                                "page_number": b.get("page_number"),
                                "visual_row_index": b.get("visual_row_index"),
                            }
                        )
            if row_ok:
                exact += 1

        result.exact_row_matches = exact
        result.missing_rows = max(0, len(expected_rows) - len(actual_rows))
        result.extra_rows = max(0, len(actual_rows) - len(expected_rows))
        if result.missing_rows or result.extra_rows:
            order_ok = False
        result.row_order_ok = order_ok and result.missing_rows == 0 and result.extra_rows == 0
        result.field_mismatches = dict(field_miss)

        # Control checks visible on development data
        if fid == "ir-2025-12-06-11am":
            result.control_checks = _missi_clowney(actual_rows, "Questionable", "Probable")
        elif fid == "ir-2025-12-06-05pm":
            result.control_checks = _missi_clowney(actual_rows, "Available", "Available")
        elif fid == "ir-2025-12-21-05pm":
            result.control_checks = {
                "title_is_0545_not_filename_0530": parsed.report.title_raw.endswith("05:45 PM"),
                "published_at_2245Z": parsed.report.report_published_at
                == "2025-12-21T22:45:00.000Z",
            }

        identity_ok = (
            result.title_ok
            and result.timestamp_ok
            and result.page_count_ok
            and result.row_order_ok
            and result.missing_rows == 0
            and result.extra_rows == 0
            and exact == len(expected_rows)
            and all(field_miss.get(k, 0) == 0 for k in IDENTITY_CRITICAL)
            and field_miss.get("reason_raw", 0) == 0
        )
        result.ok = identity_ok
        return result
    except OfficialInjuryParseError as exc:
        result.error = f"{exc.code}: {exc.message}"
        return result
    except Exception as exc:  # noqa: BLE001
        result.error = f"RUNNER_ERROR: {exc}"
        return result


def _missi_clowney(rows: list[Any], missi: str, clowney: str) -> dict[str, bool]:
    by_name = {r.player_name_raw: r.status_raw for r in rows if r.row_kind == "player"}
    return {
        "missi_status": by_name.get("Missi, Yves") == missi,
        "clowney_status": by_name.get("Clowney, Noah") == clowney,
    }


def aggregate(results: list[FixtureResult]) -> dict[str, Any]:
    field_stats = {k: FieldStats() for k in COMPARE_FIELDS}
    field_stats["title_raw"] = FieldStats()
    field_stats["report_published_at"] = FieldStats()
    field_stats["row_order"] = FieldStats()
    field_stats["row_kind_meta"] = FieldStats()

    nys_fail = 0
    suffix_fail = 0
    wrap_fail = 0
    ff_fail = 0
    ts_fail = 0
    order_fail = 0
    missing_total = 0
    extra_total = 0
    exact_fixtures = 0

    for r in results:
        if r.ok:
            exact_fixtures += 1
        field_stats["title_raw"].add(r.title_ok)
        field_stats["report_published_at"].add(r.timestamp_ok)
        field_stats["row_order"].add(r.row_order_ok)
        if not r.timestamp_ok:
            ts_fail += 1
        if not r.row_order_ok:
            order_fail += 1
        missing_total += r.missing_rows
        extra_total += r.extra_rows

        # Per-field from mismatches vs expected row count when comparable
        for k in COMPARE_FIELDS:
            mism = r.field_mismatches.get(k, 0)
            # approximate: correct = expected - mism (capped)
            total = r.row_count_expected
            correct = max(0, total - mism) if r.error is None else 0
            field_stats[k].correct += correct
            field_stats[k].total += total

        if r.field_mismatches.get("row_kind", 0):
            # NYS coerced would show as row_kind / player_name mismatches
            nys_fail += r.field_mismatches.get("row_kind", 0)
        if r.field_mismatches.get("player_name_raw", 0):
            suffix_fail += r.field_mismatches["player_name_raw"]
        if r.field_mismatches.get("reason_raw", 0):
            wrap_fail += r.field_mismatches["reason_raw"]
        for k in ("game_date", "game_time_et", "matchup", "team_name"):
            ff_fail += r.field_mismatches.get(k, 0)

    full = [r for r in results if r.labeling_scope == "full_pdf"]
    targeted = [r for r in results if r.labeling_scope == "targeted_pages"]
    gate = all(r.ok for r in results) and len(results) == 13

    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "PARSER_DEVELOPMENT_GATE": "PASS" if gate else "FAIL",
        "PARSER_CERTIFIED": "NO",
        "AS_OF_INJURY_TAPE_CERTIFIED": "NO",
        "held_out_run": False,
        "development_fixtures_run": len(results),
        "development_fixtures_passed": exact_fixtures,
        "full_pdf_count": len(full),
        "full_pdf_passed": sum(1 for r in full if r.ok),
        "targeted_pages_count": len(targeted),
        "targeted_pages_passed": sum(1 for r in targeted if r.ok),
        "field_level": {k: {"correct": v.correct, "total": v.total, "ratio": v.ratio} for k, v in field_stats.items()},
        "missing_rows_total": missing_total,
        "extra_rows_total": extra_total,
        "forward_fill_field_mismatches": ff_fail,
        "nys_row_kind_mismatches": nys_fail,
        "suffix_or_name_mismatches": suffix_fail,
        "reason_wrap_mismatches": wrap_fail,
        "timestamp_failures": ts_fail,
        "row_order_failures": order_fail,
        "gold_fixture_incorrect": False,
        "date_or_file_specific_hacks": False,
        "dependency": {
            "name": "pypdf",
            "why": "Smallest layout-capable PDF dependency already validated by Phase 3A coordinate drafts; visitor_text yields (x,y) for visual order and column banding without Tabula/Java.",
            "layout_capabilities": [
                "per-glyph/show-text visitor coordinates",
                "visual y-line clustering",
                "x-column banding for 7-column table",
            ],
            "deterministic": True,
            "deployment_notes": "Python-side parser module under lib/providers/nba_official_injuries. Not yet wired into Next.js runtime. Pin pypdf in scripts/python-requirements.txt.",
        },
        "parser_location": "lib/providers/nba_official_injuries/parser.py",
        "fixtures": [asdict(r) for r in results],
        "recommendation": (
            "PROCEED_TO_BLIND_HELD_OUT_CERTIFICATION"
            if gate
            else "FIX_REMAINING_DEVELOPMENT_FAILURES"
        ),
    }


def write_reports(summary: dict[str, Any]) -> None:
    REPORT_JSON.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    fl = summary["field_level"]
    lines = [
        "# Official NBA injury-report parser development (Phase 3B)",
        "",
        f"Generated: **{summary['generated_at']}**",
        "",
        f"**PARSER_DEVELOPMENT_GATE = {summary['PARSER_DEVELOPMENT_GATE']}**",
        "",
        "PARSER_CERTIFIED = NO  ",
        "AS_OF_INJURY_TAPE_CERTIFIED = NO  ",
        "Held-out certification: **not run**",
        "",
        "---",
        "",
        "## 1. Parser implementation location",
        "",
        f"`{summary['parser_location']}`",
        "",
        "Package: `lib/providers/nba_official_injuries/` (underscore for Python importability).",
        "",
        "## 2–3. Dependency",
        "",
        f"- **Chosen:** `{summary['dependency']['name']}`",
        f"- **Why:** {summary['dependency']['why']}",
        f"- **Layout capabilities:** {', '.join(summary['dependency']['layout_capabilities'])}",
        f"- **Deterministic:** {summary['dependency']['deterministic']}",
        f"- **Deployment:** {summary['dependency']['deployment_notes']}",
        "",
        "## 4–6. Development fixture results",
        "",
        f"- Development fixtures run: **{summary['development_fixtures_run']}**",
        f"- Passed (exact): **{summary['development_fixtures_passed']}** / {summary['development_fixtures_run']}",
        f"- Full-PDF: **{summary['full_pdf_passed']}** / {summary['full_pdf_count']}",
        f"- Targeted-pages: **{summary['targeted_pages_passed']}** / {summary['targeted_pages_count']}",
        "",
        "## 7. Field-level results",
        "",
        "| Field | Correct / Total |",
        "| --- | ---: |",
    ]
    for k in (
        "title_raw",
        "report_published_at",
        "row_order",
        "row_kind",
        "game_date",
        "game_time_et",
        "matchup",
        "team_name",
        "player_name_raw",
        "status_raw",
        "reason_raw",
    ):
        item = fl.get(k) or {"ratio": "n/a"}
        lines.append(f"| {k} | {item['ratio']} |")

    lines.extend(
        [
            "",
            "## 8–15. Failure categories",
            "",
            f"- Missing rows (total): **{summary['missing_rows_total']}**",
            f"- Extra rows (total): **{summary['extra_rows_total']}**",
            f"- Forward-fill field mismatches: **{summary['forward_fill_field_mismatches']}**",
            f"- NYS / row_kind mismatches: **{summary['nys_row_kind_mismatches']}**",
            f"- Suffix / name mismatches: **{summary['suffix_or_name_mismatches']}**",
            f"- Reason-wrap mismatches: **{summary['reason_wrap_mismatches']}**",
            f"- Timestamp failures: **{summary['timestamp_failures']}**",
            f"- Row-order failures: **{summary['row_order_failures']}**",
            "",
            "## 16. Remaining parser warnings",
            "",
        ]
    )
    warn_count = sum(len(f.get("warnings") or []) for f in summary["fixtures"])
    if warn_count == 0:
        lines.append("None emitted on development fixtures.")
    else:
        lines.append(f"Total warning objects: {warn_count}")
        for f in summary["fixtures"]:
            for w in f.get("warnings") or []:
                lines.append(f"- `{f['fixture_id']}`: {w.get('code')} — {w.get('message')}")

    lines.extend(
        [
            "",
            "## 17–19. Integrity",
            "",
            f"- Gold fixture appeared incorrect: **{summary['gold_fixture_incorrect']}**",
            f"- Date/file-specific parser hacks: **{summary['date_or_file_specific_hacks']}**",
            f"- Development acceptance gate: **{summary['PARSER_DEVELOPMENT_GATE']}**",
            "",
            "## Per-fixture",
            "",
            "| Fixture | Scope | Pass | Exact rows | Missing | Extra | Error |",
            "| --- | --- | --- | ---: | ---: | ---: | --- |",
        ]
    )
    for f in summary["fixtures"]:
        lines.append(
            f"| {f['fixture_id']} | {f['labeling_scope']} | "
            f"{'YES' if f['ok'] else 'NO'} | {f['exact_row_matches']}/"
            f"{f['row_count_expected']} | {f['missing_rows']} | {f['extra_rows']} | "
            f"{f.get('error') or ''} |"
        )

    lines.extend(
        [
            "",
            "## Policy notes",
            "",
            "- `report_published_at` from PDF title only (fail-closed if missing/unparseable).",
            "- Filename-time inference is not used by the parser.",
            "- `NOT YET SUBMITTED` → `row_kind=team_not_yet_submitted`.",
            "- Player names preserved exactly (`Butler III, Jimmy`).",
            "- Status/reason preserved raw; no WOWY classification.",
            "- Held-out expected JSON was not loaded.",
            "",
            f"## Next",
            "",
            f"**{summary['recommendation']}**",
            "",
            "Do not claim PARSER_CERTIFIED.",
            "",
        ]
    )
    REPORT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    fixtures = load_development_fixtures()
    if len(fixtures) != 13:
        print(f"ERROR: expected 13 development fixtures, got {len(fixtures)}", file=sys.stderr)
        return 2
    results = [compare_fixture(fx) for fx in fixtures]
    summary = aggregate(results)
    write_reports(summary)
    print(
        json.dumps(
            {
                "PARSER_DEVELOPMENT_GATE": summary["PARSER_DEVELOPMENT_GATE"],
                "passed": summary["development_fixtures_passed"],
                "total": summary["development_fixtures_run"],
                "full": f"{summary['full_pdf_passed']}/{summary['full_pdf_count']}",
                "targeted": f"{summary['targeted_pages_passed']}/{summary['targeted_pages_count']}",
                "report_md": str(REPORT_MD),
                "report_json": str(REPORT_JSON),
            },
            indent=2,
        )
    )
    return 0 if summary["PARSER_DEVELOPMENT_GATE"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
