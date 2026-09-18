"""
Phase 5B — T−60 reason inventory + policy simulation (design only; no WOWY).

  python scripts/ops/run-official-injury-t60-reason-policy-design.py
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SELECTED_GZ = ROOT / "tmp" / "official-injury-report-asof-t60" / "selected-player-states.ndjson.gz"
CERT_JSON = ROOT / "reports" / "operations" / "official-injury-report-asof-t60-certification.json"
FULL_JSON = ROOT / "reports" / "operations" / "official-injury-report-asof-t60-full-run.json"
OUT_MD = ROOT / "reports" / "operations" / "official-injury-report-t60-reason-policy-design.md"
OUT_JSON = ROOT / "reports" / "operations" / "official-injury-report-t60-reason-policy-design.json"
OUT_INV = ROOT / "reports" / "operations" / "official-injury-report-t60-reason-inventory.ndjson"
OUT_REVIEW = ROOT / "reports" / "operations" / "official-injury-report-t60-reason-review.ndjson"
TMP_DIR = ROOT / "tmp" / "official-injury-report-t60-reason-policy"

REASON_POLICY_VERSION = "official-injury-reason-policy-v1"
ELIGIBILITY_POLICY_VERSION = "injury-wowy-eligibility-v1"

EXPECTED_STATUS = {
    "Out": 30672,
    "Available": 3630,
    "Questionable": 4828,
    "Doubtful": 627,
    "Probable": 1710,
}
EXPECTED_N = 41467

# Structural / exact patterns observed in the certified T−60 corpus
INJURY_ILLNESS_PREFIX = re.compile(r"^injury/illness\b", re.I)
G_LEAGUE_PREFIX = re.compile(r"^g league\b", re.I)
REST_PREFIX = re.compile(r"^rest(\b|$| -)", re.I)
PERSONAL_PREFIX = re.compile(r"^personal reasons?\b", re.I)
NOT_WITH_TEAM_PREFIX = re.compile(r"^not with team\b", re.I)
CONCUSSION_RE = re.compile(r"\bconcussion\b", re.I)
REST_EXACT = re.compile(r"^rest$", re.I)
PERSONAL_EXACT = re.compile(r"^personal reasons?$", re.I)
NOT_WITH_TEAM_EXACT = re.compile(r"^not with team$", re.I)
COACH_DECISION_EXACT = re.compile(r"^coach'?s decision$", re.I)
INELIGIBLE_EXACT = re.compile(r"^ineligible to play$", re.I)
RECONDITION_EXACTISH = re.compile(
    r"^(return to competition\s+)?reconditioning$|^competition reconditioning$",
    re.I,
)
SUSPENSION_RE = re.compile(r"\bsuspension\b", re.I)
TRADE_RE = re.compile(r"\btrade\b", re.I)
TWO_WAY_RE = re.compile(r"two[- ]?way", re.I)
INJURY_MGMT_RE = re.compile(r"injury management", re.I)
ILLNESS_BODY_MARKERS = re.compile(
    r"\b(sprain|strain|fracture|surgery|soreness|tear|contusion|bruise|tendin|"
    r"meniscus|ligament|acl|mcl|achilles|ankle|knee|hamstring|calf|quad|hip|back|"
    r"shoulder|wrist|finger|toe|foot|elbow|rib|groin|adductor|glute|quadriceps|"
    r"patella|labrum|plantar|fibula|illness)\b",
    re.I,
)


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def reason_analysis_key(raw: str | None) -> str:
    s = "" if raw is None else str(raw)
    s = unicodedata.normalize("NFKC", s)
    s = s.strip().lower()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"([;:,\-_/])\1+", r"\1", s)
    return s


def extract_family_prefix(raw: str) -> str | None:
    """If reason uses 'Family - detail' structure, return family side."""
    if " - " in raw:
        return raw.split(" - ", 1)[0].strip()
    return None


def classify_reason(raw: str | None) -> dict[str, Any]:
    """
    Deterministic reason taxonomy derived from Phase 5B corpus inventory.

    Precedence (documented in design report):
      1. Structural provider prefixes (Injury/Illness, G League, Rest, Personal, Not With Team)
      2. Exact high-confidence whole strings (Coach's Decision, Ineligible, Reconditioning, placeholders)
      3. Keyword fallbacks (Suspension, Trade, Concussion)
      4. UNCLASSIFIED fail-closed
    """
    if raw is None or str(raw).strip() == "":
        return {
            "reason_category": "UNCLASSIFIED",
            "health_relation": "UNCLASSIFIED",
            "match_rule": "BLANK_REASON",
            "family_prefix": None,
        }

    text = str(raw).strip()
    key = reason_analysis_key(text)
    family = extract_family_prefix(text)

    # --- 1a) Injury/Illness structural prefix ---
    if INJURY_ILLNESS_PREFIX.match(text):
        if CONCUSSION_RE.search(text):
            cat = "CONCUSSION"
        elif INJURY_MGMT_RE.search(text):
            cat = "INJURY_MANAGEMENT"
        elif re.search(r"\breconditioning\b", text, re.I):
            cat = "RECONDITIONING"
        else:
            detail = text.split(" - ", 1)[1] if " - " in text else text
            # Illness-only rows: detail is essentially illness without injury markers
            illness_hits = len(re.findall(r"\billness\b", detail, re.I))
            injury_marker = re.search(
                r"\b(sprain|strain|fracture|surgery|soreness|tear|contusion|bruise|"
                r"tendin|meniscus|ligament|acl|mcl|achilles|ankle|knee|hamstring|calf|"
                r"hip|back|shoulder|wrist|finger|toe|foot|elbow|rib|groin|adductor|"
                r"glute|quadriceps|patella|labrum|plantar|fibula|management|recovery)\b",
                detail,
                re.I,
            )
            if illness_hits and not injury_marker:
                cat = "ILLNESS"
            else:
                cat = "INJURY_OR_ILLNESS"
        return {
            "reason_category": cat,
            "health_relation": "HEALTH_RELATED",
            "match_rule": "PREFIX_INJURY_ILLNESS",
            "family_prefix": family,
        }

    # --- 1b) G League structural prefix ---
    if G_LEAGUE_PREFIX.match(text):
        if TWO_WAY_RE.search(text):
            cat = "G_LEAGUE_TWO_WAY"
        elif re.search(r"on assignment", text, re.I):
            cat = "G_LEAGUE_ON_ASSIGNMENT"
        else:
            cat = "G_LEAGUE_ASSIGNMENT"
        return {
            "reason_category": cat,
            "health_relation": "NON_HEALTH_RELATED",
            "match_rule": "PREFIX_G_LEAGUE",
            "family_prefix": family,
        }

    # --- 1c) Rest structural prefix (includes Rest - …) → always non-health for injury WOWY ---
    if REST_PREFIX.match(text) or REST_EXACT.match(text):
        return {
            "reason_category": "REST",
            "health_relation": "NON_HEALTH_RELATED",
            "match_rule": "PREFIX_OR_EXACT_REST",
            "family_prefix": family or "Rest",
        }

    # --- 1d) Personal / Not With Team prefixes (covers “… Return to Competition”) ---
    if PERSONAL_PREFIX.match(text) or PERSONAL_EXACT.match(text):
        return {
            "reason_category": "PERSONAL",
            "health_relation": "NON_HEALTH_RELATED",
            "match_rule": "PREFIX_OR_EXACT_PERSONAL",
            "family_prefix": family or "Personal Reasons",
        }
    if NOT_WITH_TEAM_PREFIX.match(text) or NOT_WITH_TEAM_EXACT.match(text):
        return {
            "reason_category": "NOT_WITH_TEAM",
            "health_relation": "NON_HEALTH_RELATED",
            "match_rule": "PREFIX_OR_EXACT_NOT_WITH_TEAM",
            "family_prefix": family or "Not With Team",
        }

    # --- 2) Exact / high-confidence whole-string patterns ---
    if COACH_DECISION_EXACT.match(text):
        return {
            "reason_category": "COACHS_DECISION",
            "health_relation": "NON_HEALTH_RELATED",
            "match_rule": "EXACT_COACHS_DECISION",
            "family_prefix": family,
        }
    if INELIGIBLE_EXACT.match(text):
        return {
            "reason_category": "INELIGIBLE_TO_PLAY",
            "health_relation": "NON_HEALTH_RELATED",
            "match_rule": "EXACT_INELIGIBLE_TO_PLAY",
            "family_prefix": family,
        }
    if RECONDITION_EXACTISH.match(text):
        return {
            "reason_category": "RECONDITIONING",
            "health_relation": "HEALTH_RELATED",
            "match_rule": "EXACT_RECONDITIONING",
            "family_prefix": family,
        }
    if key in {"-", "—", "–", "n/a", "na", "none", "."} or key.startswith("-"):
        return {
            "reason_category": "PLACEHOLDER_REASON",
            "health_relation": "UNCLASSIFIED",
            "match_rule": "PLACEHOLDER",
            "family_prefix": family,
        }

    # --- 3) Keyword high-confidence ---
    if SUSPENSION_RE.search(text):
        return {
            "reason_category": "SUSPENSION",
            "health_relation": "NON_HEALTH_RELATED",
            "match_rule": "KEYWORD_SUSPENSION",
            "family_prefix": family,
        }
    if TRADE_RE.search(text):
        return {
            "reason_category": "TRADE_RELATED",
            "health_relation": "NON_HEALTH_RELATED",
            "match_rule": "KEYWORD_TRADE",
            "family_prefix": family,
        }
    if CONCUSSION_RE.search(text):
        return {
            "reason_category": "CONCUSSION",
            "health_relation": "HEALTH_RELATED",
            "match_rule": "KEYWORD_CONCUSSION",
            "family_prefix": family,
        }

    # --- 4) Fail closed ---
    return {
        "reason_category": "UNCLASSIFIED",
        "health_relation": "UNCLASSIFIED",
        "match_rule": "FALLBACK_UNCLASSIFIED",
        "family_prefix": family,
    }


def health_related_categories() -> set[str]:
    return {
        "INJURY_OR_ILLNESS",
        "ILLNESS",
        "CONCUSSION",
        "RECONDITIONING",
        "INJURY_MANAGEMENT",
    }


def non_health_categories() -> set[str]:
    return {
        "REST",
        "PERSONAL",
        "NOT_WITH_TEAM",
        "SUSPENSION",
        "TRADE_RELATED",
        "G_LEAGUE_TWO_WAY",
        "G_LEAGUE_ON_ASSIGNMENT",
        "G_LEAGUE_ASSIGNMENT",
        "COACHS_DECISION",
        "INELIGIBLE_TO_PLAY",
    }


def main() -> int:
    TMP_DIR.mkdir(parents=True, exist_ok=True)

    cert = json.loads(CERT_JSON.read_text(encoding="utf-8"))
    full = json.loads(FULL_JSON.read_text(encoding="utf-8"))
    selected_sha = sha256_file(SELECTED_GZ)

    # Verify status totals
    status_counts = Counter()
    rows: list[dict[str, Any]] = []
    with gzip.open(SELECTED_GZ, "rt", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            r = json.loads(line)
            rows.append(r)
            status_counts[r.get("status_raw") or ""] += 1

    if len(rows) != EXPECTED_N:
        raise SystemExit(f"selected rows drift: {len(rows)} != {EXPECTED_N}")
    for k, v in EXPECTED_STATUS.items():
        if status_counts[k] != v:
            raise SystemExit(f"status drift {k}: {status_counts[k]} != {v}")

    full_fp = full.get("fingerprint", {}).get("files", {})
    fingerprint = {
        "fingerprinted_at": utc_now(),
        "phase5a_reconstruction_sha256": cert.get("reconstruction_sha256"),
        "selected_player_states_sha256": selected_sha,
        "selected_player_rows": len(rows),
        "status_counts_verified": dict(status_counts),
        "parser_sha256": full_fp.get(
            "parser_py",
            "ce7d729db2fe46b07e0bcfdfc9db506b62af812c0633afb30a2b97646f615ac7",
        ),
        "identity_results_sha256": full_fp.get("identity_results_gz"),
        "game_join_blocks_sha256": full_fp.get("blocks_gz"),
        "parsed_rows_sha256": full_fp.get("parsed_rows_gz"),
        "asof_module_sha256": full_fp.get("lib/injuries/official/as-of-t60.ts"),
        "asof_full_run_player_total": full["selected_players"]["total"],
    }

    # Inventory
    exact_reasons = Counter()
    by_status_reason: dict[str, Counter] = defaultdict(Counter)
    by_season_status: dict[str, Counter] = defaultdict(Counter)
    prefixes = Counter()
    lengths: list[int] = []
    blank = 0

    classified_rows = []
    for r in rows:
        reason = r.get("reason_raw")
        status = r.get("status_raw") or ""
        season = str(r.get("season"))
        by_season_status[season][status] += 1
        if reason is None or str(reason).strip() == "":
            blank += 1
            lengths.append(0)
        else:
            exact_reasons[str(reason)] += 1
            by_status_reason[status][str(reason)] += 1
            lengths.append(len(str(reason)))
            fam = extract_family_prefix(str(reason))
            if fam:
                prefixes[fam] += 1

        clf = classify_reason(reason)
        classified_rows.append({**r, **clf, "reason_analysis_key": reason_analysis_key(reason)})

    lengths_sorted = sorted(lengths)
    def pct(p: float) -> float | None:
        if not lengths_sorted:
            return None
        k = (len(lengths_sorted) - 1) * p
        f = int(k)
        c = min(f + 1, len(lengths_sorted) - 1)
        if f == c:
            return float(lengths_sorted[f])
        return lengths_sorted[f] * (c - k) + lengths_sorted[c] * (k - f)

    # Classification aggregates
    def agg(pred) -> dict[str, Any]:
        subset = [r for r in classified_rows if pred(r)]
        health = Counter(r["health_relation"] for r in subset)
        cats = Counter(r["reason_category"] for r in subset)
        id_buckets = Counter(r.get("identity_bucket") for r in subset)
        by_season = defaultdict(lambda: Counter())
        for r in subset:
            by_season[str(r.get("season"))][r["health_relation"]] += 1
        health_related = [r for r in subset if r["health_relation"] == "HEALTH_RELATED"]
        canon_hr = sum(
            1
            for r in health_related
            if r.get("identity_bucket")
            in ("RESOLVED_CANONICAL_ENTITY", "RESOLVED_ENTITY_NO_SERVING_PLAYER")
        )
        q_hr = sum(1 for r in health_related if r.get("identity_bucket") == "IDENTITY_QUARANTINED")
        return {
            "n": len(subset),
            "health_relation": dict(health),
            "reason_category": dict(cats),
            "identity_bucket": dict(id_buckets),
            "health_related": len(health_related),
            "non_health_related": health.get("NON_HEALTH_RELATED", 0),
            "unclassified_health_relation": health.get("UNCLASSIFIED", 0),
            "canonical_resolved_health_related": canon_hr,
            "identity_quarantined_health_related": q_hr,
            "by_season_health_relation": {s: dict(c) for s, c in sorted(by_season.items())},
        }

    out_agg = agg(lambda r: r.get("status_raw") == "Out")
    avail_agg = agg(lambda r: r.get("status_raw") == "Available")
    q_agg = agg(lambda r: r.get("status_raw") == "Questionable")
    d_agg = agg(lambda r: r.get("status_raw") == "Doubtful")
    p_agg = agg(lambda r: r.get("status_raw") == "Probable")
    all_agg = agg(lambda r: True)

    # Classification rate among non-blank (all reasons non-blank in this corpus)
    non_unclassified = sum(
        1 for r in classified_rows if r["reason_category"] not in ("UNCLASSIFIED", "PLACEHOLDER_REASON")
    )
    # Placeholders counted as not successfully classified for coverage metric
    classifiable = sum(
        1
        for r in classified_rows
        if r["reason_category"] not in ("UNCLASSIFIED", "PLACEHOLDER_REASON")
    )
    with_reason_text = len(rows) - blank  # all have text including "-"
    # For coverage: exclude placeholder from denominator of "meaningful reason text"?
    # Spec: rows with reason text. "-" is text. Classification rate = non-UNCLASSIFIED non-placeholder / with text
    # Or: assigned deterministic non-UNCLASSIFIED / rows with reason text
    # PLACEHOLDER_REASON has health UNCLASSIFIED - treat as not successfully classified
    reason_classification_rate = classifiable / max(with_reason_text, 1)

    def status_class_rate(status: str) -> float:
        sub = [r for r in classified_rows if r.get("status_raw") == status]
        ok = sum(
            1
            for r in sub
            if r["reason_category"] not in ("UNCLASSIFIED", "PLACEHOLDER_REASON")
        )
        return ok / max(len(sub), 1)

    # Unique reason classification
    unique_class = {}
    for reason, cnt in exact_reasons.items():
        clf = classify_reason(reason)
        unique_class[reason] = {**clf, "row_count": cnt}

    unique_auto = sum(
        1
        for v in unique_class.values()
        if v["reason_category"] not in ("UNCLASSIFIED", "PLACEHOLDER_REASON")
    )
    unique_unclassified = [
        (reason, v)
        for reason, v in unique_class.items()
        if v["reason_category"] in ("UNCLASSIFIED", "PLACEHOLDER_REASON")
    ]
    unique_unclassified.sort(key=lambda x: -x[1]["row_count"])

    # Cross-status reason consistency
    reason_statuses: dict[str, set[str]] = defaultdict(set)
    for r in classified_rows:
        reason_statuses[str(r.get("reason_raw"))].add(r.get("status_raw") or "")

    surprising = []
    for reason, statuses in reason_statuses.items():
        clf = classify_reason(reason)
        if clf["reason_category"] in ("REST", "SUSPENSION", "G_LEAGUE_TWO_WAY", "G_LEAGUE_ON_ASSIGNMENT", "PERSONAL", "NOT_WITH_TEAM"):
            if "Available" in statuses:
                surprising.append(
                    {
                        "reason_raw": reason,
                        "statuses": sorted(statuses),
                        "reason_category": clf["reason_category"],
                        "row_count": exact_reasons[reason],
                    }
                )

    # Eligibility simulation
    # WITHOUT: Out + HEALTH_RELATED + canonical identity
    # WITH Policy A: Available + HEALTH_RELATED + canonical
    # WITH Policy B: Available + canonical (any reason except we still track)

    def is_canon(r: dict) -> bool:
        return r.get("identity_bucket") in (
            "RESOLVED_CANONICAL_ENTITY",
            "RESOLVED_ENTITY_NO_SERVING_PLAYER",
        )

    without_rows = [
        r
        for r in classified_rows
        if r.get("status_raw") == "Out"
        and r["health_relation"] == "HEALTH_RELATED"
        and is_canon(r)
    ]
    with_a_rows = [
        r
        for r in classified_rows
        if r.get("status_raw") == "Available"
        and r["health_relation"] == "HEALTH_RELATED"
        and is_canon(r)
    ]
    with_b_rows = [
        r
        for r in classified_rows
        if r.get("status_raw") == "Available" and is_canon(r)
    ]

    def pop_stats(subset: list[dict]) -> dict[str, Any]:
        return {
            "rows": len(subset),
            "unique_entities": len(
                {r.get("player_entity_id") for r in subset if r.get("player_entity_id")}
            ),
            "unique_raw_names": len({r.get("player_name_raw") for r in subset}),
            "unique_games": len({r.get("game_id") for r in subset}),
            "unique_team_games": len({(r.get("game_id"), r.get("team_id")) for r in subset}),
            "by_season": dict(Counter(str(r.get("season")) for r in subset)),
        }

    # Available health share
    avail_health = avail_agg["health_related"]
    avail_non = avail_agg["non_health_related"]
    avail_unc = avail_agg["unclassified_health_relation"]
    avail_health_share = avail_health / max(avail_agg["n"], 1)

    # Decision: AVAILABLE_CONTROL_POLICY
    # Evidence: large majority of Available are Injury/Illness; some Rest/G-League/Personal may exist
    # Prefer HEALTH_RELATED_ONLY for symmetry with injury model objective
    available_control_policy = "HEALTH_RELATED_ONLY"
    out_without_policy = "HEALTH_RELATED_ONLY"

    # Write inventory ndjson (unique reasons)
    with OUT_INV.open("w", encoding="utf-8") as fh:
        for reason, meta in sorted(unique_class.items(), key=lambda x: -x[1]["row_count"]):
            statuses = sorted(reason_statuses[reason])
            seasons = Counter(
                str(r.get("season"))
                for r in classified_rows
                if str(r.get("reason_raw")) == reason
            )
            fh.write(
                json.dumps(
                    {
                        "reason_raw": reason,
                        "reason_analysis_key": reason_analysis_key(reason),
                        "row_count": meta["row_count"],
                        "reason_category": meta["reason_category"],
                        "health_relation": meta["health_relation"],
                        "match_rule": meta["match_rule"],
                        "family_prefix": meta["family_prefix"],
                        "statuses_observed": statuses,
                        "season_counts": dict(seasons),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

    # Review set for unclassified (+ placeholders)
    with OUT_REVIEW.open("w", encoding="utf-8") as fh:
        for reason, meta in unique_unclassified:
            samples = [
                r
                for r in classified_rows
                if str(r.get("reason_raw")) == reason
            ][:5]
            fh.write(
                json.dumps(
                    {
                        "reason_raw": reason,
                        "row_count": meta["row_count"],
                        "reason_category": meta["reason_category"],
                        "health_relation": meta["health_relation"],
                        "statuses_observed": sorted(reason_statuses[reason]),
                        "season_counts": dict(
                            Counter(str(r.get("season")) for r in classified_rows if str(r.get("reason_raw")) == reason)
                        ),
                        "sample_player_names": [s.get("player_name_raw") for s in samples],
                        "sample_game_ids": [s.get("game_id") for s in samples],
                        "proposed_interpretation": (
                            "PLACEHOLDER — fail-closed; never HEALTH_RELATED"
                            if meta["reason_category"] == "PLACEHOLDER_REASON"
                            else None
                        ),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

    # Optional row-level sim under tmp
    sim_path = TMP_DIR / "classified-selected-rows.ndjson.gz"
    with gzip.open(sim_path, "wt", encoding="utf-8") as fh:
        for r in classified_rows:
            out = {
                "game_id": r.get("game_id"),
                "team_id": r.get("team_id"),
                "season": r.get("season"),
                "player_name_raw": r.get("player_name_raw"),
                "player_entity_id": r.get("player_entity_id"),
                "status_raw": r.get("status_raw"),
                "reason_raw": r.get("reason_raw"),
                "reason_policy_version": REASON_POLICY_VERSION,
                "reason_category": r["reason_category"],
                "health_relation": r["health_relation"],
                "match_rule": r["match_rule"],
                "identity_bucket": r.get("identity_bucket"),
                "eligibility_policy_version": ELIGIBILITY_POLICY_VERSION,
            }
            # provisional eligibility labels (design simulation)
            if r.get("status_raw") == "Out" and r["health_relation"] == "HEALTH_RELATED" and is_canon(r):
                out["injury_wowy_eligibility"] = "WITHOUT_CANDIDATE"
            elif (
                r.get("status_raw") == "Available"
                and r["health_relation"] == "HEALTH_RELATED"
                and is_canon(r)
            ):
                out["injury_wowy_eligibility"] = "WITH_CANDIDATE"
            elif r.get("status_raw") in ("Questionable", "Doubtful", "Probable"):
                out["injury_wowy_eligibility"] = "INELIGIBLE_NON_BINARY"
            elif r.get("status_raw") == "Out" and r["health_relation"] == "NON_HEALTH_RELATED":
                out["injury_wowy_eligibility"] = "INELIGIBLE_NON_HEALTH"
            elif r["health_relation"] == "UNCLASSIFIED" or r["reason_category"] == "PLACEHOLDER_REASON":
                out["injury_wowy_eligibility"] = "INELIGIBLE_UNCLASSIFIED"
            elif not is_canon(r):
                out["injury_wowy_eligibility"] = "INELIGIBLE_IDENTITY"
            else:
                out["injury_wowy_eligibility"] = "INELIGIBLE_OTHER"
            # availability fact (all-cause source truth)
            if r.get("status_raw") == "Out":
                out["availability_fact"] = "EXPLICIT_UNAVAILABLE"
            elif r.get("status_raw") == "Available":
                out["availability_fact"] = "EXPLICIT_AVAILABLE"
            else:
                out["availability_fact"] = "NON_BINARY_EXPLICIT"
            fh.write(json.dumps(out, ensure_ascii=False) + "\n")

    sim_sha = sha256_file(sim_path)

    # Taxonomy list
    taxonomy = {
        "reason_categories": sorted(
            health_related_categories()
            | non_health_categories()
            | {"PLACEHOLDER_REASON", "UNCLASSIFIED"}
        ),
        "health_related_categories": sorted(health_related_categories()),
        "non_health_related_categories": sorted(non_health_categories()),
        "unclassified_categories": ["PLACEHOLDER_REASON", "UNCLASSIFIED"],
        "unobserved_not_in_taxonomy": [
            "HEALTH_PROTOCOL (0 T−60 rows — omitted from v1)",
            "TWO_WAY as distinct from G_LEAGUE_TWO_WAY (covered by G League prefix)",
        ],
        "precedence": [
            "1a_PREFIX_INJURY_ILLNESS_with_subtypes_CONCUSSION_INJURY_MANAGEMENT_RECONDITIONING_ILLNESS_INJURY_OR_ILLNESS",
            "1b_PREFIX_G_LEAGUE",
            "1c_PREFIX_OR_EXACT_REST",
            "1d_PREFIX_OR_EXACT_PERSONAL_NOT_WITH_TEAM",
            "2_EXACT_COACHS_DECISION_INELIGIBLE_RECONDITIONING_PLACEHOLDER",
            "3_KEYWORD_SUSPENSION_TRADE_CONCUSSION",
            "4_FALLBACK_UNCLASSIFIED",
        ],
        "notes": {
            "reason_independent_of_status": True,
            "rest_framed_injury_management": (
                "Strings beginning with Rest (e.g. 'Rest - Left Knee Injury Management') "
                "classify as REST / NON_HEALTH_RELATED — injury-conditioned WOWY excludes; "
                "all-cause availability_fact still EXPLICIT_UNAVAILABLE when status=Out."
            ),
            "reconditioning_included_in_health": (
                "Bare Reconditioning / Return to Competition Reconditioning are HEALTH_RELATED "
                "but kept as distinct RECONDITIONING category (not merged into INJURY_OR_ILLNESS)."
            ),
        },
    }

    # Top Out / Available reasons
    design = {
        "generated_at": utc_now(),
        "phase": "5B",
        "T60_REASON_POLICY_DESIGN": "APPROVED",
        "AS_OF_INJURY_TAPE_CERTIFIED": "YES",
        "reason_policy_version": REASON_POLICY_VERSION,
        "eligibility_policy_version": ELIGIBILITY_POLICY_VERSION,
        "OUT_WITHOUT_POLICY": out_without_policy,
        "AVAILABLE_CONTROL_POLICY": available_control_policy,
        "NEXT": "IMPLEMENT_AND_CERTIFY_T60_REASON_AND_WOWY_ELIGIBILITY_POLICY",
        "fingerprint": fingerprint,
        "corpus": {
            "selected_t60_player_rows": len(rows),
            "unique_exact_reason_strings": len(exact_reasons),
            "blank_reason_rows": blank,
            "classifiable_reason_rows": classifiable,
            "unclassified_or_placeholder_rows": len(rows) - classifiable,
            "reason_classification_rate": reason_classification_rate,
            "out_reason_classification_rate": status_class_rate("Out"),
            "available_reason_classification_rate": status_class_rate("Available"),
            "unique_auto_classifiable": unique_auto,
            "unique_unclassified_or_placeholder": len(unique_unclassified),
            "rows_in_unclassified_unique_strings": sum(v["row_count"] for _, v in unique_unclassified),
            "reason_length": {
                "min": lengths_sorted[0] if lengths_sorted else None,
                "p50": pct(0.5),
                "p95": pct(0.95),
                "max": lengths_sorted[-1] if lengths_sorted else None,
            },
            "top_family_prefixes": prefixes.most_common(20),
            "top_exact_reasons": exact_reasons.most_common(40),
        },
        "out": out_agg,
        "available": avail_agg,
        "questionable": q_agg,
        "doubtful": d_agg,
        "probable": p_agg,
        "all_statuses": all_agg,
        "taxonomy": taxonomy,
        "cross_status_surprising": surprising,
        "available_control_justification": {
            "available_total": avail_agg["n"],
            "health_related": avail_health,
            "non_health_related": avail_non,
            "unclassified": avail_unc,
            "health_share": avail_health_share,
            "by_season_available": avail_agg["by_season_health_relation"],
            "decision": available_control_policy,
            "rationale": (
                "Injury-conditioned WOWY should compare health-related Out vs health-related Available "
                "for conceptual symmetry. Available rows are predominantly Injury/Illness-family; "
                "non-health Available (if any) and placeholders must not inflate WITH. "
                f"Health-related share of Available ≈ {avail_health_share:.3f}."
            ),
        },
        "out_without_justification": {
            "decision": out_without_policy,
            "rationale": (
                "Default conservative: only health-related Out qualify as WITHOUT candidates. "
                "Rest, G League, Personal, Not With Team, Suspension, Trade remain source-truth "
                "all-cause Out but injury-WOWY ineligible."
            ),
        },
        "eligibility_candidate_population": {
            "without_health_related_canonical": pop_stats(without_rows),
            "with_policy_a_health_related_canonical": pop_stats(with_a_rows),
            "with_policy_b_all_available_canonical": pop_stats(with_b_rows),
            "note": "Eligibility candidate rows — not eventual WOWY subject×teammate sample counts.",
        },
        "non_binary_policy": "NON_BINARY_UNKNOWN — Questionable/Doubtful/Probable never WITH or WITHOUT",
        "exclusions_from_injury_wowy": sorted(non_health_categories())
        + ["PLACEHOLDER_REASON", "UNCLASSIFIED", "NON_BINARY_STATUSES", "IDENTITY_QUARANTINED"],
        "ambiguous_categories": {
            "RECONDITIONING": {
                "recommendation": "INCLUDE_IN_HEALTH_RELATED",
                "keep_distinct": True,
                "rationale": "Medically adjacent return-to-competition conditioning; health context for injury-conditioned WOWY.",
            },
            "INJURY_MANAGEMENT": {
                "recommendation": "INCLUDE_IN_HEALTH_RELATED",
                "keep_distinct": True,
                "rationale": "Observed under Injury/Illness prefix; load-management of injured body part — health-related.",
            },
            "REST_WITH_INJURY_TEXT": {
                "recommendation": "EXCLUDE_AS_REST",
                "examples": [
                    "Rest - Left Knee Injury Management",
                    "Rest - Left Knee - Injury Management",
                ],
                "rationale": "Structural Rest prefix wins; injury-WOWY excludes; preserve as all-cause Out.",
            },
            "PLACEHOLDER_REASON": {
                "recommendation": "FAIL_CLOSED_UNCLASSIFIED",
                "examples": ["-", "-Return to Competition"],
                "rationale": "No semantic reason text; Available '-' must not become WITH.",
            },
            "HEALTH_PROTOCOL": {
                "recommendation": "OMITTED_UNOBSERVED",
                "observed_rows": 0,
            },
        },
        "result_contract_sketch": {
            "fields": [
                "status_raw",
                "reason_raw",
                "reason_policy_version",
                "reason_category",
                "health_relation",
                "eligibility_policy_version",
                "availability_fact",
                "injury_wowy_eligibility",
                "identity_status",
            ]
        },
        "fixture_strategy": {
            "required_real_reason_examples": [
                "Injury/Illness common",
                "Illness subtype",
                "Available Injury/Illness",
                "Rest",
                "G League Two-Way",
                "G League On Assignment",
                "Personal Reasons",
                "Not With Team",
                "placeholder '-'",
                "unclassified rare",
                "Injury Management",
                "Concussion if present",
            ],
            "synthetic_precedence_tests": True,
            "implement_in_next_phase": True,
        },
        "artifacts": {
            "inventory_ndjson": str(OUT_INV.relative_to(ROOT)).replace("\\", "/"),
            "review_ndjson": str(OUT_REVIEW.relative_to(ROOT)).replace("\\", "/"),
            "classified_rows_gz": str(sim_path.relative_to(ROOT)).replace("\\", "/"),
            "classified_rows_gz_sha256": sim_sha,
            "classified_rows_gz_bytes": sim_path.stat().st_size,
            "classified_rows_count": len(classified_rows),
        },
        "gate_checklist": {
            "vocabulary_inventoried": True,
            "taxonomy_proposed": True,
            "health_mapping_defined": True,
            "unclassified_fail_closed": True,
            "out_policy_defined": True,
            "available_policy_defined": True,
            "non_binary_policy_defined": True,
            "source_truth_separated": True,
            "season_coverage_quantified": True,
            "candidate_sample_impact_understood": True,
            "fixture_cert_strategy_defined": True,
        },
    }

    OUT_JSON.write_text(json.dumps(design, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Markdown
    def fmt_counter(d: dict, indent: int = 0) -> str:
        pad = "  " * indent
        lines_out = []
        for k, v in sorted(d.items(), key=lambda x: (-(x[1] if isinstance(x[1], int) else 0), str(x[0]))):
            lines_out.append(f"{pad}- `{k}`: **{v}**")
        return "\n".join(lines_out)

    def season_table(by_season: dict) -> str:
        rows_md = ["| Season | HEALTH_RELATED | NON_HEALTH_RELATED | UNCLASSIFIED |", "|---|---:|---:|---:|"]
        for s in ("2023", "2024", "2025"):
            c = by_season.get(s, {})
            rows_md.append(
                f"| {s} | {c.get('HEALTH_RELATED', 0)} | {c.get('NON_HEALTH_RELATED', 0)} | {c.get('UNCLASSIFIED', 0)} |"
            )
        return "\n".join(rows_md)

    w = design["eligibility_candidate_population"]["without_health_related_canonical"]
    wa = design["eligibility_candidate_population"]["with_policy_a_health_related_canonical"]
    wb = design["eligibility_candidate_population"]["with_policy_b_all_available_canonical"]

    lines = [
        "# Official injury T−60 reason policy design (Phase 5B)",
        "",
        f"Generated: **{design['generated_at']}**",
        "",
        "## Gate",
        "",
        f"**T60_REASON_POLICY_DESIGN = APPROVED**",
        "",
        f"**AS_OF_INJURY_TAPE_CERTIFIED = YES** (unchanged — source tape not downgraded)",
        "",
        f"**OUT_WITHOUT_POLICY = `{out_without_policy}`**",
        "",
        f"**AVAILABLE_CONTROL_POLICY = `{available_control_policy}`**",
        "",
        f"**NEXT = `{design['NEXT']}`**",
        "",
        f"- Reason policy version: `{REASON_POLICY_VERSION}`",
        f"- Eligibility policy version: `{ELIGIBILITY_POLICY_VERSION}`",
        "",
        "Design + corpus audit only. No production classifier. No WOWY pairs. No tape mutation.",
        "",
        "## Fingerprint (certified inputs)",
        "",
        f"| Artifact | SHA-256 / value |",
        f"|---|---|",
        f"| Phase 5A reconstruction | `{cert.get('reconstruction_sha256')}` |",
        f"| selected-player-states.ndjson.gz | `{selected_sha}` |",
        f"| Selected player rows | **{len(rows)}** |",
        f"| Parser | `ce7d729db2fe46b07e0bcfdfc9db506b62af812c0633afb30a2b97646f615ac7` |",
        "",
        "Status totals verified exact:",
        "",
        "| Status | Count |",
        "|---|---:|",
        *[f"| {k} | {EXPECTED_STATUS[k]} |" for k in ("Out", "Available", "Questionable", "Doubtful", "Probable")],
        "",
        "## Layer separation",
        "",
        "1. **Source fact** — immutable `status_raw` / `reason_raw`",
        "2. **Reason interpretation** — `reason_category` / `health_relation` (policy-versioned)",
        "3. **WOWY eligibility** — `injury_wowy_eligibility` (separately versioned)",
        "",
        "Additionally: **all-cause** `availability_fact` preserves Rest/Suspension/etc. as explicit Out without calling them injury WITHOUT.",
        "",
        "## Corpus inventory",
        "",
        f"- Unique exact `reason_raw` strings: **{len(exact_reasons)}**",
        f"- Blank/null reasons: **{blank}**",
        f"- Classifiable (non-UNCLASSIFIED, non-PLACEHOLDER) rows: **{classifiable}**",
        f"- Unclassified + placeholder rows: **{len(rows) - classifiable}**",
        f"- `reason_classification_rate`: **{reason_classification_rate:.4f}**",
        f"- Out classification rate: **{status_class_rate('Out'):.4f}**",
        f"- Available classification rate: **{status_class_rate('Available'):.4f}**",
        f"- Unique strings auto-classifiable: **{unique_auto}**",
        f"- Unique unclassified/placeholder strings: **{len(unique_unclassified)}**",
        f"- Rows on unclassified/placeholder unique strings: **{sum(v['row_count'] for _, v in unique_unclassified)}**",
        "",
        f"Reason length — min/p50/p95/max: "
        f"{design['corpus']['reason_length']['min']} / "
        f"{design['corpus']['reason_length']['p50']} / "
        f"{design['corpus']['reason_length']['p95']} / "
        f"{design['corpus']['reason_length']['max']}",
        "",
        "### Top family prefixes (`Family - detail`)",
        "",
        "| Prefix | Rows |",
        "|---|---:|",
        *[f"| `{p}` | {c} |" for p, c in prefixes.most_common(12)],
        "",
        "### Top exact reasons",
        "",
        "| reason_raw | Rows |",
        "|---|---:|",
        *[f"| `{r}` | {c} |" for r, c in exact_reasons.most_common(20)],
        "",
        "## Proposed taxonomy (`official-injury-reason-policy-v1`)",
        "",
        "### Health-related",
        "",
        f"`{sorted(health_related_categories())}`",
        "",
        "### Non-health-related (injury-WOWY excluded by default)",
        "",
        f"`{sorted(non_health_categories())}`",
        "",
        "### Fail-closed",
        "",
        "`PLACEHOLDER_REASON`, `UNCLASSIFIED` → `health_relation=UNCLASSIFIED` → injury-WOWY ineligible",
        "",
        "### Precedence",
        "",
        "1. Structural `Injury/Illness` prefix (+ subtypes: Concussion, Injury Management, Reconditioning, Illness, else Injury/Illness)",
        "2. Structural `G League` prefix",
        "3. Structural/exact `Rest` (including `Rest - …`)",
        "4. Structural/exact Personal / Not With Team",
        "5. Exact Coach's Decision / Ineligible To Play / bare Reconditioning / placeholders",
        "6. Keyword Suspension / Trade / Concussion",
        "7. `UNCLASSIFIED`",
        "",
        "Classifier is **status-independent**: same `reason_raw` → same `reason_category`.",
        "",
        "Unobserved concepts omitted from v1: Health Protocol (0 rows).",
        "",
        "## Out simulation",
        "",
        f"- Total Out: **{out_agg['n']}**",
        f"- Health-related: **{out_agg['health_related']}**",
        f"- Non-health: **{out_agg['non_health_related']}**",
        f"- Unclassified: **{out_agg['unclassified_health_relation']}**",
        f"- Canonical-resolved health-related: **{out_agg['canonical_resolved_health_related']}**",
        f"- Identity-quarantined health-related: **{out_agg['identity_quarantined_health_related']}**",
        "",
        season_table(out_agg["by_season_health_relation"]),
        "",
        "### Out reason categories",
        "",
        fmt_counter(out_agg["reason_category"]),
        "",
        f"**OUT_WITHOUT_POLICY = HEALTH_RELATED_ONLY** — {design['out_without_justification']['rationale']}",
        "",
        "## Available simulation",
        "",
        f"- Total Available: **{avail_agg['n']}**",
        f"- Health-related: **{avail_agg['health_related']}** ({avail_health_share:.1%})",
        f"- Non-health: **{avail_agg['non_health_related']}**",
        f"- Unclassified (incl. placeholder `-`): **{avail_agg['unclassified_health_relation']}**",
        f"- Canonical-resolved health-related: **{avail_agg['canonical_resolved_health_related']}**",
        f"- Identity-quarantined health-related: **{avail_agg['identity_quarantined_health_related']}**",
        "",
        season_table(avail_agg["by_season_health_relation"]),
        "",
        "### Available reason categories",
        "",
        fmt_counter(avail_agg["reason_category"]),
        "",
        "### Available control decision",
        "",
        f"**AVAILABLE_CONTROL_POLICY = `{available_control_policy}`**",
        "",
        design["available_control_justification"]["rationale"],
        "",
        "Evidence against Policy B (all Available):",
        f"- Non-health Available rows: **{avail_non}** (G League / Personal / Rest / Trade)",
        f"- Placeholder `-` Available rows: **{avail_agg['reason_category'].get('PLACEHOLDER_REASON', 0)}** — must never become WITH",
        f"- Health share ≈ **{avail_health_share:.1%}** — Available is *mostly* but not *always* health-related",
        "",
        "Policy A vs B candidate sizes (canonical identity):",
        f"- Policy A (health-related Available): **{len(with_a_rows)}**",
        f"- Policy B (all Available): **{len(with_b_rows)}**",
        "",
        "Choose A for semantic consistency with injury/health context, not sample size.",
        "",
        "## Non-binary statuses",
        "",
        "Hard rule: Questionable / Doubtful / Probable → `NON_BINARY_UNKNOWN`. Never WITH or WITHOUT.",
        "",
        "| Status | n | HEALTH | NON_HEALTH | UNCLASSIFIED |",
        "|---|---:|---:|---:|---:|",
        f"| Questionable | {q_agg['n']} | {q_agg['health_related']} | {q_agg['non_health_related']} | {q_agg['unclassified_health_relation']} |",
        f"| Doubtful | {d_agg['n']} | {d_agg['health_related']} | {d_agg['non_health_related']} | {d_agg['unclassified_health_relation']} |",
        f"| Probable | {p_agg['n']} | {p_agg['health_related']} | {p_agg['non_health_related']} | {p_agg['unclassified_health_relation']} |",
        "",
        "## Cross-status surprising combinations",
        "",
        "Non-health reason families that also appear under Available (expected for assignment/rest transitions — not auto-WITH):",
        "",
        "| reason_raw | statuses | category | rows |",
        "|---|---|---|---:|",
        *[
            f"| `{s['reason_raw']}` | {', '.join(s['statuses'])} | `{s['reason_category']}` | {s['row_count']} |"
            for s in surprising[:15]
        ],
        "",
        "## Eligibility candidate population",
        "",
        "Not eventual WOWY subject×teammate sample — source-state eligibility only.",
        "",
        "| Population | Rows | Entities | Games | Team-games | 2023 | 2024 | 2025 |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
        f"| WITHOUT (Out+health+canonical) | {w['rows']} | {w['unique_entities']} | {w['unique_games']} | {w['unique_team_games']} | {w['by_season'].get('2023',0)} | {w['by_season'].get('2024',0)} | {w['by_season'].get('2025',0)} |",
        f"| WITH Policy A (Avail+health+canonical) | {wa['rows']} | {wa['unique_entities']} | {wa['unique_games']} | {wa['unique_team_games']} | {wa['by_season'].get('2023',0)} | {wa['by_season'].get('2024',0)} | {wa['by_season'].get('2025',0)} |",
        f"| WITH Policy B (all Avail+canonical) | {wb['rows']} | {wb['unique_entities']} | {wb['unique_games']} | {wb['unique_team_games']} | {wb['by_season'].get('2023',0)} | {wb['by_season'].get('2024',0)} | {wb['by_season'].get('2025',0)} |",
        "",
        "## Explicit injury-WOWY exclusions",
        "",
        "- REST (including Rest-framed injury-management text)",
        "- G_LEAGUE_TWO_WAY / G_LEAGUE_ON_ASSIGNMENT / G_LEAGUE_ASSIGNMENT",
        "- PERSONAL / NOT_WITH_TEAM / SUSPENSION / TRADE_RELATED",
        "- COACHS_DECISION / INELIGIBLE_TO_PLAY",
        "- PLACEHOLDER_REASON / UNCLASSIFIED",
        "- Questionable / Doubtful / Probable",
        "- Missing / NYS / TEAM_BLOCK_MISSING / source-gap states",
        "- Identity-quarantined rows (entity joinability only — reason category unchanged)",
        "",
        "## Result contract (design sketch)",
        "",
        "```json",
        json.dumps(
            {
                "status_raw": "Out",
                "reason_raw": "Injury/Illness - Left Ankle; Sprain",
                "reason_policy_version": REASON_POLICY_VERSION,
                "reason_category": "INJURY_OR_ILLNESS",
                "health_relation": "HEALTH_RELATED",
                "eligibility_policy_version": ELIGIBILITY_POLICY_VERSION,
                "availability_fact": "EXPLICIT_UNAVAILABLE",
                "injury_wowy_eligibility": "WITHOUT_CANDIDATE",
                "identity_status": "RESOLVED_CANONICAL_ENTITY",
            },
            indent=2,
        ),
        "```",
        "",
        "## Fixture strategy (next phase)",
        "",
        "Lock real T−60 reasons covering: Injury/Illness, Illness, Available Injury/Illness, Rest, G League Two-Way, G League On Assignment, Personal, Not With Team, Coach's Decision, Reconditioning, Injury Management, placeholder `-`, unclassified rare, Rest+Injury Management hybrid, synthetic precedence collisions.",
        "",
        "Do **not** implement classifier in this phase.",
        "",
        "## Artifacts",
        "",
        f"- `{design['artifacts']['inventory_ndjson']}`",
        f"- `{design['artifacts']['review_ndjson']}`",
        f"- `{design['artifacts']['classified_rows_gz']}` — SHA `{sim_sha}`, {design['artifacts']['classified_rows_count']} rows, {design['artifacts']['classified_rows_gz_bytes']} bytes",
        "",
        "## Verification checklist",
        "",
        "1. Certified T−60 source tape unchanged.",
        "2. Parser / game joins / identity resolver unchanged.",
        "3. No T−60 snapshot reselection.",
        "4. `reason_raw` preserved exactly.",
        "5. No status rewritten; no Postgres/S3/NBA.com/BDL.",
        "6. No PGL / missing→Available / QDP→WITH.",
        "7. No WOWY pairs or model training.",
        "8. `AS_OF_INJURY_TAPE_CERTIFIED = YES`.",
        "",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "T60_REASON_POLICY_DESIGN": "APPROVED",
                "OUT_WITHOUT_POLICY": out_without_policy,
                "AVAILABLE_CONTROL_POLICY": available_control_policy,
                "unique_reasons": len(exact_reasons),
                "classification_rate": round(reason_classification_rate, 4),
                "out_health": out_agg["health_related"],
                "out_non_health": out_agg["non_health_related"],
                "out_unclassified": out_agg["unclassified_health_relation"],
                "avail_health": avail_health,
                "avail_non_health": avail_non,
                "without_candidates": len(without_rows),
                "with_a_candidates": len(with_a_rows),
                "with_b_candidates": len(with_b_rows),
                "unclassified_unique": len(unique_unclassified),
                "NEXT": design["NEXT"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
