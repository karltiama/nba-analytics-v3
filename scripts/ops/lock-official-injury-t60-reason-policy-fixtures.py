"""
Phase 5C — lock real + synthetic reason/eligibility fixtures BEFORE implementation.

Expectations are derived from the approved Phase 5B classified artifact (oracle),
translated into Phase 5C eligibility field names. Does not implement the TS classifier.

  python scripts/ops/lock-official-injury-t60-reason-policy-fixtures.py
"""

from __future__ import annotations

import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SELECTED_GZ = ROOT / "tmp" / "official-injury-report-asof-t60" / "selected-player-states.ndjson.gz"
CLASSIFIED_GZ = (
    ROOT / "tmp" / "official-injury-report-t60-reason-policy" / "classified-selected-rows.ndjson.gz"
)
DESIGN_JSON = ROOT / "reports" / "operations" / "official-injury-report-t60-reason-policy-design.json"
FIXTURE_ROOT = ROOT / "tests" / "fixtures" / "official-injury-t60-reason-policy"

EXPECTED_SELECTED_SHA = "a63e9d1552bf82818f0ed10b941ce9125ded26dca738f72dcb2c2121710f2b01"
EXPECTED_STATUS = {
    "Out": 30672,
    "Available": 3630,
    "Questionable": 4828,
    "Doubtful": 627,
    "Probable": 1710,
}

REASON_POLICY_VERSION = "official-injury-reason-policy-v1"
ELIGIBILITY_POLICY_VERSION = "injury-wowy-eligibility-v1"


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def row_id(r: dict[str, Any]) -> str:
    return f"{r['game_id']}|{r['team_id']}|{r['player_name_raw']}|{r['status_raw']}|{r['reason_raw']}"


def availability_fact(status: str) -> str:
    if status == "Out":
        return "ALL_CAUSE_EXPLICIT_OUT"
    if status == "Available":
        return "ALL_CAUSE_EXPLICIT_AVAILABLE"
    return "NON_BINARY_EXPLICIT"


def is_canon(bucket: str | None) -> bool:
    return bucket in (
        "RESOLVED_CANONICAL_ENTITY",
        "RESOLVED_ENTITY_NO_SERVING_PLAYER",
    )


def derive_eligibility(
    status: str,
    health: str,
    identity_bucket: str | None,
) -> dict[str, Any]:
    canon = is_canon(identity_bucket)
    if status in ("Questionable", "Doubtful", "Probable"):
        reason_side = "NON_BINARY_UNKNOWN"
    elif health == "UNCLASSIFIED":
        reason_side = "UNCLASSIFIED_EXCLUDED"
    elif health == "NON_HEALTH_RELATED":
        reason_side = "NON_HEALTH_EXCLUDED"
    elif status == "Out" and health == "HEALTH_RELATED":
        reason_side = "WITHOUT_CANDIDATE"
    elif status == "Available" and health == "HEALTH_RELATED":
        reason_side = "WITH_CANDIDATE"
    else:
        reason_side = "UNCLASSIFIED_EXCLUDED"

    if reason_side in ("WITHOUT_CANDIDATE", "WITH_CANDIDATE") and not canon:
        final = "INELIGIBLE_IDENTITY"
        model_eligible = False
    elif reason_side in ("WITHOUT_CANDIDATE", "WITH_CANDIDATE") and canon:
        final = reason_side
        model_eligible = True
    else:
        final = reason_side
        model_eligible = False

    return {
        "availability_fact": availability_fact(status),
        "reason_side_eligibility": reason_side,
        "identity_status": identity_bucket,
        "canonical_identity_resolved": canon,
        "canonical_model_eligible": model_eligible,
        "injury_wowy_eligibility": final,
    }


def pick(rows: list[dict], pred, label: str) -> dict:
    for r in rows:
        if pred(r):
            return r
    raise SystemExit(f"no row for fixture category: {label}")


def fixture_from_row(
    *,
    fixture_id: str,
    split: str,
    category: str,
    r: dict[str, Any],
    kind: str = "real",
) -> dict[str, Any]:
    elig = derive_eligibility(r["status_raw"], r["health_relation"], r.get("identity_bucket"))
    return {
        "fixture_id": fixture_id,
        "kind": kind,
        "split": split,
        "category": category,
        "source_player_state_id": row_id(r),
        "input": {
            "game_id": r.get("game_id"),
            "team_id": r.get("team_id"),
            "season": r.get("season"),
            "player_name_raw": r.get("player_name_raw"),
            "player_entity_id": r.get("player_entity_id"),
            "status_raw": r["status_raw"],
            "reason_raw": r["reason_raw"],
            "identity_bucket": r.get("identity_bucket"),
        },
        "expected": {
            "reason_policy_version": REASON_POLICY_VERSION,
            "eligibility_policy_version": ELIGIBILITY_POLICY_VERSION,
            "reason_category": r["reason_category"],
            "health_relation": r["health_relation"],
            "classification_rule": r["match_rule"],
            **elig,
        },
    }


def synthetic(
    fixture_id: str,
    category: str,
    status: str,
    reason: str,
    identity_bucket: str,
    expected_category: str,
    expected_health: str,
    expected_rule: str,
) -> dict[str, Any]:
    elig = derive_eligibility(status, expected_health, identity_bucket)
    return {
        "fixture_id": fixture_id,
        "kind": "synthetic",
        "split": "synthetic",
        "category": category,
        "source_player_state_id": None,
        "input": {
            "game_id": "SYNTH",
            "team_id": "0",
            "season": "2025",
            "player_name_raw": "Synthetic, Player",
            "player_entity_id": "00000000-0000-0000-0000-000000000001"
            if identity_bucket != "IDENTITY_QUARANTINED"
            else None,
            "status_raw": status,
            "reason_raw": reason,
            "identity_bucket": identity_bucket,
        },
        "expected": {
            "reason_policy_version": REASON_POLICY_VERSION,
            "eligibility_policy_version": ELIGIBILITY_POLICY_VERSION,
            "reason_category": expected_category,
            "health_relation": expected_health,
            "classification_rule": expected_rule,
            **elig,
        },
    }


def main() -> int:
    design = json.loads(DESIGN_JSON.read_text(encoding="utf-8"))
    expected_clf_sha = design["artifacts"]["classified_rows_gz_sha256"]

    sel_sha = sha256_file(SELECTED_GZ)
    clf_sha = sha256_file(CLASSIFIED_GZ)
    if sel_sha != EXPECTED_SELECTED_SHA:
        raise SystemExit(f"selected SHA drift: {sel_sha}")
    if clf_sha != expected_clf_sha:
        raise SystemExit(f"classified SHA drift: {clf_sha} != {expected_clf_sha}")

    # verify status totals on selected
    status_counts: dict[str, int] = {}
    with gzip.open(SELECTED_GZ, "rt", encoding="utf-8") as fh:
        n = 0
        for line in fh:
            if not line.strip():
                continue
            r = json.loads(line)
            n += 1
            status_counts[r["status_raw"]] = status_counts.get(r["status_raw"], 0) + 1
    if n != 41467:
        raise SystemExit(f"selected n drift: {n}")
    for k, v in EXPECTED_STATUS.items():
        if status_counts.get(k) != v:
            raise SystemExit(f"status drift {k}: {status_counts.get(k)} != {v}")

    rows: list[dict[str, Any]] = []
    with gzip.open(CLASSIFIED_GZ, "rt", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))

    # Stable sort for deterministic picks
    rows.sort(key=lambda r: row_id(r))

    specs: list[tuple[str, str, str, Any]] = [
        # development (real)
        ("dev-injury-out-01", "development", "injury_illness_out", lambda r: r["reason_category"] == "INJURY_OR_ILLNESS" and r["status_raw"] == "Out" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-injury-avail-01", "development", "injury_illness_available", lambda r: r["reason_category"] == "INJURY_OR_ILLNESS" and r["status_raw"] == "Available" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-illness-out-01", "development", "illness_out", lambda r: r["reason_category"] == "ILLNESS" and r["status_raw"] == "Out" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-illness-avail-01", "development", "illness_available", lambda r: r["reason_category"] == "ILLNESS" and r["status_raw"] == "Available" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-concussion-out-01", "development", "concussion_out", lambda r: r["reason_category"] == "CONCUSSION" and r["status_raw"] == "Out" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-inj-mgmt-out-01", "development", "injury_management_out", lambda r: r["reason_category"] == "INJURY_MANAGEMENT" and r["status_raw"] == "Out" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-recond-out-01", "development", "reconditioning_out", lambda r: r["reason_raw"] == "Reconditioning" and r["status_raw"] == "Out" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-recond-rtc-01", "development", "return_to_competition_reconditioning", lambda r: r["reason_raw"] == "Return to Competition Reconditioning" and r["status_raw"] == "Out"),
        ("dev-rest-out-01", "development", "rest_out", lambda r: r["reason_raw"] == "Rest" and r["status_raw"] == "Out" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-rest-hybrid-01", "development", "rest_injury_management_hybrid", lambda r: r["reason_raw"] == "Rest - Left Knee Injury Management"),
        ("dev-gleague-tw-out-01", "development", "g_league_two_way_out", lambda r: r["reason_category"] == "G_LEAGUE_TWO_WAY" and r["status_raw"] == "Out" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-gleague-oa-out-01", "development", "g_league_on_assignment_out", lambda r: r["reason_category"] == "G_LEAGUE_ON_ASSIGNMENT" and r["status_raw"] == "Out" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-personal-out-01", "development", "personal_out", lambda r: r["reason_category"] == "PERSONAL" and r["status_raw"] == "Out" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-nwt-out-01", "development", "not_with_team_out", lambda r: r["reason_category"] == "NOT_WITH_TEAM" and r["status_raw"] == "Out" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-suspension-out-01", "development", "suspension_out", lambda r: r["reason_category"] == "SUSPENSION" and r["status_raw"] == "Out" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-trade-out-01", "development", "trade_out", lambda r: r["reason_raw"] == "Trade Pending" and r["status_raw"] == "Out" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-coach-out-01", "development", "coachs_decision_out", lambda r: r["reason_category"] == "COACHS_DECISION" and r["status_raw"] == "Out"),
        ("dev-ineligible-out-01", "development", "ineligible_to_play_out", lambda r: r["reason_category"] == "INELIGIBLE_TO_PLAY" and r["status_raw"] == "Out"),
        ("dev-placeholder-dash-01", "development", "placeholder_dash_available", lambda r: r["reason_raw"] == "-" and r["status_raw"] == "Available" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-q-health-01", "development", "questionable_health", lambda r: r["status_raw"] == "Questionable" and r["health_relation"] == "HEALTH_RELATED" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-d-health-01", "development", "doubtful_health", lambda r: r["status_raw"] == "Doubtful" and r["health_relation"] == "HEALTH_RELATED" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-p-health-01", "development", "probable_health", lambda r: r["status_raw"] == "Probable" and r["health_relation"] == "HEALTH_RELATED" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-idq-out-01", "development", "identity_quarantined_health_out", lambda r: r["status_raw"] == "Out" and r["health_relation"] == "HEALTH_RELATED" and r["identity_bucket"] == "IDENTITY_QUARANTINED"),
        ("dev-idq-avail-01", "development", "identity_quarantined_health_available", lambda r: r["status_raw"] == "Available" and r["health_relation"] == "HEALTH_RELATED" and r["identity_bucket"] == "IDENTITY_QUARANTINED"),
        ("dev-entity-only-01", "development", "entity_only_health_out", lambda r: r["identity_bucket"] == "RESOLVED_ENTITY_NO_SERVING_PLAYER"),
        ("dev-rest-avail-01", "development", "rest_available", lambda r: r["reason_raw"] == "Rest" and r["status_raw"] == "Available"),
        ("dev-gleague-avail-01", "development", "g_league_available", lambda r: r["reason_category"] == "G_LEAGUE_TWO_WAY" and r["status_raw"] == "Available" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-concussion-avail-01", "development", "concussion_available", lambda r: r["reason_category"] == "CONCUSSION" and r["status_raw"] == "Available" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-inj-mgmt-avail-01", "development", "injury_management_available", lambda r: r["reason_category"] == "INJURY_MANAGEMENT" and r["status_raw"] == "Available" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("dev-recond-avail-01", "development", "reconditioning_available", lambda r: r["reason_category"] == "RECONDITIONING" and r["status_raw"] == "Available" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        # held-out (real) — harder edges
        ("ho-injury-out-01", "held_out", "injury_illness_out", lambda r: r["reason_category"] == "INJURY_OR_ILLNESS" and r["status_raw"] == "Out" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY" and "Sprain" in r["reason_raw"]),
        ("ho-injury-avail-01", "held_out", "injury_illness_available", lambda r: r["reason_category"] == "INJURY_OR_ILLNESS" and r["status_raw"] == "Available" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY"),
        ("ho-illness-01", "held_out", "illness", lambda r: r["reason_raw"] == "Injury/Illness - N/a; Illness"),
        ("ho-concussion-01", "held_out", "concussion", lambda r: r["reason_category"] == "CONCUSSION" and "Protocol" in r["reason_raw"] and r["status_raw"] == "Out"),
        ("ho-inj-mgmt-01", "held_out", "injury_management", lambda r: r["reason_category"] == "INJURY_MANAGEMENT" and r["status_raw"] == "Out" and "Knee" in r["reason_raw"]),
        ("ho-rest-rest-01", "held_out", "rest_rest", lambda r: r["reason_raw"] == "Rest - Rest"),
        ("ho-rest-hybrid-01", "held_out", "rest_hybrid", lambda r: r["reason_raw"] == "Rest - Left Knee - Injury Management"),
        ("ho-gleague-rtc-01", "held_out", "g_league_return_to_competition", lambda r: r["reason_raw"] == "G League - Two-Way Return to Competition"),
        ("ho-placeholder-rtc-01", "held_out", "placeholder_return_to_competition", lambda r: r["reason_raw"] == "-Return to Competition"),
        ("ho-nwt-rtc-01", "held_out", "not_with_team_return_to_competition", lambda r: r["reason_raw"] == "Not With Team Return to Competition"),
        ("ho-personal-rtc-01", "held_out", "personal_return_to_competition", lambda r: r["reason_raw"] == "Personal Reasons Return to Competition"),
        ("ho-q-01", "held_out", "questionable_health", lambda r: r["status_raw"] == "Questionable" and r["health_relation"] == "HEALTH_RELATED" and r["identity_bucket"] == "RESOLVED_CANONICAL_ENTITY" and "Ankle" in r["reason_raw"]),
        ("ho-idq-out-01", "held_out", "identity_quarantined_health_out", lambda r: r["status_raw"] == "Out" and r["health_relation"] == "HEALTH_RELATED" and r["identity_bucket"] == "IDENTITY_QUARANTINED" and r["reason_category"] == "INJURY_OR_ILLNESS"),
        ("ho-coach-01", "held_out", "coachs_decision", lambda r: r["reason_raw"] == "Coach's Decision"),
        ("ho-ineligible-01", "held_out", "ineligible_to_play", lambda r: r["reason_raw"] == "Ineligible To Play"),
        ("ho-suspension-01", "held_out", "suspension", lambda r: r["reason_raw"] == "League Suspension" and r["status_raw"] == "Out"),
    ]

    used_ids: set[str] = set()
    fixtures: list[dict[str, Any]] = []
    for fid, split, category, pred in specs:
        def pred_unused(r, _pred=pred):
            rid = row_id(r)
            return _pred(r) and rid not in used_ids

        r = pick(rows, pred_unused, category)
        used_ids.add(row_id(r))
        fixtures.append(fixture_from_row(fixture_id=fid, split=split, category=category, r=r))

    synthetics = [
        synthetic(
            "syn-unknown-01",
            "unknown_reason",
            "Out",
            "Completely New Provider Reason",
            "RESOLVED_CANONICAL_ENTITY",
            "UNCLASSIFIED",
            "UNCLASSIFIED",
            "FALLBACK_UNCLASSIFIED",
        ),
        synthetic(
            "syn-q-health-01",
            "non_binary_health",
            "Questionable",
            "Injury/Illness - Left Ankle; Sprain",
            "RESOLVED_CANONICAL_ENTITY",
            "INJURY_OR_ILLNESS",
            "HEALTH_RELATED",
            "PREFIX_INJURY_ILLNESS",
        ),
        synthetic(
            "syn-avail-nonhealth-01",
            "available_non_health",
            "Available",
            "Rest",
            "RESOLVED_CANONICAL_ENTITY",
            "REST",
            "NON_HEALTH_RELATED",
            "PREFIX_OR_EXACT_REST",
        ),
        synthetic(
            "syn-out-nonhealth-01",
            "out_non_health",
            "Out",
            "G League - Two-Way",
            "RESOLVED_CANONICAL_ENTITY",
            "G_LEAGUE_TWO_WAY",
            "NON_HEALTH_RELATED",
            "PREFIX_G_LEAGUE",
        ),
        synthetic(
            "syn-health-idq-01",
            "health_out_identity_quarantine",
            "Out",
            "Injury/Illness - Left Ankle; Sprain",
            "IDENTITY_QUARANTINED",
            "INJURY_OR_ILLNESS",
            "HEALTH_RELATED",
            "PREFIX_INJURY_ILLNESS",
        ),
        synthetic(
            "syn-health-entity-only-01",
            "health_available_entity_only",
            "Available",
            "Injury/Illness - Left Ankle; Sprain",
            "RESOLVED_ENTITY_NO_SERVING_PLAYER",
            "INJURY_OR_ILLNESS",
            "HEALTH_RELATED",
            "PREFIX_INJURY_ILLNESS",
        ),
        synthetic(
            "syn-blank-01",
            "blank_reason",
            "Out",
            "",
            "RESOLVED_CANONICAL_ENTITY",
            "UNCLASSIFIED",
            "UNCLASSIFIED",
            "BLANK_REASON",
        ),
        synthetic(
            "syn-overlap-rest-inj-01",
            "precedence_rest_over_injury_words",
            "Out",
            "Rest - Left Knee Injury Management",
            "RESOLVED_CANONICAL_ENTITY",
            "REST",
            "NON_HEALTH_RELATED",
            "PREFIX_OR_EXACT_REST",
        ),
    ]
    fixtures.extend(synthetics)

    # write
    for sub in ("development", "held_out", "synthetic"):
        d = FIXTURE_ROOT / sub
        d.mkdir(parents=True, exist_ok=True)
        for old in d.glob("*.json"):
            old.unlink()

    manifest_fixtures = []
    for fx in fixtures:
        split = fx["split"]
        path = FIXTURE_ROOT / split / f"{fx['fixture_id']}.json"
        path.write_text(json.dumps(fx, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        manifest_fixtures.append(
            {
                "fixture_id": fx["fixture_id"],
                "kind": fx["kind"],
                "split": fx["split"],
                "category": fx["category"],
                "status_raw": fx["input"]["status_raw"],
                "reason_raw": fx["input"]["reason_raw"],
                "expected_reason_category": fx["expected"]["reason_category"],
                "expected_health_relation": fx["expected"]["health_relation"],
                "expected_injury_wowy_eligibility": fx["expected"]["injury_wowy_eligibility"],
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
        "reason_policy_version": REASON_POLICY_VERSION,
        "eligibility_policy_version": ELIGIBILITY_POLICY_VERSION,
        "input_fingerprints": {
            "selected_player_states_sha256": sel_sha,
            "classified_selected_rows_sha256": clf_sha,
            "selected_player_rows": 41467,
            "status_counts_verified": EXPECTED_STATUS,
        },
        "counts": counts,
        "note": "Held-out expectations locked before TypeScript implementation. Development runner must not load held_out.",
        "fixtures": manifest_fixtures,
    }
    FIXTURE_ROOT.mkdir(parents=True, exist_ok=True)
    (FIXTURE_ROOT / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps({"locked": True, "counts": counts, "clf_sha": clf_sha[:16]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
