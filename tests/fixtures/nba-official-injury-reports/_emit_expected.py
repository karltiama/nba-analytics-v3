"""
Hand-verified gold labels for official NBA injury-report PDFs.

This is NOT a production parser. Row text was drafted with a temporary
coordinate extract, then checked against rendered page PNGs (authority).

Run: python tests/fixtures/nba-official-injury-reports/_emit_expected.py

Writes:
  tests/fixtures/nba-official-injury-reports/expected/*.json
  tests/fixtures/nba-official-injury-reports/manifest.json
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

OUT = Path(__file__).resolve().parent
EXPECTED = OUT / "expected"
ROWS = OUT / "_rows"
META = OUT / "_fixture_meta.json"
MATERIALIZE = (
    OUT.parents[2]
    / "tmp"
    / "official-injury-report-gold-fixtures"
    / "materialize-log.json"
)

EXPECTED.mkdir(exist_ok=True)

VERIFIED_AT = "2026-09-17T06:15:00.000Z"
ET = ZoneInfo("America/New_York")


def pages_from(rows: list[dict]) -> list[dict]:
    by: dict[int, list] = {}
    for r in rows:
        by.setdefault(r["page_number"], []).append(r)
    return [{"page_number": p, "rows": by[p]} for p in sorted(by)]


def parse_title_published_at(title_raw: str) -> str:
    """Convert title 'Injury Report: M/D/YY HH:MM AM/PM' (ET) to ISO UTC."""
    m = re.search(
        r"Injury Report:\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([AP]M)",
        title_raw,
    )
    if not m:
        raise ValueError(f"unparseable title_raw: {title_raw!r}")
    mm, dd, yy, hh, mi, ap = m.groups()
    year = int(yy)
    if year < 100:
        year += 2000
    hour = int(hh) % 12
    if ap == "PM":
        hour += 12
    local = datetime(year, int(mm), int(dd), hour, int(mi), tzinfo=ET)
    return local.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def infer_from_token(report_date: str, token: str, filename_family: str) -> tuple[str, str]:
    """
    Filename-token inference (for delta only). Title remains authoritative.
    hourly HHAM/HHPM → +30 minutes on that clock hour.
    minute/quarter HH_MMAM/PM → exact minute.
    """
    m = re.fullmatch(r"(\d{2})(?:_(\d{2}))?(AM|PM)", token)
    if not m:
        raise ValueError(f"bad token {token}")
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
    iso = local.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return iso, method


def delta_minutes(title_iso: str, inferred_iso: str) -> int:
    t = datetime.fromisoformat(title_iso.replace("Z", "+00:00"))
    i = datetime.fromisoformat(inferred_iso.replace("Z", "+00:00"))
    return int((i - t).total_seconds() // 60)


def load_materialize() -> dict[tuple[str, str], dict]:
    raw = json.loads(MATERIALIZE.read_text(encoding="utf8"))
    out = {}
    for r in raw["results"]:
        if r.get("ok"):
            out[(r["report_date"], r["requested_token"])] = r
    return out


def emit_one(fx: dict, mat: dict[tuple[str, str], dict]) -> dict:
    row_doc = json.loads((ROWS / f"{fx['fixture_id']}.json").read_text(encoding="utf8"))
    mkey = (fx["report_date"], fx["token"])
    if mkey not in mat:
        raise KeyError(f"missing materialize entry for {mkey}")
    src = mat[mkey]
    title_raw = row_doc["title_raw"]
    published = parse_title_published_at(title_raw)
    inferred, method = infer_from_token(
        fx["report_date"], fx["token"], src["filename_family"]
    )
    selected = fx["pages"] if fx["pages"] is not None else list(
        range(1, row_doc["page_count"] + 1)
    )
    pages = pages_from(row_doc["rows"])
    obj = {
        "fixture_id": fx["fixture_id"],
        "split": fx["split"],
        "labeling_scope": fx["scope"],
        "source": {
            "s3_key": src["s3_key"],
            "sha256": src["sha256"],
            "filename": Path(src["local_path"]).name,
            "filename_family": src["filename_family"],
            "report_date": src["report_date"],
            "requested_token": src["requested_token"],
            "season": src["season"],
        },
        "report": {
            "title_raw": title_raw,
            "report_published_at": published,
            "timezone": "America/New_York",
            "page_count": row_doc["page_count"],
            "inferred_report_published_at": inferred,
            "inference_method": method,
            "inferred_vs_title_delta_minutes": delta_minutes(published, inferred),
        },
        "labeling_scope_pages": selected,
        "pages": pages,
        "adversarial_categories": fx["cats"],
        "verification": {
            "visually_verified": True,
            "verified_at": VERIFIED_AT,
            "notes": fx["notes"],
        },
    }
    path = EXPECTED / f"{fx['fixture_id']}.json"
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf8")
    n = sum(len(p["rows"]) for p in pages)
    print(f"wrote {path.name} rows={n} scope={fx['scope']} pages={selected}")
    return obj


def build_manifest(emitted: list[dict], fixtures: list[dict]) -> None:
    by_id = {f["fixture_id"]: f for f in fixtures}
    items = []
    for obj in emitted:
        fx = by_id[obj["fixture_id"]]
        items.append(
            {
                "fixture_id": obj["fixture_id"],
                "split": obj["split"],
                "labeling_scope": obj["labeling_scope"],
                "s3_key": obj["source"]["s3_key"],
                "sha256": obj["source"]["sha256"],
                "report_date": obj["source"]["report_date"],
                "requested_token": obj["source"]["requested_token"],
                "filename_family": obj["source"]["filename_family"],
                "title_raw": obj["report"]["title_raw"],
                "report_published_at": obj["report"]["report_published_at"],
                "page_count": obj["report"]["page_count"],
                "selected_pages": obj["labeling_scope_pages"],
                "adversarial_categories": obj["adversarial_categories"],
                "labeling_completed": True,
                "verification_completed": True,
                "notes": " ".join(fx["notes"]),
            }
        )
    man = {
        "generated_at": VERIFIED_AT,
        "fixture_count": len(items),
        "fixtures": items,
    }
    path = OUT / "manifest.json"
    path.write_text(json.dumps(man, indent=2) + "\n", encoding="utf8")
    print(f"wrote manifest.json fixtures={len(items)}")


def main() -> None:
    fixtures = json.loads(META.read_text(encoding="utf8"))
    mat = load_materialize()
    emitted = [emit_one(fx, mat) for fx in fixtures]
    build_manifest(emitted, fixtures)
    # summary
    dev = sum(1 for f in fixtures if f["split"] == "development")
    held = sum(1 for f in fixtures if f["split"] == "held_out")
    full = sum(1 for f in fixtures if f["scope"] == "full_pdf")
    targ = sum(1 for f in fixtures if f["scope"] == "targeted_pages")
    print(f"summary development={dev} held_out={held} full_pdf={full} targeted_pages={targ}")


if __name__ == "__main__":
    main()
