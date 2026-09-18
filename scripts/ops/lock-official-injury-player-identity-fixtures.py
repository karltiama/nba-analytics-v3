"""
Phase 4D.0 — Lock official-injury player-identity certification fixtures.

Expected outcomes are derived ONLY from Phase 4B candidate evidence + Phase 4C
approved policy (NOT from a resolver implementation).

  python scripts/ops/lock-official-injury-player-identity-fixtures.py
"""

from __future__ import annotations

import gzip
import hashlib
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CAND_GZ = ROOT / "tmp" / "official-injury-report-player-identity-candidate-audit" / "official-player-game-candidates.ndjson.gz"
OUT = ROOT / "tests" / "fixtures" / "official-injury-player-identity"
EXPECTED_SHA = "05854997a74e085cc978103f7d8ddb97988f47446a3b99621895495e1fcdf5c2"
RESOLVER_VERSION = "official-injury-player-identity-v1"


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def evidence_from_row(r: dict) -> dict:
    u2_class = r["u2_class"]
    u2_unique = u2_class in ("U2_UNIQUE_PLAYED", "U2_UNIQUE_DNP_00") and bool(r.get("u2_entity_id"))
    u4n_unique = r["u4_nba_class"] == "UNIQUE_CANDIDATE" and len(r.get("u4_nba_entity_ids") or []) == 1
    u4i_unique = r["u4_inferred_class"] == "UNIQUE_CANDIDATE" and len(r.get("u4_inferred_entity_ids") or []) == 1

    u2 = {
        "cardinality": (
            "unique"
            if u2_unique
            else ("multiple" if u2_class == "U2_MULTIPLE_MATCHES" else "none")
        ),
        "playerId": r.get("u2_player_id") if u2_unique else None,
        "playerEntityId": r.get("u2_entity_id") if u2_unique else None,
        "minutes": r.get("u2_minutes") if u2_unique else None,
    }
    u4_nba = {
        "cardinality": (
            "unique"
            if u4n_unique
            else ("multiple" if r["u4_nba_class"] == "MULTIPLE_CANDIDATES" else "none")
        ),
        "playerEntityId": (r.get("u4_nba_entity_ids") or [None])[0] if u4n_unique else None,
        "source": "nba_stats",
    }
    u4_inf = {
        "cardinality": (
            "unique"
            if u4i_unique
            else ("multiple" if r["u4_inferred_class"] == "MULTIPLE_CANDIDATES" else "none")
        ),
        "playerEntityId": (r.get("u4_inferred_entity_ids") or [None])[0] if u4i_unique else None,
        "source": "inferred_pgl",
    }
    return {"u2": u2, "u4Nba": u4_nba, "u4Inferred": u4_inf}


def expected_from_policy(r: dict, evidence: dict) -> dict:
    """Manual Phase 4C conservative policy derivation."""
    u2 = evidence["u2"]
    nba = evidence["u4Nba"]
    inf = evidence["u4Inferred"]

    if u2["cardinality"] == "multiple" or nba["cardinality"] == "multiple" or inf["cardinality"] == "multiple":
        return {
            "resolution_status": "QUARANTINED_MULTIPLE_CANDIDATES",
            "player_entity_id": None,
            "serving_player_id": None,
            "confidence_class": None,
            "provenance_category": None,
            "independent_source_count": 0,
            "quarantine_reason": "MULTIPLE_CANDIDATES",
        }

    ents = {}
    if u2["cardinality"] == "unique":
        ents["U2"] = u2["playerEntityId"]
    if nba["cardinality"] == "unique":
        ents["U4_NBA"] = nba["playerEntityId"]

    if len(set(ents.values())) > 1:
        return {
            "resolution_status": "QUARANTINED_SOURCE_CONFLICT",
            "player_entity_id": None,
            "serving_player_id": None,
            "confidence_class": None,
            "provenance_category": None,
            "independent_source_count": 0,
            "quarantine_reason": "SOURCE_CONFLICT",
        }

    # Tier A
    if u2["cardinality"] == "unique" and nba["cardinality"] == "unique" and u2["playerEntityId"] == nba["playerEntityId"]:
        eid = u2["playerEntityId"]
        serving = u2["playerId"]
        status = "RESOLVED_CANONICAL_ENTITY" if serving else "RESOLVED_ENTITY_NO_SERVING_PLAYER"
        return {
            "resolution_status": status,
            "player_entity_id": eid,
            "serving_player_id": serving,
            "confidence_class": "A",
            "provenance_category": "U2_PLUS_U4_NBA",
            "independent_source_count": 2,
            "quarantine_reason": None,
        }

    # Tier B
    if u2["cardinality"] == "unique" and (nba["cardinality"] == "none" or u2["playerEntityId"] == nba["playerEntityId"]):
        eid = u2["playerEntityId"]
        serving = u2["playerId"]
        status = "RESOLVED_CANONICAL_ENTITY" if serving else "RESOLVED_ENTITY_NO_SERVING_PLAYER"
        return {
            "resolution_status": status,
            "player_entity_id": eid,
            "serving_player_id": serving,
            "confidence_class": "B",
            "provenance_category": "U2_SAME_GAME",
            "independent_source_count": 1,
            "quarantine_reason": None,
        }

    # Tier C
    if u2["cardinality"] == "none" and nba["cardinality"] == "unique":
        eid = nba["playerEntityId"]
        # serving projection unknown from U4 alone in Phase 4B; entity-only if no serving_projection flag
        serving = None
        if r.get("serving_projection") and r.get("u2_player_id"):
            serving = r.get("u2_player_id")
        # Phase 4B entity-only tier C: no serving
        status = "RESOLVED_CANONICAL_ENTITY" if serving else "RESOLVED_ENTITY_NO_SERVING_PLAYER"
        return {
            "resolution_status": status,
            "player_entity_id": eid,
            "serving_player_id": serving,
            "confidence_class": "C",
            "provenance_category": "U4_NBA_STINT",
            "independent_source_count": 1,
            "quarantine_reason": None,
        }

    # D2 inferred-only
    if u2["cardinality"] == "none" and nba["cardinality"] == "none" and inf["cardinality"] == "unique":
        return {
            "resolution_status": "QUARANTINED_INFERRED_ONLY",
            "player_entity_id": None,
            "serving_player_id": None,
            "confidence_class": None,
            "provenance_category": None,
            "independent_source_count": 0,
            "quarantine_reason": "INFERRED_ONLY_NOT_ACCEPTED",
        }

    return {
        "resolution_status": "QUARANTINED_NO_SAFE_CANDIDATE",
        "player_entity_id": None,
        "serving_player_id": None,
        "confidence_class": None,
        "provenance_category": None,
        "independent_source_count": 0,
        "quarantine_reason": "NO_SAFE_CANDIDATE",
    }


def opg_id(r: dict) -> str:
    return f"{r['game_id']}|{r['team_id']}|{r['player_name_raw']}"


def make_fixture(fid: str, split: str, category: str, r: dict) -> dict:
    evidence = evidence_from_row(r)
    expected = expected_from_policy(r, evidence)
    return {
        "fixture_id": fid,
        "kind": "real",
        "split": split,
        "category": category,
        "resolver_version": RESOLVER_VERSION,
        "official_player_game_id": opg_id(r),
        "input": {
            "game_id": r["game_id"],
            "team_id": r["team_id"],
            "team_abbreviation": r["team_abbreviation"],
            "game_date_et": r["et_game_date"],
            "season": r["season"],
            "player_name_raw": r["player_name_raw"],
            "name_key": r["safe_key"],
            "ever_out": r.get("ever_out", False),
        },
        "evidence": evidence,
        "expected": expected,
        "phase4b_snapshot": {
            "u2_class": r["u2_class"],
            "u4_nba_class": r["u4_nba_class"],
            "u4_inferred_class": r["u4_inferred_class"],
            "serving_projection": r.get("serving_projection"),
        },
    }


def pick(rows: list[dict], pred, n: int) -> list[dict]:
    out = []
    for r in rows:
        if pred(r):
            out.append(r)
            if len(out) >= n:
                break
    return out


def main() -> int:
    sha = sha256_file(CAND_GZ)
    if sha != EXPECTED_SHA:
        raise SystemExit(f"Candidate SHA drift: {sha} != {EXPECTED_SHA}")

    rows = [json.loads(l) for l in gzip.open(CAND_GZ, "rt", encoding="utf-8") if l.strip()]
    assert len(rows) == 42193

    def u2u(r):
        return r["u2_class"] in ("U2_UNIQUE_PLAYED", "U2_UNIQUE_DNP_00") and r.get("u2_entity_id")

    def u4n(r):
        return r["u4_nba_class"] == "UNIQUE_CANDIDATE" and len(r.get("u4_nba_entity_ids") or []) == 1

    def u4i(r):
        return r["u4_inferred_class"] == "UNIQUE_CANDIDATE" and len(r.get("u4_inferred_entity_ids") or []) == 1

    selections = [
        # development (majority)
        ("dev-u2-played-01", "development", "u2_played_unique", pick(rows, lambda r: r["u2_class"] == "U2_UNIQUE_PLAYED", 1)[0]),
        ("dev-u2-00-01", "development", "u2_00_unique", pick(rows, lambda r: r["u2_class"] == "U2_UNIQUE_DNP_00" and u2u(r), 1)[0]),
        ("dev-tier-a-01", "development", "u2_plus_u4_nba", pick(rows, lambda r: u2u(r) and u4n(r) and r["u2_entity_id"] == r["u4_nba_entity_ids"][0], 1)[0]),
        ("dev-u2-inferred-01", "development", "u2_plus_u4_inferred", pick(rows, lambda r: u2u(r) and u4i(r) and not u4n(r), 1)[0]),
        ("dev-u2-only-01", "development", "u2_only", pick(rows, lambda r: u2u(r) and not u4n(r) and not u4i(r), 1)[0]),
        ("dev-tier-c-01", "development", "u2_absent_u4_nba", pick(rows, lambda r: (not u2u(r)) and u4n(r), 1)[0]),
        ("dev-entity-only-01", "development", "entity_only", pick(rows, lambda r: (not u2u(r)) and u4n(r) and not r.get("serving_projection") and not r.get("u2_player_id"), 1)[0]),
        ("dev-suffix-01", "development", "suffix_bearing_resolved", pick(rows, lambda r: u2u(r) and (" jr" in r["safe_key"] or " iii" in r["safe_key"]), 1)[0]),
        ("dev-no-safe-01", "development", "no_safe", pick(rows, lambda r: (not u2u(r)) and (not u4n(r)) and (not u4i(r)), 1)[0]),
        ("dev-inferred-only-01", "development", "inferred_only", pick(rows, lambda r: (not u2u(r)) and (not u4n(r)) and u4i(r), 1)[0]),
        ("dev-ever-out-no-safe-01", "development", "ever_out_no_safe", pick(rows, lambda r: r.get("ever_out") and (not u2u(r)) and (not u4n(r)) and (not u4i(r)), 1)[0]),
        ("dev-u2-played-02", "development", "u2_played_unique", pick(rows, lambda r: r["u2_class"] == "U2_UNIQUE_PLAYED", 2)[1]),
        ("dev-u2-00-02", "development", "u2_00_unique", pick(rows, lambda r: r["u2_class"] == "U2_UNIQUE_DNP_00" and u2u(r), 2)[1]),
        ("dev-tier-a-02", "development", "u2_plus_u4_nba", pick(rows, lambda r: u2u(r) and u4n(r) and r["u2_entity_id"] == r["u4_nba_entity_ids"][0], 2)[1]),
        ("dev-u2-inferred-02", "development", "u2_plus_u4_inferred", pick(rows, lambda r: u2u(r) and u4i(r) and not u4n(r), 2)[1]),
        ("dev-u2-only-02", "development", "u2_only", pick(rows, lambda r: u2u(r) and not u4n(r) and not u4i(r), 2)[1]),
        ("dev-tier-c-02", "development", "u2_absent_u4_nba", pick(rows, lambda r: (not u2u(r)) and u4n(r), 2)[1]),
        ("dev-no-safe-02", "development", "no_safe", pick(rows, lambda r: (not u2u(r)) and (not u4n(r)) and (not u4i(r)), 2)[1]),
        ("dev-inferred-only-02", "development", "inferred_only", pick(rows, lambda r: (not u2u(r)) and (not u4n(r)) and u4i(r), 2)[1]),
        ("dev-suffix-02", "development", "suffix_bearing_resolved", pick(rows, lambda r: u2u(r) and " iii" in r["safe_key"], 1)[0]),
        ("dev-ever-out-no-safe-02", "development", "ever_out_no_safe", pick(rows, lambda r: r.get("ever_out") and (not u2u(r)) and (not u4n(r)) and (not u4i(r)), 2)[1]),
        ("dev-u2-00-03", "development", "u2_00_unique", pick(rows, lambda r: r["u2_class"] == "U2_UNIQUE_DNP_00" and u2u(r) and u4i(r), 3)[2]),
        ("dev-tier-a-03", "development", "u2_plus_u4_nba", pick(rows, lambda r: u2u(r) and u4n(r) and r["u2_entity_id"] == r["u4_nba_entity_ids"][0], 3)[2]),
        ("dev-no-safe-03", "development", "no_safe", pick(rows, lambda r: (not u2u(r)) and (not u4n(r)) and (not u4i(r)), 3)[2]),
        ("dev-entity-only-02", "development", "entity_only", pick(rows, lambda r: (not u2u(r)) and u4n(r) and not r.get("serving_projection") and not r.get("u2_player_id"), 2)[1]),
        # held_out — difficult / complementary
        ("ho-u2-played-01", "held_out", "u2_played_unique", pick(rows, lambda r: r["u2_class"] == "U2_UNIQUE_PLAYED", 4)[3]),
        ("ho-u2-00-01", "held_out", "u2_00_unique", pick(rows, lambda r: r["u2_class"] == "U2_UNIQUE_DNP_00" and u2u(r), 5)[4]),
        ("ho-tier-a-01", "held_out", "u2_plus_u4_nba", pick(rows, lambda r: u2u(r) and u4n(r) and r["u2_entity_id"] == r["u4_nba_entity_ids"][0], 5)[4]),
        ("ho-u2-inferred-01", "held_out", "u2_plus_u4_inferred", pick(rows, lambda r: u2u(r) and u4i(r) and not u4n(r), 5)[4]),
        ("ho-tier-c-01", "held_out", "u2_absent_u4_nba", pick(rows, lambda r: (not u2u(r)) and u4n(r), 4)[3]),
        ("ho-entity-only-01", "held_out", "entity_only", pick(rows, lambda r: (not u2u(r)) and u4n(r) and not r.get("serving_projection") and not r.get("u2_player_id"), 3)[2]),
        ("ho-inferred-only-01", "held_out", "inferred_only", pick(rows, lambda r: (not u2u(r)) and (not u4n(r)) and u4i(r), 3)[2]),
        ("ho-no-safe-01", "held_out", "no_safe", pick(rows, lambda r: (not u2u(r)) and (not u4n(r)) and (not u4i(r)), 5)[4]),
        ("ho-ever-out-no-safe-01", "held_out", "ever_out_no_safe", pick(rows, lambda r: r.get("ever_out") and (not u2u(r)) and (not u4n(r)) and (not u4i(r)), 5)[4]),
        ("ho-suffix-01", "held_out", "suffix_bearing_resolved", pick(rows, lambda r: u2u(r) and " jr" in r["safe_key"], 5)[4]),
        ("ho-u2-only-01", "held_out", "u2_only", pick(rows, lambda r: u2u(r) and not u4n(r) and not u4i(r), 4)[3]),
        ("ho-inferred-only-02", "held_out", "inferred_only", pick(rows, lambda r: (not u2u(r)) and (not u4n(r)) and u4i(r), 4)[3]),
        ("ho-no-safe-02", "held_out", "no_safe", pick(rows, lambda r: (not u2u(r)) and (not u4n(r)) and (not u4i(r)), 8)[7]),
    ]

    # Deduplicate by opg id
    seen = set()
    fixtures = []
    for fid, split, cat, r in selections:
        oid = opg_id(r)
        if oid in seen:
            # find alternate
            continue
        seen.add(oid)
        fixtures.append(make_fixture(fid, split, cat, r))

    # Ensure we have enough by filling gaps
    need_cats = {
        "development": [
            ("u2_played_unique", lambda r: r["u2_class"] == "U2_UNIQUE_PLAYED"),
            ("u2_00_unique", lambda r: r["u2_class"] == "U2_UNIQUE_DNP_00" and u2u(r)),
            ("u2_plus_u4_nba", lambda r: u2u(r) and u4n(r) and r["u2_entity_id"] == r["u4_nba_entity_ids"][0]),
            ("u2_plus_u4_inferred", lambda r: u2u(r) and u4i(r) and not u4n(r)),
            ("u2_only", lambda r: u2u(r) and not u4n(r) and not u4i(r)),
            ("u2_absent_u4_nba", lambda r: (not u2u(r)) and u4n(r)),
            ("entity_only", lambda r: (not u2u(r)) and u4n(r) and not r.get("serving_projection") and not r.get("u2_player_id")),
            ("suffix_bearing_resolved", lambda r: u2u(r) and (" jr" in r["safe_key"] or " iii" in r["safe_key"] or " ii" in r["safe_key"])),
            ("no_safe", lambda r: (not u2u(r)) and (not u4n(r)) and (not u4i(r))),
            ("inferred_only", lambda r: (not u2u(r)) and (not u4n(r)) and u4i(r)),
            ("ever_out_no_safe", lambda r: r.get("ever_out") and (not u2u(r)) and (not u4n(r)) and (not u4i(r))),
        ],
        "held_out": [
            ("u2_played_unique", lambda r: r["u2_class"] == "U2_UNIQUE_PLAYED"),
            ("u2_00_unique", lambda r: r["u2_class"] == "U2_UNIQUE_DNP_00" and u2u(r)),
            ("u2_plus_u4_nba", lambda r: u2u(r) and u4n(r) and r["u2_entity_id"] == r["u4_nba_entity_ids"][0]),
            ("u2_plus_u4_inferred", lambda r: u2u(r) and u4i(r) and not u4n(r)),
            ("u2_only", lambda r: u2u(r) and not u4n(r) and not u4i(r)),
            ("u2_absent_u4_nba", lambda r: (not u2u(r)) and u4n(r)),
            ("entity_only", lambda r: (not u2u(r)) and u4n(r) and not r.get("serving_projection") and not r.get("u2_player_id")),
            ("suffix_bearing_resolved", lambda r: u2u(r) and (" jr" in r["safe_key"] or " iii" in r["safe_key"])),
            ("no_safe", lambda r: (not u2u(r)) and (not u4n(r)) and (not u4i(r))),
            ("inferred_only", lambda r: (not u2u(r)) and (not u4n(r)) and u4i(r)),
            ("ever_out_no_safe", lambda r: r.get("ever_out") and (not u2u(r)) and (not u4n(r)) and (not u4i(r))),
        ],
    }

    by_split_cat = defaultdict(list)
    for f in fixtures:
        by_split_cat[(f["split"], f["category"])].append(f)

    for split, specs in need_cats.items():
        for cat, pred in specs:
            if by_split_cat[(split, cat)]:
                continue
            for r in rows:
                oid = opg_id(r)
                if oid in seen:
                    continue
                if pred(r):
                    fid = f"{'dev' if split=='development' else 'ho'}-fill-{cat}"
                    fx = make_fixture(fid, split, cat, r)
                    fixtures.append(fx)
                    seen.add(oid)
                    by_split_cat[(split, cat)].append(fx)
                    break

    # Synthetic contract fixtures
    entity_a = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    entity_b = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    synthetics = [
        {
            "fixture_id": "syn-source-conflict-01",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "source_conflict",
            "resolver_version": RESOLVER_VERSION,
            "official_player_game_id": "SYN|conflict|Payton, Gary",
            "input": {
                "game_id": "SYN_GAME_1",
                "team_id": "1",
                "team_abbreviation": "SEA",
                "game_date_et": "2025-01-01",
                "season": "2024",
                "player_name_raw": "Payton, Gary",
                "name_key": "gary payton",
                "ever_out": False,
            },
            "evidence": {
                "u2": {"cardinality": "unique", "playerId": "100", "playerEntityId": entity_a, "minutes": "20"},
                "u4Nba": {"cardinality": "unique", "playerEntityId": entity_b, "source": "nba_stats"},
                "u4Inferred": {"cardinality": "none", "playerEntityId": None, "source": "inferred_pgl"},
            },
            "expected": {
                "resolution_status": "QUARANTINED_SOURCE_CONFLICT",
                "player_entity_id": None,
                "serving_player_id": None,
                "confidence_class": None,
                "provenance_category": None,
                "independent_source_count": 0,
                "quarantine_reason": "SOURCE_CONFLICT",
            },
        },
        {
            "fixture_id": "syn-multiple-u2-01",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "multiple_candidates",
            "resolver_version": RESOLVER_VERSION,
            "official_player_game_id": "SYN|multi|Doe, John",
            "input": {
                "game_id": "SYN_GAME_2",
                "team_id": "2",
                "team_abbreviation": "NYK",
                "game_date_et": "2025-01-02",
                "season": "2024",
                "player_name_raw": "Doe, John",
                "name_key": "john doe",
                "ever_out": False,
            },
            "evidence": {
                "u2": {"cardinality": "multiple", "playerId": None, "playerEntityId": None, "minutes": None},
                "u4Nba": {"cardinality": "none", "playerEntityId": None, "source": "nba_stats"},
                "u4Inferred": {"cardinality": "none", "playerEntityId": None, "source": "inferred_pgl"},
            },
            "expected": {
                "resolution_status": "QUARANTINED_MULTIPLE_CANDIDATES",
                "player_entity_id": None,
                "serving_player_id": None,
                "confidence_class": None,
                "provenance_category": None,
                "independent_source_count": 0,
                "quarantine_reason": "MULTIPLE_CANDIDATES",
            },
        },
        {
            "fixture_id": "syn-inferred-only-01",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "inferred_only",
            "resolver_version": RESOLVER_VERSION,
            "official_player_game_id": "SYN|inferred|Ghost, Player",
            "input": {
                "game_id": "SYN_GAME_3",
                "team_id": "3",
                "team_abbreviation": "LAL",
                "game_date_et": "2024-01-03",
                "season": "2023",
                "player_name_raw": "Ghost, Player",
                "name_key": "player ghost",
                "ever_out": True,
            },
            "evidence": {
                "u2": {"cardinality": "none", "playerId": None, "playerEntityId": None, "minutes": None},
                "u4Nba": {"cardinality": "none", "playerEntityId": None, "source": "nba_stats"},
                "u4Inferred": {"cardinality": "unique", "playerEntityId": entity_a, "source": "inferred_pgl"},
            },
            "expected": {
                "resolution_status": "QUARANTINED_INFERRED_ONLY",
                "player_entity_id": None,
                "serving_player_id": None,
                "confidence_class": None,
                "provenance_category": None,
                "independent_source_count": 0,
                "quarantine_reason": "INFERRED_ONLY_NOT_ACCEPTED",
            },
        },
        {
            "fixture_id": "syn-entity-only-01",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "entity_only",
            "resolver_version": RESOLVER_VERSION,
            "official_player_game_id": "SYN|entity_only|ClassC, Player",
            "input": {
                "game_id": "SYN_GAME_4",
                "team_id": "4",
                "team_abbreviation": "BOS",
                "game_date_et": "2025-11-01",
                "season": "2025",
                "player_name_raw": "ClassC, Player",
                "name_key": "player classc",
                "ever_out": True,
            },
            "evidence": {
                "u2": {"cardinality": "none", "playerId": None, "playerEntityId": None, "minutes": None},
                "u4Nba": {"cardinality": "unique", "playerEntityId": entity_a, "source": "nba_stats"},
                "u4Inferred": {"cardinality": "none", "playerEntityId": None, "source": "inferred_pgl"},
                "servingPlayerId": None,
            },
            "expected": {
                "resolution_status": "RESOLVED_ENTITY_NO_SERVING_PLAYER",
                "player_entity_id": entity_a,
                "serving_player_id": None,
                "confidence_class": "C",
                "provenance_category": "U4_NBA_STINT",
                "independent_source_count": 1,
                "quarantine_reason": None,
            },
        },
        {
            "fixture_id": "syn-suffix-collision-payton",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "suffix_collision",
            "resolver_version": RESOLVER_VERSION,
            "official_player_game_id": "SYN|suffix|Payton II, Gary",
            "input": {
                "game_id": "SYN_GAME_5",
                "team_id": "5",
                "team_abbreviation": "GSW",
                "game_date_et": "2025-02-01",
                "season": "2024",
                "player_name_raw": "Payton II, Gary",
                "name_key": "gary payton ii",
                "ever_out": False,
            },
            "evidence": {
                "u2": {
                    "cardinality": "unique",
                    "playerId": "200",
                    "playerEntityId": entity_b,
                    "minutes": "18",
                },
                "u4Nba": {"cardinality": "none", "playerEntityId": None, "source": "nba_stats"},
                "u4Inferred": {"cardinality": "none", "playerEntityId": None, "source": "inferred_pgl"},
                "suffix_collision_peer": {
                    "player_name_raw": "Payton, Gary",
                    "name_key": "gary payton",
                    "note": "Must remain distinct from gary payton ii; stripping would collide",
                },
            },
            "expected": {
                "resolution_status": "RESOLVED_CANONICAL_ENTITY",
                "player_entity_id": entity_b,
                "serving_player_id": "200",
                "confidence_class": "B",
                "provenance_category": "U2_SAME_GAME",
                "independent_source_count": 1,
                "quarantine_reason": None,
                "name_key_must_equal": "gary payton ii",
                "name_key_must_not_equal_peer": "gary payton",
            },
        },
        {
            "fixture_id": "syn-name-unsafe-01",
            "kind": "synthetic",
            "split": "synthetic",
            "category": "name_unsafe",
            "resolver_version": RESOLVER_VERSION,
            "official_player_game_id": "SYN|unsafe|",
            "input": {
                "game_id": "SYN_GAME_6",
                "team_id": "6",
                "team_abbreviation": "CHI",
                "game_date_et": "2025-03-01",
                "season": "2024",
                "player_name_raw": "   ",
                "name_key": "",
                "ever_out": False,
            },
            "evidence": {
                "u2": {"cardinality": "none", "playerId": None, "playerEntityId": None, "minutes": None},
                "u4Nba": {"cardinality": "none", "playerEntityId": None, "source": "nba_stats"},
                "u4Inferred": {"cardinality": "none", "playerEntityId": None, "source": "inferred_pgl"},
            },
            "expected": {
                "resolution_status": "QUARANTINED_NAME_UNSAFE",
                "player_entity_id": None,
                "serving_player_id": None,
                "confidence_class": None,
                "provenance_category": None,
                "independent_source_count": 0,
                "quarantine_reason": "NAME_KEY_UNSAFE",
            },
        },
    ]

    for s in synthetics:
        fixtures.append(s)

    # Write files
    for sub in ("development", "held_out", "synthetic"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
        # clear old
        for p in (OUT / sub).glob("*.json"):
            p.unlink()

    for f in fixtures:
        split = f["split"]
        path = OUT / split / f"{f['fixture_id']}.json"
        path.write_text(json.dumps(f, indent=2) + "\n", encoding="utf-8")

    manifest = {
        "locked_at": "2026-09-17T15:00:00.000Z",
        "phase": "4D.0",
        "resolver_version": RESOLVER_VERSION,
        "candidate_records_sha256": sha,
        "candidate_records_count": 42193,
        "policy": "Phase 4C conservative D2; expectations derived from evidence without resolver code",
        "counts": {
            "development": sum(1 for f in fixtures if f["split"] == "development"),
            "held_out": sum(1 for f in fixtures if f["split"] == "held_out"),
            "synthetic": sum(1 for f in fixtures if f["split"] == "synthetic"),
            "total": len(fixtures),
        },
        "fixtures": [
            {
                "fixture_id": f["fixture_id"],
                "kind": f["kind"],
                "split": f["split"],
                "category": f["category"],
                "official_player_game_id": f.get("official_player_game_id"),
                "expected_resolution_status": f["expected"]["resolution_status"],
            }
            for f in fixtures
        ],
        "note": "Held-out expectations must not change to make implementation pass.",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["counts"], indent=2))
    print("categories_dev", sorted({f['category'] for f in fixtures if f['split']=='development'}))
    print("categories_ho", sorted({f['category'] for f in fixtures if f['split']=='held_out'}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
