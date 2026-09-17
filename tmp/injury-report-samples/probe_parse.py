"""One-off characterization of official NBA injury-report PDFs. Not a production parser."""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from pypdf import PdfReader

STATUSES = {"Out", "Available", "Questionable", "Probable", "Doubtful"}
TEAM_HINTS = {
    "Hawks",
    "Celtics",
    "Nets",
    "Hornets",
    "Bulls",
    "Cavaliers",
    "Mavericks",
    "Nuggets",
    "Pistons",
    "Warriors",
    "Rockets",
    "Pacers",
    "Clippers",
    "Lakers",
    "Grizzlies",
    "Heat",
    "Bucks",
    "Timberwolves",
    "Pelicans",
    "Knicks",
    "Thunder",
    "Magic",
    "76ers",
    "Suns",
    "Blazers",
    "Kings",
    "Spurs",
    "Raptors",
    "Jazz",
    "Wizards",
}
REASON_HINTS = (
    "Injury/Illness",
    "G League",
    "Rest",
    "Not With Team",
    "Not with Team",
    "Personal Reasons",
    "League Suspension",
    "Concussion",
    "Trade",
    "NOT YET SUBMITTED",
)

DATE_RE = re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$")
TIME_RE = re.compile(r"^\d{1,2}:\d{2}\s*\([A-Za-z]{2,}\)$")
PAGE_RE = re.compile(r"^Page \d+ of \d+$")
MATCHUP_RE = re.compile(r"^[A-Z]{2,3}@[A-Z]{2,3}$")


def classify(line: str) -> str | None:
    s = line.strip()
    if not s or s.startswith("Injury Report:") or PAGE_RE.match(s):
        return None
    if s in {
        "Game Date",
        "Game Time",
        "Matchup",
        "Team",
        "Player Name",
        "Current Status",
        "Reason",
    }:
        return "header"
    if DATE_RE.match(s):
        return "game_date"
    if TIME_RE.match(s):
        return "game_time"
    if MATCHUP_RE.match(s):
        return "matchup"
    if s in STATUSES:
        return "status"
    if any(h in s for h in TEAM_HINTS) and "," not in s:
        return "team"
    if s.casefold() == "not yet submitted":
        return "not_yet_submitted"
    if any(h.lower() in s.lower() for h in REASON_HINTS):
        return "reason"
    if "," in s and not any(h in s for h in TEAM_HINTS):
        return "player_name"
    return "other"


def extract_lines(pdf_path: Path) -> list[str]:
    reader = PdfReader(str(pdf_path))
    lines: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        for raw in text.splitlines():
            line = " ".join(raw.split())
            if line:
                lines.append(line)
    return lines


def summarize(pdf_path: Path) -> dict:
    reader = PdfReader(str(pdf_path))
    lines = extract_lines(pdf_path)
    labels = [classify(x) for x in lines]
    counts = Counter(lab for lab in labels if lab)
    statuses = Counter(x.strip() for x, lab in zip(lines, labels) if lab == "status")
    reasons = [x.strip() for x, lab in zip(lines, labels) if lab == "reason"]
    players = [x.strip() for x, lab in zip(lines, labels) if lab == "player_name"]
    nys = sum(1 for lab in labels if lab == "not_yet_submitted")
    others = [x for x, lab in zip(lines, labels) if lab == "other"][:25]
    sample_players = players[:12]
    sample_reasons = reasons[:8]
    reason_prefixes = Counter()
    for r in reasons:
        prefix = r.split(" - ", 1)[0] if " - " in r else r.split(";", 1)[0]
        reason_prefixes[prefix[:80]] += 1
    return {
        "file": pdf_path.name,
        "bytes": pdf_path.stat().st_size,
        "pages": len(reader.pages),
        "line_count": len(lines),
        "label_counts": dict(counts),
        "status_counts": dict(statuses),
        "not_yet_submitted_lines": nys,
        "player_name_lines": len(players),
        "reason_lines": len(reasons),
        "reason_prefix_counts": dict(reason_prefixes.most_common(12)),
        "sample_players": sample_players,
        "sample_reasons": sample_reasons,
        "sample_other_lines": others,
        "first_25_lines": lines[:25],
        "has_player_id": any("player_id" in x.lower() or re.search(r"\bid\b", x.lower()) for x in lines[:40]),
        "has_available": statuses.get("Available", 0) > 0,
        "has_probable": statuses.get("Probable", 0) > 0,
        "has_doubtful": statuses.get("Doubtful", 0) > 0,
    }


def main() -> None:
    root = Path(__file__).resolve().parent
    files = sorted(root.glob("Injury-Report_*.pdf"))
    reports = [summarize(p) for p in files]
    out = {
        "source_host": "https://ak-static.cms.nba.com/referee/injury/",
        "url_pattern_hourly_through_2025_12_19": "Injury-Report_YYYY-MM-DD_HHAM|HHPM.pdf",
        "url_pattern_15min_from_2025_12_22": "Injury-Report_YYYY-MM-DD_HH_MMAM|HH_MMPM.pdf",
        "columns_on_pdf": [
            "Game Date",
            "Game Time",
            "Matchup",
            "Team",
            "Player Name",
            "Current Status",
            "Reason",
        ],
        "reports": reports,
    }
    dest = root / "characterization.json"
    dest.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps({r["file"]: {
        "pages": r["pages"],
        "statuses": r["status_counts"],
        "players": r["player_name_lines"],
        "nys": r["not_yet_submitted_lines"],
        "available": r["has_available"],
        "probable": r["has_probable"],
        "sample_players": r["sample_players"][:5],
        "sample_reasons": r["sample_reasons"][:3],
        "other": r["sample_other_lines"][:8],
    } for r in reports}, indent=2))
    print("wrote", dest)


if __name__ == "__main__":
    main()
