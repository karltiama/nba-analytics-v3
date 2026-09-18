"""
Development-only unit tests for the official injury-report parser.

Held-out expected JSON is never opened. Manifest is used only to select
split=development fixture IDs.
"""

from __future__ import annotations

import hashlib
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "lib" / "providers"))

from nba_official_injuries import (  # noqa: E402
    Provenance,
    parse_official_injury_report,
    parse_title_published_at,
)
from nba_official_injuries.errors import (  # noqa: E402
    InvalidPdfError,
    TitleTimestampUnparseableError,
)

MANIFEST = ROOT / "tests" / "fixtures" / "nba-official-injury-reports" / "manifest.json"
EXPECTED = ROOT / "tests" / "fixtures" / "nba-official-injury-reports" / "expected"
PDF_DIR = ROOT / "tmp" / "official-injury-report-gold-fixtures" / "pdfs"

# Explicit denylist — tests must not read these paths.
HELD_OUT_EXPECTED_PATHS: list[Path] = []


def _development_fixtures() -> list[dict]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    global HELD_OUT_EXPECTED_PATHS
    HELD_OUT_EXPECTED_PATHS = [
        EXPECTED / f"{f['fixture_id']}.json"
        for f in manifest["fixtures"]
        if f.get("split") == "held_out"
    ]
    return [f for f in manifest["fixtures"] if f.get("split") == "development"]


def _load_dev_expected(fixture_id: str) -> dict:
    path = EXPECTED / f"{fixture_id}.json"
    # Belt-and-suspenders: refuse held-out paths.
    if path in HELD_OUT_EXPECTED_PATHS or path.resolve() in {
        p.resolve() for p in HELD_OUT_EXPECTED_PATHS
    }:
        raise RuntimeError(f"Refusing held-out expected path: {path}")
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("split") != "development":
        raise RuntimeError(f"Not a development expected file: {fixture_id}")
    return doc


class TitleTimestampTests(unittest.TestCase):
    def test_title_not_filename_inference(self):
        # Dec 21: filename would imply 05:30; title is 05:45.
        iso = parse_title_published_at("Injury Report: 12/21/25 05:45 PM")
        self.assertEqual(iso, "2025-12-21T22:45:00.000Z")

    def test_title_fail_closed(self):
        with self.assertRaises(TitleTimestampUnparseableError):
            parse_title_published_at("Injury Report: not-a-timestamp")

    def test_invalid_pdf_fail_closed(self):
        with self.assertRaises(InvalidPdfError):
            parse_official_injury_report(b"not a pdf")


class DevelopmentGoldTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixtures = _development_fixtures()
        assert len(cls.fixtures) == 13

    def test_held_out_expected_not_loaded_by_this_module(self):
        # Ensure denylist is populated and none were read via _load_dev_expected.
        self.assertEqual(len(HELD_OUT_EXPECTED_PATHS), 7)
        for fx in self.fixtures:
            self.assertEqual(fx["split"], "development")

    def test_all_development_fixtures_exact(self):
        failures = []
        for fx in self.fixtures:
            gold = _load_dev_expected(fx["fixture_id"])
            pdf_path = PDF_DIR / Path(fx["s3_key"]).name
            data = pdf_path.read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), fx["sha256"])
            parsed = parse_official_injury_report(
                data,
                Provenance(
                    source_filename=pdf_path.name,
                    sha256=fx["sha256"],
                    fixture_id=fx["fixture_id"],
                ),
            )
            if parsed.report.title_raw != gold["report"]["title_raw"]:
                failures.append((fx["fixture_id"], "title_raw"))
                continue
            if parsed.report.report_published_at != gold["report"]["report_published_at"]:
                failures.append((fx["fixture_id"], "report_published_at"))
                continue
            if parsed.report.page_count != gold["report"]["page_count"]:
                failures.append((fx["fixture_id"], "page_count"))
                continue

            selected = set(gold.get("labeling_scope_pages") or [])
            if gold["labeling_scope"] == "targeted_pages":
                actual = [r for r in parsed.rows if r.page_number in selected]
            else:
                actual = list(parsed.rows)
            expected = [r for p in gold["pages"] for r in p["rows"]]
            if len(actual) != len(expected):
                failures.append(
                    (fx["fixture_id"], f"row_count {len(actual)}!={len(expected)}")
                )
                continue
            keys = (
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
            )
            for i, (a, b) in enumerate(zip(actual, expected)):
                for k in keys:
                    av = getattr(a, k)
                    bv = b.get(k)
                    if av != bv:
                        failures.append((fx["fixture_id"], f"row[{i}].{k}: {av!r}!={bv!r}"))
                        break
                else:
                    continue
                break
        self.assertEqual(failures, [], msg=json.dumps(failures[:20], indent=2))

    def test_missi_clowney_controls(self):
        for fid, missi, clowney in (
            ("ir-2025-12-06-11am", "Questionable", "Probable"),
            ("ir-2025-12-06-05pm", "Available", "Available"),
        ):
            fx = next(f for f in self.fixtures if f["fixture_id"] == fid)
            data = (PDF_DIR / Path(fx["s3_key"]).name).read_bytes()
            parsed = parse_official_injury_report(data)
            by = {
                r.player_name_raw: r.status_raw
                for r in parsed.rows
                if r.row_kind == "player"
            }
            self.assertEqual(by.get("Missi, Yves"), missi, fid)
            self.assertEqual(by.get("Clowney, Noah"), clowney, fid)


if __name__ == "__main__":
    unittest.main()
