"""
Phase 6B — lock pair-builder fixtures BEFORE implementation.

Expectations are taken from the approved Phase 6A dry pair-observation artifact
(golden). Held-out expectations are locked here and must not be loaded by the
development runner.

  python scripts/ops/lock-official-injury-wowy-pair-builder-fixtures.py
"""

from __future__ import annotations

import gzip
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
PAIRS_GZ = ROOT / "tmp" / "official-injury-wowy-pair-audit" / "pair-observations.ndjson.gz"
DESIGN_JSON = ROOT / "reports" / "operations" / "official-injury-wowy-pair-design-audit.json"
ELIG_WITHOUT = ROOT / "tmp" / "official-injury-report-t60-eligibility" / "without-candidates.ndjson.gz"
ELIG_WITH = ROOT / "tmp" / "official-injury-report-t60-eligibility" / "with-candidates.ndjson.gz"
ALL_RESULTS = ROOT / "tmp" / "official-injury-report-t60-eligibility" / "all-results.ndjson.gz"
SELECTED = ROOT / "tmp" / "official-injury-report-asof-t60" / "selected-player-states.ndjson.gz"
FIXTURE_ROOT = ROOT / "tests" / "fixtures" / "official-injury-wowy-pairs"

EXPECTED_PAIRS_SHA = "b7c390b9c869d69c768c2aa9feebc1730f727845679426de0e371e44d5502143"
PAIR_POLICY_VERSION = "injury-wowy-pair-policy-v1"


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def load_gz(p: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with gzip.open(p, "rt", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def obs_id(game_id: str, team_id: str, subject: str, focal: str) -> str:
    raw = f"{PAIR_POLICY_VERSION}|{game_id}|{team_id}|{subject}|{focal}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def cohort_flags(o: dict[str, Any]) -> dict[str, bool]:
    # Phase 6A exact semantics
    p1 = int(o["other_health_without_count"]) == 0
    p2 = int(o["other_eligible_with_count"]) == 0 and int(o["other_eligible_without_count"]) == 0
    p3 = int(o["other_health_without_count"]) == 0 and int(o["other_non_health_out_count"]) == 0
    return {"cohort_p0": True, "cohort_p1": p1, "cohort_p2": p2, "cohort_p3": p3}


def expected_from_obs(o: dict[str, Any]) -> dict[str, Any]:
    flags = cohort_flags(o)
    return {
        "pair_policy_version": PAIR_POLICY_VERSION,
        "observation_id": obs_id(
            str(o["game_id"]),
            str(o["team_id"]),
            str(o["subject_player_entity_id"]),
            str(o["focal_player_entity_id"]),
        ),
        "game_id": str(o["game_id"]),
        "team_id": str(o["team_id"]),
        "season": str(o["season"]),
        "subject_player_entity_id": str(o["subject_player_entity_id"]),
        "subject_serving_player_id": str(o["subject_serving_player_id"]),
        "focal_player_entity_id": str(o["focal_player_entity_id"]),
        "focal_serving_player_id": o.get("focal_serving_player_id"),
        "focal_state": o["focal_state"],
        "other_health_without_count": int(o["other_health_without_count"]),
        "other_health_with_count": int(o["other_health_with_count"]),
        "other_non_health_out_count": int(o["other_non_health_out_count"]),
        "other_nonbinary_health_count": int(o["other_nonbinary_health_count"]),
        "other_eligible_with_count": int(o["other_eligible_with_count"]),
        "other_eligible_without_count": int(o["other_eligible_without_count"]),
        **flags,
        "focal_realized_participation": o["focal_realized_participation_diagnostic"],
        "subject_metrics": {
            "minutes": o.get("subject_minutes"),
            "pts": o.get("subject_points"),
            "reb": o.get("subject_rebounds"),
            "ast": o.get("subject_assists"),
            "tpm": o.get("subject_tpm"),
            "fga": o.get("subject_fga"),
            "tpa": o.get("subject_tpa"),
            "fta": o.get("subject_fta"),
        },
        "t60_report_published_at": o.get("t60_report_published_at"),
        "emitted": True,
    }


def pick(rows: list[dict], pred, label: str, used: set[str]) -> dict:
    for r in rows:
        k = f"{r['game_id']}|{r['team_id']}|{r['subject_player_entity_id']}|{r['focal_player_entity_id']}"
        if k in used:
            continue
        if pred(r):
            used.add(k)
            return r
    raise SystemExit(f"no fixture for {label}")


def main() -> int:
    design = json.loads(DESIGN_JSON.read_text(encoding="utf-8"))
    pairs_sha = sha256_file(PAIRS_GZ)
    if pairs_sha != EXPECTED_PAIRS_SHA:
        # allow design report sha
        design_sha = design["artifacts"]["pair_observations"]["sha256"]
        if pairs_sha != design_sha:
            raise SystemExit(f"pair artifact SHA drift: {pairs_sha}")

    # verify upstream eligibility counts
    without = load_gz(ELIG_WITHOUT)
    with_rows = load_gz(ELIG_WITH)
    if len(without) != 19378 or len(with_rows) != 2466:
        raise SystemExit("eligibility candidate drift")

    print("Loading Phase 6A pair observations (golden)…")
    pairs = load_gz(PAIRS_GZ)
    if len(pairs) != 227132:
        raise SystemExit(f"pair count drift {len(pairs)}")

    used: set[str] = set()
    specs: list[tuple[str, str, str, Any]] = [
        ("dev-with-ordinary-01", "development", "with_ordinary", lambda r: r["focal_state"] == "PRE_GAME_AVAILABLE" and r["focal_realized_participation_diagnostic"] == "PLAYED" and r["other_health_without_count"] == 0),
        ("dev-without-ordinary-01", "development", "without_ordinary", lambda r: r["focal_state"] == "PRE_GAME_OUT" and r["focal_realized_participation_diagnostic"] == "DNP_00" and r["other_health_without_count"] == 0),
        ("dev-with-dnp-01", "development", "with_focal_dnp", lambda r: r["focal_state"] == "PRE_GAME_AVAILABLE" and r["focal_realized_participation_diagnostic"] == "DNP_00"),
        ("dev-without-dnp-01", "development", "without_focal_dnp", lambda r: r["focal_state"] == "PRE_GAME_OUT" and r["focal_realized_participation_diagnostic"] == "DNP_00" and r["other_health_without_count"] >= 1),
        ("dev-out-played-01", "development", "t60_out_but_played", lambda r: r["focal_state"] == "PRE_GAME_OUT" and r["focal_realized_participation_diagnostic"] == "PLAYED"),
        ("dev-no-pgl-01", "development", "focal_no_pgl", lambda r: r["focal_realized_participation_diagnostic"] == "NO_PGL_ROW"),
        ("dev-entity-only-01", "development", "entity_only_focal", lambda r: r.get("focal_serving_player_id") in (None, "") and r["focal_state"] == "PRE_GAME_OUT"),
        ("dev-multi-wo-01", "development", "two_plus_other_health_out", lambda r: r["other_health_without_count"] >= 2),
        ("dev-one-wo-01", "development", "one_other_health_out", lambda r: r["other_health_without_count"] == 1),
        ("dev-mixed-01", "development", "mixed_with_without", lambda r: r.get("mixed_focal_context") is True),
        ("dev-nonhealth-01", "development", "non_health_out_concurrency", lambda r: r["other_non_health_out_count"] >= 1 and r["other_health_without_count"] == 0),
        ("dev-nonbinary-01", "development", "nonbinary_health_concurrency", lambda r: r["other_nonbinary_health_count"] >= 2),
        ("dev-p1-eligible-01", "development", "p1_eligible", lambda r: r["other_health_without_count"] == 0),
        ("dev-p1-ineligible-01", "development", "p1_ineligible", lambda r: r["other_health_without_count"] >= 1),
        ("dev-p2-eligible-01", "development", "p2_eligible", lambda r: r["other_eligible_with_count"] == 0 and r["other_eligible_without_count"] == 0 and r["other_health_without_count"] == 0),
        ("dev-p2-ineligible-01", "development", "p2_ineligible", lambda r: r["other_eligible_without_count"] >= 1 or r["other_eligible_with_count"] >= 1),
        ("dev-p3-eligible-01", "development", "p3_eligible", lambda r: r["other_health_without_count"] == 0 and r["other_non_health_out_count"] == 0),
        ("dev-p3-ineligible-01", "development", "p3_ineligible", lambda r: r["other_health_without_count"] == 0 and r["other_non_health_out_count"] >= 1),
        ("dev-metrics-01", "development", "complete_metrics", lambda r: all(r.get(k) is not None for k in ("subject_minutes", "subject_points", "subject_rebounds", "subject_assists", "subject_tpm", "subject_fga", "subject_tpa", "subject_fta"))),
        ("dev-multi-focal-a-01", "development", "subject_multi_focal_a", lambda r: True),
        # held-out edges
        ("ho-with-played-01", "held_out", "with_played", lambda r: r["focal_state"] == "PRE_GAME_AVAILABLE" and r["focal_realized_participation_diagnostic"] == "PLAYED" and r["other_health_without_count"] >= 1),
        ("ho-without-p1-01", "held_out", "without_p1", lambda r: r["focal_state"] == "PRE_GAME_OUT" and r["other_health_without_count"] == 0 and r["other_non_health_out_count"] >= 1),
        ("ho-out-played-01", "held_out", "t60_out_but_played", lambda r: r["focal_state"] == "PRE_GAME_OUT" and r["focal_realized_participation_diagnostic"] == "PLAYED"),
        ("ho-with-dnp-01", "held_out", "with_dnp", lambda r: r["focal_state"] == "PRE_GAME_AVAILABLE" and r["focal_realized_participation_diagnostic"] == "DNP_00" and r["other_health_without_count"] == 0),
        ("ho-multi-wo-01", "held_out", "multi_health_out", lambda r: r["other_health_without_count"] >= 3),
        ("ho-mixed-01", "held_out", "mixed_context", lambda r: r.get("mixed_focal_context") is True and r["focal_state"] == "PRE_GAME_AVAILABLE"),
        ("ho-p2-01", "held_out", "p2_edge", lambda r: r["other_eligible_with_count"] == 0 and r["other_eligible_without_count"] == 0),
        ("ho-p3-01", "held_out", "p3_edge", lambda r: r["other_health_without_count"] == 0 and r["other_non_health_out_count"] == 0 and r["focal_state"] == "PRE_GAME_AVAILABLE"),
        ("ho-entity-only-01", "held_out", "entity_only", lambda r: r.get("focal_serving_player_id") in (None, "")),
        ("ho-nonbinary-01", "held_out", "nonbinary", lambda r: r["other_nonbinary_health_count"] >= 3),
        ("ho-no-pgl-01", "held_out", "no_pgl", lambda r: r["focal_realized_participation_diagnostic"] == "NO_PGL_ROW"),
        ("ho-without-deep-01", "held_out", "without_deep_contam", lambda r: r["focal_state"] == "PRE_GAME_OUT" and r["other_health_without_count"] >= 2 and r["other_non_health_out_count"] >= 2),
        ("ho-with-contam-01", "held_out", "with_health_out_present", lambda r: r["focal_state"] == "PRE_GAME_AVAILABLE" and r["other_health_without_count"] >= 2),
        ("ho-season-2023-01", "held_out", "season_2023", lambda r: str(r["season"]) == "2023" and r["focal_state"] == "PRE_GAME_OUT"),
        ("ho-season-2025-01", "held_out", "season_2025", lambda r: str(r["season"]) == "2025" and r["focal_state"] == "PRE_GAME_AVAILABLE"),
        ("ho-multi-focal-b-01", "held_out", "subject_multi_focal_b", lambda r: True),
    ]

    fixtures: list[dict[str, Any]] = []
    for fid, split, category, pred in specs:
        r = pick(pairs, pred, category, used)
        # for multi-focal: after first, pick another obs same subject+game different focal
        if category.endswith("_a") or category == "subject_multi_focal_a":
            pass
        exp = expected_from_obs(r)
        fixtures.append(
            {
                "fixture_id": fid,
                "kind": "real",
                "split": split,
                "category": category,
                "input": {
                    "game_id": r["game_id"],
                    "team_id": r["team_id"],
                    "season": r["season"],
                    "subject_player_entity_id": r["subject_player_entity_id"],
                    "subject_serving_player_id": r["subject_serving_player_id"],
                    "focal_player_entity_id": r["focal_player_entity_id"],
                    "focal_serving_player_id": r.get("focal_serving_player_id"),
                    "focal_eligibility": r["focal_eligibility"],
                    "focal_state": r["focal_state"],
                    "t60_report_published_at": r.get("t60_report_published_at"),
                    "other_health_without_count": r["other_health_without_count"],
                    "other_health_with_count": r["other_health_with_count"],
                    "other_non_health_out_count": r["other_non_health_out_count"],
                    "other_nonbinary_health_count": r["other_nonbinary_health_count"],
                    "other_eligible_with_count": r["other_eligible_with_count"],
                    "other_eligible_without_count": r["other_eligible_without_count"],
                    "focal_realized_participation": r["focal_realized_participation_diagnostic"],
                    "subject_metrics": exp["subject_metrics"],
                },
                "expected": exp,
            }
        )

    # Ensure multi-focal same subject/game for one pair of fixtures
    # find a game with 2+ focals for same subject
    by_sg: dict[tuple, list] = defaultdict(list)
    for r in pairs:
        by_sg[(r["game_id"], r["subject_player_entity_id"])].append(r)
    multi = next(v for v in by_sg.values() if len({x["focal_player_entity_id"] for x in v}) >= 2)
    multi = sorted(multi, key=lambda x: x["focal_player_entity_id"])[:2]
    # replace last two development multi-focal placeholders if needed — already have a and will add second
    fixtures.append(
        {
            "fixture_id": "dev-multi-focal-b-01",
            "kind": "real",
            "split": "development",
            "category": "subject_multi_focal_b",
            "input": {
                "game_id": multi[1]["game_id"],
                "team_id": multi[1]["team_id"],
                "season": multi[1]["season"],
                "subject_player_entity_id": multi[1]["subject_player_entity_id"],
                "subject_serving_player_id": multi[1]["subject_serving_player_id"],
                "focal_player_entity_id": multi[1]["focal_player_entity_id"],
                "focal_serving_player_id": multi[1].get("focal_serving_player_id"),
                "focal_eligibility": multi[1]["focal_eligibility"],
                "focal_state": multi[1]["focal_state"],
                "t60_report_published_at": multi[1].get("t60_report_published_at"),
                "other_health_without_count": multi[1]["other_health_without_count"],
                "other_health_with_count": multi[1]["other_health_with_count"],
                "other_non_health_out_count": multi[1]["other_non_health_out_count"],
                "other_nonbinary_health_count": multi[1]["other_nonbinary_health_count"],
                "other_eligible_with_count": multi[1]["other_eligible_with_count"],
                "other_eligible_without_count": multi[1]["other_eligible_without_count"],
                "focal_realized_participation": multi[1]["focal_realized_participation_diagnostic"],
                "subject_metrics": expected_from_obs(multi[1])["subject_metrics"],
            },
            "expected": expected_from_obs(multi[1]),
            "related_fixture_id": "dev-multi-focal-a-01",
        }
    )
    # overwrite multi-focal-a with multi[0]
    for fx in fixtures:
        if fx["fixture_id"] == "dev-multi-focal-a-01":
            fx["input"] = {
                "game_id": multi[0]["game_id"],
                "team_id": multi[0]["team_id"],
                "season": multi[0]["season"],
                "subject_player_entity_id": multi[0]["subject_player_entity_id"],
                "subject_serving_player_id": multi[0]["subject_serving_player_id"],
                "focal_player_entity_id": multi[0]["focal_player_entity_id"],
                "focal_serving_player_id": multi[0].get("focal_serving_player_id"),
                "focal_eligibility": multi[0]["focal_eligibility"],
                "focal_state": multi[0]["focal_state"],
                "t60_report_published_at": multi[0].get("t60_report_published_at"),
                "other_health_without_count": multi[0]["other_health_without_count"],
                "other_health_with_count": multi[0]["other_health_with_count"],
                "other_non_health_out_count": multi[0]["other_non_health_out_count"],
                "other_nonbinary_health_count": multi[0]["other_nonbinary_health_count"],
                "other_eligible_with_count": multi[0]["other_eligible_with_count"],
                "other_eligible_without_count": multi[0]["other_eligible_without_count"],
                "focal_realized_participation": multi[0]["focal_realized_participation_diagnostic"],
                "subject_metrics": expected_from_obs(multi[0])["subject_metrics"],
            }
            fx["expected"] = expected_from_obs(multi[0])
            fx["related_fixture_id"] = "dev-multi-focal-b-01"

    # Synthetics — contract tests (expected emit/not)
    synthetics = [
        {
            "fixture_id": "syn-self-pair-01",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "self_pair",
            "input": {
                "game_id": "SYN1",
                "team_id": "1",
                "season": "2025",
                "subject_player_entity_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "subject_serving_player_id": "1",
                "focal_player_entity_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "focal_serving_player_id": "1",
                "focal_eligibility": "WITHOUT_CANDIDATE",
                "focal_state": "PRE_GAME_OUT",
                "team_states": [],
                "subject_metrics": {"minutes": 20, "pts": 10, "reb": 2, "ast": 3, "tpm": 1, "fga": 8, "tpa": 3, "fta": 2},
                "focal_realized_participation": "DNP_00",
            },
            "expected": {"emitted": False, "reason": "SELF_PAIR_REMOVED"},
        },
        {
            "fixture_id": "syn-subject-unresolved-01",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "subject_identity_missing",
            "input": {
                "game_id": "SYN2",
                "team_id": "1",
                "season": "2025",
                "subject_player_entity_id": None,
                "subject_serving_player_id": "99",
                "focal_player_entity_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                "focal_eligibility": "WITH_CANDIDATE",
                "focal_state": "PRE_GAME_AVAILABLE",
                "subject_metrics": {"minutes": 20, "pts": 10, "reb": 2, "ast": 3, "tpm": 1, "fga": 8, "tpa": 3, "fta": 2},
                "focal_realized_participation": "PLAYED",
            },
            "expected": {"emitted": False, "reason": "SUBJECT_IDENTITY_UNRESOLVED"},
        },
        {
            "fixture_id": "syn-counter-excl-01",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "counter_excludes_focal",
            "input": {
                "mode": "compute_counters",
                "game_id": "SYN3",
                "team_id": "1",
                "season": "2025",
                "focal_player_entity_id": "focal-1",
                "focal_eligibility": "WITHOUT_CANDIDATE",
                "focal_state": "PRE_GAME_OUT",
                "subject_player_entity_id": "subj-1",
                "subject_serving_player_id": "10",
                "teammates": [
                    {"player_entity_id": "focal-1", "status_raw": "Out", "health_relation": "HEALTH_RELATED", "injury_wowy_eligibility": "WITHOUT_CANDIDATE", "canonical_model_eligible": True},
                    {"player_entity_id": "o1", "status_raw": "Out", "health_relation": "HEALTH_RELATED", "injury_wowy_eligibility": "WITHOUT_CANDIDATE", "canonical_model_eligible": True},
                    {"player_entity_id": "o2", "status_raw": "Out", "health_relation": "HEALTH_RELATED", "injury_wowy_eligibility": "WITHOUT_CANDIDATE", "canonical_model_eligible": True},
                ],
                "subject_metrics": {"minutes": 20, "pts": 10, "reb": 2, "ast": 3, "tpm": 1, "fga": 8, "tpa": 3, "fta": 2},
                "focal_realized_participation": "DNP_00",
            },
            "expected": {
                "emitted": True,
                "other_health_without_count": 2,
                "other_eligible_without_count": 2,
                "cohort_p1": False,
                "cohort_p2": False,
            },
        },
        {
            "fixture_id": "syn-p1-symmetry-with-01",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "p1_symmetry_with",
            "input": {
                "mode": "compute_counters",
                "game_id": "SYN4",
                "team_id": "1",
                "season": "2025",
                "focal_player_entity_id": "focal-a",
                "focal_eligibility": "WITH_CANDIDATE",
                "focal_state": "PRE_GAME_AVAILABLE",
                "subject_player_entity_id": "subj-1",
                "subject_serving_player_id": "10",
                "teammates": [
                    {"player_entity_id": "focal-a", "status_raw": "Available", "health_relation": "HEALTH_RELATED", "injury_wowy_eligibility": "WITH_CANDIDATE", "canonical_model_eligible": True},
                    {"player_entity_id": "x", "status_raw": "Out", "health_relation": "NON_HEALTH_RELATED", "injury_wowy_eligibility": "NON_HEALTH_EXCLUDED", "canonical_model_eligible": False},
                ],
                "subject_metrics": {"minutes": 20, "pts": 10, "reb": 2, "ast": 3, "tpm": 1, "fga": 8, "tpa": 3, "fta": 2},
                "focal_realized_participation": "PLAYED",
            },
            "expected": {"emitted": True, "other_health_without_count": 0, "cohort_p1": True, "cohort_p3": False},
        },
        {
            "fixture_id": "syn-p1-symmetry-without-01",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "p1_symmetry_without",
            "input": {
                "mode": "compute_counters",
                "game_id": "SYN5",
                "team_id": "1",
                "season": "2025",
                "focal_player_entity_id": "focal-b",
                "focal_eligibility": "WITHOUT_CANDIDATE",
                "focal_state": "PRE_GAME_OUT",
                "subject_player_entity_id": "subj-1",
                "subject_serving_player_id": "10",
                "teammates": [
                    {"player_entity_id": "focal-b", "status_raw": "Out", "health_relation": "HEALTH_RELATED", "injury_wowy_eligibility": "WITHOUT_CANDIDATE", "canonical_model_eligible": True},
                    {"player_entity_id": "x", "status_raw": "Out", "health_relation": "NON_HEALTH_RELATED", "injury_wowy_eligibility": "NON_HEALTH_EXCLUDED", "canonical_model_eligible": False},
                ],
                "subject_metrics": {"minutes": 20, "pts": 10, "reb": 2, "ast": 3, "tpm": 1, "fga": 8, "tpa": 3, "fta": 2},
                "focal_realized_participation": "DNP_00",
            },
            "expected": {"emitted": True, "other_health_without_count": 0, "cohort_p1": True, "cohort_p3": False},
        },
        {
            "fixture_id": "syn-entity-only-01",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "entity_only_focal",
            "input": {
                "mode": "compute_counters",
                "game_id": "SYN6",
                "team_id": "1",
                "season": "2025",
                "focal_player_entity_id": "focal-eo",
                "focal_serving_player_id": None,
                "focal_eligibility": "WITHOUT_CANDIDATE",
                "focal_state": "PRE_GAME_OUT",
                "subject_player_entity_id": "subj-1",
                "subject_serving_player_id": "10",
                "teammates": [
                    {"player_entity_id": "focal-eo", "status_raw": "Out", "health_relation": "HEALTH_RELATED", "injury_wowy_eligibility": "WITHOUT_CANDIDATE", "canonical_model_eligible": True},
                ],
                "subject_metrics": {"minutes": 20, "pts": 10, "reb": 2, "ast": 3, "tpm": 1, "fga": 8, "tpa": 3, "fta": 2},
                "focal_realized_participation": "NO_PGL_ROW",
            },
            "expected": {"emitted": True, "focal_serving_player_id": None, "cohort_p1": True, "cohort_p2": True, "cohort_p3": True},
        },
        {
            "fixture_id": "syn-focal-conflict-01",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "focal_state_conflict",
            "input": {
                "mode": "validate_focals",
                "focals": [
                    {"game_id": "SYN7", "team_id": "1", "player_entity_id": "f1", "injury_wowy_eligibility": "WITH_CANDIDATE"},
                    {"game_id": "SYN7", "team_id": "1", "player_entity_id": "f1", "injury_wowy_eligibility": "WITHOUT_CANDIDATE"},
                ],
            },
            "expected": {"hard_failure": "FOCAL_STATE_CONFLICT"},
        },
        {
            "fixture_id": "syn-dup-subject-01",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "duplicate_subject_pgl",
            "input": {
                "mode": "validate_subjects",
                "subjects": [
                    {"game_id": "SYN8", "team_id": "1", "player_entity_id": "s1", "player_id": "1"},
                    {"game_id": "SYN8", "team_id": "1", "player_entity_id": "s1", "player_id": "2"},
                ],
            },
            "expected": {"hard_failure": "PGL_DUPLICATE_SUBJECT_ENTITY"},
        },
    ]
    fixtures.extend(synthetics)

    for sub in ("development", "held_out", "synthetic"):
        d = FIXTURE_ROOT / sub
        d.mkdir(parents=True, exist_ok=True)
        for old in d.glob("*.json"):
            old.unlink()

    manifest_fx = []
    for fx in fixtures:
        path = FIXTURE_ROOT / fx["split"] / f"{fx['fixture_id']}.json"
        path.write_text(json.dumps(fx, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        manifest_fx.append(
            {
                "fixture_id": fx["fixture_id"],
                "kind": fx["kind"],
                "split": fx["split"],
                "category": fx["category"],
            }
        )

    counts = {
        "development": sum(1 for f in fixtures if f["split"] == "development"),
        "held_out": sum(1 for f in fixtures if f["split"] == "held_out"),
        "synthetic": sum(1 for f in fixtures if f["split"] == "synthetic"),
        "total": len(fixtures),
    }
    manifest = {
        "locked_at": utc_now(),
        "pair_policy_version": PAIR_POLICY_VERSION,
        "golden_pair_observations_sha256": pairs_sha,
        "note": "Real fixture expectations locked from Phase 6A golden pair observations before builder implementation. P1/P2/P3 match Phase 6A design-audit semantics.",
        "phase6a_semantics": {
            "other_health_without_count": "Out + HEALTH_RELATED excluding focal",
            "other_health_with_count": "Available + HEALTH_RELATED excluding focal",
            "P1": "other_health_without_count == 0",
            "P2": "other_eligible_with_count == 0 AND other_eligible_without_count == 0",
            "P3": "other_health_without_count == 0 AND other_non_health_out_count == 0",
        },
        "counts": counts,
        "fixtures": manifest_fx,
    }
    (FIXTURE_ROOT / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps({"locked": True, "counts": counts}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
