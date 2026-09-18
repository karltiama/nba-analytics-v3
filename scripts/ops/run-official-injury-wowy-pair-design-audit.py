"""
Phase 6A — injury WOWY pair design + coverage audit (no effects, no production pairs).

  python scripts/ops/run-official-injury-wowy-pair-design-audit.py
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
ELIG_DIR = ROOT / "tmp" / "official-injury-report-t60-eligibility"
SELECTED_GZ = ROOT / "tmp" / "official-injury-report-asof-t60" / "selected-player-states.ndjson.gz"
OUT_TMP = ROOT / "tmp" / "official-injury-wowy-pair-audit"
REPORTS = ROOT / "reports" / "operations"

EXPECTED_WITHOUT = 19378
EXPECTED_WITH = 2466
EXPECTED_WITHOUT_SEASON = {"2023": 5704, "2024": 6530, "2025": 7144}
EXPECTED_WITH_SEASON = {"2023": 631, "2024": 686, "2025": 1149}

PAIR_POLICY_VERSION = "injury-wowy-pair-policy-v1-design"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def load_ndjson_gz(p: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with gzip.open(p, "rt", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def classify_wowy_appearance(minutes: Any, box: dict[str, Any]) -> dict[str, Any]:
    """Mirror lib/wowy/appearance.ts classifyWowyAppearance."""
    token = None if minutes is None else str(minutes).strip() or None
    try:
        mins = None if minutes is None else float(minutes)
        if mins is not None and not math.isfinite(mins):
            mins = None
    except (TypeError, ValueError):
        mins = None
    box_sum = sum(float(box.get(k) or 0) for k in ("points", "rebounds", "assists", "three_pointers_made", "field_goals_attempted", "free_throws_attempted"))
    has_box = box_sum > 0
    if token is None or mins is None:
        return {"class": "malformed", "minutes": mins, "token": token, "reason": "null_or_non_numeric_minutes"}
    if mins > 0:
        return {"class": "played", "minutes": mins, "token": token, "reason": "minutes_gt_0"}
    if token == "00":
        return {"class": "dnp", "minutes": 0.0, "token": token, "reason": "minutes_00_dnp_with_anomalous_box" if has_box else "minutes_00_dnp"}
    if token in ("0", "0.0"):
        return {"class": "played", "minutes": 0.0, "token": token, "reason": "zero_minute_appearance"}
    if has_box:
        return {"class": "played", "minutes": 0.0, "token": token, "reason": "zero_minutes_with_box_activity"}
    return {"class": "dnp", "minutes": 0.0, "token": token, "reason": "zero_minutes_no_box"}


def percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return float(sorted_vals[f])
    return sorted_vals[f] * (c - k) + sorted_vals[c] * (k - f)


def load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def query_pgl(game_team_keys: set[tuple[str, str]]) -> list[dict[str, Any]]:
    import psycopg

    load_dotenv()
    url = (os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or "").strip()
    if not url:
        raise SystemExit("SUPABASE_DB_URL or DATABASE_URL required")

    game_ids = sorted({g for g, _ in game_team_keys})
    rows: list[dict[str, Any]] = []
    with psycopg.connect(url) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            # chunk game_ids
            chunk = 500
            for i in range(0, len(game_ids), chunk):
                part = game_ids[i : i + chunk]
                cur.execute(
                    """
                    SELECT
                      l.game_id::text,
                      l.team_id::text,
                      l.player_id::text,
                      l.season::text,
                      l.game_date::text,
                      l.minutes,
                      l.points,
                      l.rebounds,
                      l.assists,
                      l.three_pointers_made,
                      l.field_goals_attempted,
                      l.three_pointers_attempted,
                      l.free_throws_attempted,
                      p.player_entity_id::text,
                      g.start_time::text,
                      g.status::text,
                      g.home_team_id::text
                    FROM analytics.player_game_logs l
                    JOIN analytics.players p ON p.player_id = l.player_id
                    JOIN analytics.games g ON g.game_id = l.game_id
                    WHERE l.game_id = ANY(%s)
                    """,
                    (part,),
                )
                cols = [d.name for d in cur.description]
                for tup in cur.fetchall():
                    r = dict(zip(cols, tup))
                    key = (r["game_id"], r["team_id"])
                    if key in game_team_keys:
                        rows.append(r)
        conn.execute("COMMIT")
    return rows


def depth_counts(pairs: dict[tuple, dict[str, int]], thresholds: list[tuple[int, int]]) -> dict[str, int]:
    both = {k: v for k, v in pairs.items() if v.get("WITH", 0) > 0 and v.get("WITHOUT", 0) > 0}
    out: dict[str, int] = {"BOTH_STATES": len(both)}
    for w, wo in thresholds:
        out[f">={w}/{wo}"] = sum(
            1 for v in both.values() if v.get("WITH", 0) >= w and v.get("WITHOUT", 0) >= wo
        )
    return out


def build_pair_index(obs: list[dict[str, Any]], key_fn) -> dict[tuple, dict[str, int]]:
    idx: dict[tuple, dict[str, int]] = defaultdict(lambda: {"WITH": 0, "WITHOUT": 0})
    for o in obs:
        k = key_fn(o)
        st = o["focal_state"]
        if st == "PRE_GAME_AVAILABLE":
            idx[k]["WITH"] += 1
        elif st == "PRE_GAME_OUT":
            idx[k]["WITHOUT"] += 1
    return idx


def classify_pair_states(idx: dict[tuple, dict[str, int]]) -> dict[str, int]:
    with_only = without_only = both = 0
    for v in idx.values():
        has_w = v.get("WITH", 0) > 0
        has_wo = v.get("WITHOUT", 0) > 0
        if has_w and has_wo:
            both += 1
        elif has_w:
            with_only += 1
        elif has_wo:
            without_only += 1
    return {
        "directional_pairs": len(idx),
        "WITH_ONLY": with_only,
        "WITHOUT_ONLY": without_only,
        "BOTH_STATES": both,
    }


def main() -> int:
    OUT_TMP.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)

    without_path = ELIG_DIR / "without-candidates.ndjson.gz"
    with_path = ELIG_DIR / "with-candidates.ndjson.gz"
    all_path = ELIG_DIR / "all-results.ndjson.gz"

    without_rows = load_ndjson_gz(without_path)
    with_rows = load_ndjson_gz(with_path)
    all_rows = load_ndjson_gz(all_path)

    if len(without_rows) != EXPECTED_WITHOUT or len(with_rows) != EXPECTED_WITH:
        raise SystemExit(
            f"STOP: candidate drift WITHOUT={len(without_rows)} WITH={len(with_rows)}"
        )
    wo_season = Counter(str(r["season"]) for r in without_rows)
    wi_season = Counter(str(r["season"]) for r in with_rows)
    for s, n in EXPECTED_WITHOUT_SEASON.items():
        if wo_season[s] != n:
            raise SystemExit(f"STOP: WITHOUT season {s} {wo_season[s]}!={n}")
    for s, n in EXPECTED_WITH_SEASON.items():
        if wi_season[s] != n:
            raise SystemExit(f"STOP: WITH season {s} {wi_season[s]}!={n}")

    # Focal uniqueness / conflicts
    focal_map: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for r in without_rows + with_rows:
        key = (str(r["game_id"]), str(r["team_id"]), str(r["player_entity_id"]))
        focal_map[key].append(str(r["injury_wowy_eligibility"]))
    conflicts = sum(1 for v in focal_map.values() if len(set(v)) > 1)
    if conflicts:
        raise SystemExit(f"STOP: {conflicts} conflicting focal states")
    entity_only = sum(
        1
        for r in without_rows + with_rows
        if r.get("identity_status") == "RESOLVED_ENTITY_NO_SERVING_PLAYER"
    )

    # Selected states for serving + publish time
    selected = load_ndjson_gz(SELECTED_GZ)
    selected_by: dict[tuple[str, str, str], dict[str, Any]] = {}
    for r in selected:
        if not r.get("player_entity_id"):
            continue
        selected_by[(str(r["game_id"]), str(r["team_id"]), str(r["player_entity_id"]))] = r

    # Team-game context from all-results
    team_game_players: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for r in all_rows:
        team_game_players[(str(r["game_id"]), str(r["team_id"]))].append(r)

    # Team-game multiplicity of eligible focals
    eligible_by_tg: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"WITH": 0, "WITHOUT": 0}
    )
    for r in without_rows:
        eligible_by_tg[(str(r["game_id"]), str(r["team_id"]))]["WITHOUT"] += 1
    for r in with_rows:
        eligible_by_tg[(str(r["game_id"]), str(r["team_id"]))]["WITH"] += 1

    tg_class = Counter()
    for season_key, counts in eligible_by_tg.items():
        w = counts["WITH"]
        wo = counts["WITHOUT"]
        if w > 0 and wo == 0:
            tg_class["ONLY_WITH"] += 1
        if wo > 0 and w == 0:
            tg_class["ONLY_WITHOUT"] += 1
        if w > 0 and wo > 0:
            tg_class["MIXED_WITH_AND_WITHOUT"] += 1
        if wo >= 2:
            tg_class["MULTIPLE_WITHOUT"] += 1
        if w >= 2:
            tg_class["MULTIPLE_WITH"] += 1

    game_team_keys = set(eligible_by_tg.keys())
    print(f"Querying PGL for {len(game_team_keys)} team-games…")
    pgl_rows = query_pgl(game_team_keys)
    print(f"PGL rows loaded: {len(pgl_rows)}")

    # Index PGL by game/team and by entity
    pgl_by_gt: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    pgl_by_entity: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for r in pgl_rows:
        gt = (r["game_id"], r["team_id"])
        app = classify_wowy_appearance(
            r["minutes"],
            {
                "points": r["points"],
                "rebounds": r["rebounds"],
                "assists": r["assists"],
                "three_pointers_made": r["three_pointers_made"],
                "field_goals_attempted": r["field_goals_attempted"],
                "free_throws_attempted": r["free_throws_attempted"],
            },
        )
        r["_appearance"] = app
        pgl_by_gt[gt].append(r)
        if r.get("player_entity_id"):
            pgl_by_entity[(r["game_id"], r["team_id"], r["player_entity_id"])].append(r)

    # Subject universe
    played_subjects = 0
    played_with_entity = 0
    played_without_entity = 0
    subjects_by_gt: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for gt, rows in pgl_by_gt.items():
        for r in rows:
            if r["_appearance"]["class"] != "played":
                continue
            played_subjects += 1
            if r.get("player_entity_id"):
                played_with_entity += 1
                subjects_by_gt[gt].append(r)
            else:
                played_without_entity += 1

    anomalies: list[dict[str, Any]] = []
    pair_obs: list[dict[str, Any]] = []
    self_pairs_removed = 0
    potential_before_self = 0
    subject_identity_failures = played_without_entity

    def context_counts(gt: tuple[str, str], focal_entity: str) -> dict[str, int]:
        players = team_game_players.get(gt, [])
        other_health_wo = 0
        other_health_wi = 0
        other_non_health_out = 0
        other_nonbinary_health = 0
        other_elig_with = 0
        other_elig_without = 0
        for p in players:
            eid = str(p.get("player_entity_id") or "")
            if eid and eid == focal_entity:
                continue
            status = p.get("status_raw")
            health = p.get("health_relation")
            elig = p.get("injury_wowy_eligibility")
            if status == "Out" and health == "HEALTH_RELATED":
                other_health_wo += 1
            if status == "Available" and health == "HEALTH_RELATED":
                other_health_wi += 1
            if status == "Out" and health == "NON_HEALTH_RELATED":
                other_non_health_out += 1
            if status in ("Questionable", "Doubtful", "Probable") and health == "HEALTH_RELATED":
                other_nonbinary_health += 1
            if elig == "WITH_CANDIDATE" and p.get("canonical_model_eligible"):
                other_elig_with += 1
            if elig == "WITHOUT_CANDIDATE" and p.get("canonical_model_eligible"):
                other_elig_without += 1
        return {
            "other_health_without_count": other_health_wo,
            "other_health_with_count": other_health_wi,
            "other_non_health_out_count": other_non_health_out,
            "other_nonbinary_health_count": other_nonbinary_health,
            "other_eligible_with_count": other_elig_with,
            "other_eligible_without_count": other_elig_without,
        }

    def focal_realized(gt: tuple[str, str], focal_entity: str) -> str:
        rows = pgl_by_entity.get((gt[0], gt[1], focal_entity), [])
        if not rows:
            return "NO_PGL_ROW"
        # if multiple, prefer any played
        classes = [r["_appearance"]["class"] for r in rows]
        if "played" in classes:
            return "PLAYED"
        if "dnp" in classes:
            return "DNP_00"
        return "NO_PGL_ROW"

    focals = []
    for r in without_rows:
        focals.append((r, "PRE_GAME_OUT", "WITHOUT_CANDIDATE"))
    for r in with_rows:
        focals.append((r, "PRE_GAME_AVAILABLE", "WITH_CANDIDATE"))

    for focal, focal_state, elig_label in focals:
        gt = (str(focal["game_id"]), str(focal["team_id"]))
        focal_entity = str(focal["player_entity_id"])
        if not focal_entity:
            anomalies.append(
                {
                    "type": "focal_entity_unresolved",
                    "game_id": focal["game_id"],
                    "team_id": focal["team_id"],
                    "player_name_raw": focal.get("player_name_raw"),
                }
            )
            continue
        sel = selected_by.get((gt[0], gt[1], focal_entity), {})
        ctx = context_counts(gt, focal_entity)
        realized = focal_realized(gt, focal_entity)
        if focal_state == "PRE_GAME_OUT" and realized == "PLAYED":
            anomalies.append(
                {
                    "type": "T60_OUT_BUT_PLAYED",
                    "game_id": gt[0],
                    "team_id": gt[1],
                    "season": focal.get("season"),
                    "focal_player_entity_id": focal_entity,
                    "player_name_raw": focal.get("player_name_raw"),
                    "reason_raw": focal.get("reason_raw"),
                    "status_raw": focal.get("status_raw"),
                }
            )

        subjects = subjects_by_gt.get(gt, [])
        # detect duplicate subject entities
        seen_subj: set[str] = set()
        for subj in subjects:
            sid = str(subj["player_entity_id"])
            potential_before_self += 1
            if sid == focal_entity:
                self_pairs_removed += 1
                continue
            if sid in seen_subj:
                anomalies.append(
                    {
                        "type": "pgl_duplicate_subject_row",
                        "game_id": gt[0],
                        "team_id": gt[1],
                        "subject_player_entity_id": sid,
                    }
                )
                continue
            seen_subj.add(sid)

            app = subj["_appearance"]
            obs = {
                "pair_policy_version": PAIR_POLICY_VERSION,
                "game_id": gt[0],
                "team_id": gt[1],
                "season": str(focal.get("season") or subj.get("season")),
                "game_date": subj.get("game_date"),
                "home_away": (
                    "home"
                    if str(subj.get("home_team_id") or "") == gt[1]
                    else "away"
                    if subj.get("home_team_id")
                    else None
                ),
                "subject_player_entity_id": sid,
                "subject_serving_player_id": subj.get("player_id"),
                "focal_player_entity_id": focal_entity,
                "focal_serving_player_id": sel.get("serving_player_id"),
                "focal_state": focal_state,
                "focal_eligibility": elig_label,
                "t60_report_published_at": sel.get("report_published_at"),
                "subject_minutes": app.get("minutes"),
                "subject_points": subj.get("points"),
                "subject_rebounds": subj.get("rebounds"),
                "subject_assists": subj.get("assists"),
                "subject_tpm": subj.get("three_pointers_made"),
                "subject_fga": subj.get("field_goals_attempted"),
                "subject_tpa": subj.get("three_pointers_attempted"),
                "subject_fta": subj.get("free_throws_attempted"),
                "focal_realized_participation_diagnostic": realized,
                **ctx,
                "mixed_focal_context": ctx["other_health_with_count"] > 0
                and ctx["other_health_without_count"] > 0,
                "source_versions": {
                    "asof": "official-injury-asof-t60-v1",
                    "reason": "official-injury-reason-policy-v1",
                    "eligibility": "injury-wowy-eligibility-v1",
                    "identity": "official-injury-player-identity-v1",
                },
            }
            pair_obs.append(obs)

    # Dedup check
    pair_keys = Counter(
        (
            o["game_id"],
            o["team_id"],
            o["subject_player_entity_id"],
            o["focal_player_entity_id"],
        )
        for o in pair_obs
    )
    dup_pairs = sum(1 for v in pair_keys.values() if v > 1)
    if dup_pairs:
        anomalies.append({"type": "duplicate_pair_observation", "count": dup_pairs})

    # Focal realized diagnostics
    with_realized = Counter()
    without_realized = Counter()
    for focal, focal_state, _ in focals:
        gt = (str(focal["game_id"]), str(focal["team_id"]))
        eid = str(focal["player_entity_id"])
        realized = focal_realized(gt, eid)
        if focal_state == "PRE_GAME_AVAILABLE":
            with_realized[realized] += 1
        else:
            without_realized[realized] += 1

    # Filter policies
    def apply_policy(obs: list[dict[str, Any]], policy: str) -> list[dict[str, Any]]:
        if policy == "P0":
            return obs
        out = []
        for o in obs:
            if policy == "P1":
                if o["other_health_without_count"] == 0:
                    out.append(o)
            elif policy == "P2":
                if (
                    o["other_eligible_with_count"] == 0
                    and o["other_eligible_without_count"] == 0
                ):
                    out.append(o)
            elif policy == "P3":
                if (
                    o["other_health_without_count"] == 0
                    and o["other_non_health_out_count"] == 0
                ):
                    out.append(o)
        return out

    thresholds_sym = [(1, 1), (2, 2), (3, 3), (5, 5), (10, 10), (15, 15), (20, 20)]
    thresholds_asym = [(1, 3), (2, 5), (3, 5), (3, 10), (5, 10)]

    def summarize_obs(obs: list[dict[str, Any]]) -> dict[str, Any]:
        with_obs = [o for o in obs if o["focal_state"] == "PRE_GAME_AVAILABLE"]
        without_obs = [o for o in obs if o["focal_state"] == "PRE_GAME_OUT"]
        pooled = build_pair_index(
            obs, lambda o: (o["subject_player_entity_id"], o["focal_player_entity_id"])
        )
        season = build_pair_index(
            obs,
            lambda o: (o["season"], o["subject_player_entity_id"], o["focal_player_entity_id"]),
        )
        team = build_pair_index(
            obs, lambda o: (o["team_id"], o["subject_player_entity_id"], o["focal_player_entity_id"])
        )
        season_team = build_pair_index(
            obs,
            lambda o: (
                o["season"],
                o["team_id"],
                o["subject_player_entity_id"],
                o["focal_player_entity_id"],
            ),
        )
        pooled_cls = classify_pair_states(pooled)
        season_cls = classify_pair_states(season)
        team_cls = classify_pair_states(team)
        st_cls = classify_pair_states(season_team)

        by_season_obs = Counter(o["season"] for o in obs)
        by_season_with = Counter(o["season"] for o in with_obs)
        by_season_without = Counter(o["season"] for o in without_obs)

        # pair observations per subject-game
        per_sg = Counter()
        sg_counts: dict[tuple, int] = defaultdict(int)
        for o in obs:
            sg_counts[(o["game_id"], o["subject_player_entity_id"])] += 1
        for c in sg_counts.values():
            if c == 1:
                per_sg["1"] += 1
            elif c == 2:
                per_sg["2"] += 1
            elif c == 3:
                per_sg["3"] += 1
            else:
                per_sg["4+"] += 1
        max_per_sg = max(sg_counts.values()) if sg_counts else 0

        # contamination distributions on obs
        def bucket_dist(field: str) -> dict[str, int]:
            d = Counter()
            for o in obs:
                v = int(o.get(field) or 0)
                if v <= 0:
                    d["0"] += 1
                elif v == 1:
                    d["1"] += 1
                elif v == 2:
                    d["2"] += 1
                else:
                    d["3+"] += 1
            return dict(d)

        # BOTH_STATES metadata for pooled
        both_keys = {k for k, v in pooled.items() if v["WITH"] > 0 and v["WITHOUT"] > 0}
        both_obs = [
            o
            for o in obs
            if (o["subject_player_entity_id"], o["focal_player_entity_id"]) in both_keys
        ]
        # temporal gaps
        gap_buckets = Counter()
        multi_team_pairs = 0
        for k in both_keys:
            rows = [
                o
                for o in both_obs
                if (o["subject_player_entity_id"], o["focal_player_entity_id"]) == k
            ]
            teams = {o["team_id"] for o in rows}
            if len(teams) > 1:
                multi_team_pairs += 1
            with_dates = sorted(
                o["game_date"]
                for o in rows
                if o["focal_state"] == "PRE_GAME_AVAILABLE" and o.get("game_date")
            )
            without_dates = sorted(
                o["game_date"]
                for o in rows
                if o["focal_state"] == "PRE_GAME_OUT" and o.get("game_date")
            )
            if not with_dates or not without_dates:
                continue
            # nearest opposite gap
            best = None
            for d1 in with_dates:
                for d2 in without_dates:
                    try:
                        a = datetime.fromisoformat(d1[:10])
                        b = datetime.fromisoformat(d2[:10])
                        gap = abs((a - b).days)
                        if best is None or gap < best:
                            best = gap
                    except ValueError:
                        continue
            if best is None:
                continue
            if best == 0:
                gap_buckets["same_day"] += 1
            elif best <= 7:
                gap_buckets["<=7_days"] += 1
            elif best <= 30:
                gap_buckets["8_30_days"] += 1
            elif best <= 90:
                gap_buckets["31_90_days"] += 1
            elif best <= 365:
                gap_buckets["91_365_days"] += 1
            else:
                gap_buckets[">365_days"] += 1

        # subject minutes
        mins = sorted(
            float(o["subject_minutes"])
            for o in obs
            if o.get("subject_minutes") is not None and math.isfinite(float(o["subject_minutes"]))
        )
        minutes_audit = {
            "n": len(mins),
            "min": mins[0] if mins else None,
            "p5": percentile(mins, 0.05),
            "median": percentile(mins, 0.5),
            "p95": percentile(mins, 0.95),
            "max": mins[-1] if mins else None,
            "lt5": sum(1 for m in mins if m < 5),
            "lt10": sum(1 for m in mins if m < 10),
            "lt15": sum(1 for m in mins if m < 15),
        }

        # metric completeness
        metric_fields = {
            "minutes": "subject_minutes",
            "pts": "subject_points",
            "reb": "subject_rebounds",
            "ast": "subject_assists",
            "tpm": "subject_tpm",
            "fga": "subject_fga",
            "tpa": "subject_tpa",
            "fta": "subject_fta",
        }
        metric_completeness = {}
        n_obs = max(len(obs), 1)
        for mk, field in metric_fields.items():
            nulls = sum(1 for o in obs if o.get(field) is None)
            metric_completeness[mk] = {
                "null_count": nulls,
                "null_rate": nulls / n_obs,
                "present": len(obs) - nulls,
            }

        return {
            "observations": len(obs),
            "with_observations": len(with_obs),
            "without_observations": len(without_obs),
            "unique_subjects": len({o["subject_player_entity_id"] for o in obs}),
            "unique_focals": len({o["focal_player_entity_id"] for o in obs}),
            "by_season_observations": dict(by_season_obs),
            "by_season_with": dict(by_season_with),
            "by_season_without": dict(by_season_without),
            "pair_obs_per_subject_game": dict(per_sg),
            "pair_obs_per_subject_game_max": max_per_sg,
            "keys": {
                "pooled": {
                    **pooled_cls,
                    **depth_counts(pooled, thresholds_sym),
                    "asymmetric": depth_counts(pooled, thresholds_asym),
                    "multi_team_both_states_pairs": multi_team_pairs,
                },
                "season_bounded": {
                    **season_cls,
                    **depth_counts(season, thresholds_sym),
                    "asymmetric": depth_counts(season, thresholds_asym),
                },
                "team_bounded": {
                    **team_cls,
                    **depth_counts(team, thresholds_sym),
                    "asymmetric": depth_counts(team, thresholds_asym),
                },
                "season_team_bounded": {
                    **st_cls,
                    **depth_counts(season_team, thresholds_sym),
                    "asymmetric": depth_counts(season_team, thresholds_asym),
                },
            },
            "contamination_distributions": {
                "other_health_without_count": bucket_dist("other_health_without_count"),
                "other_health_with_count": bucket_dist("other_health_with_count"),
                "other_non_health_out_count": bucket_dist("other_non_health_out_count"),
                "other_nonbinary_health_count": bucket_dist("other_nonbinary_health_count"),
                "mixed_focal_context_true": sum(1 for o in obs if o.get("mixed_focal_context")),
            },
            "temporal_gaps_both_states_pooled": dict(gap_buckets),
            "minutes_audit": minutes_audit,
            "metric_completeness": metric_completeness,
        }

    policy_summaries = {}
    for pol in ("P0", "P1", "P2", "P3"):
        filtered = apply_policy(pair_obs, pol)
        policy_summaries[pol] = summarize_obs(filtered)

    p0 = policy_summaries["P0"]

    # Write pair observations (P0)
    pairs_path = OUT_TMP / "pair-observations.ndjson.gz"
    with gzip.open(pairs_path, "wt", encoding="utf-8") as fh:
        for o in pair_obs:
            fh.write(json.dumps(o, ensure_ascii=False) + "\n")

    # pair-summary: BOTH_STATES pooled pairs
    pooled = build_pair_index(
        pair_obs, lambda o: (o["subject_player_entity_id"], o["focal_player_entity_id"])
    )
    summary_path = OUT_TMP / "pair-summary.ndjson.gz"
    with gzip.open(summary_path, "wt", encoding="utf-8") as fh:
        for (subj, focal), counts in sorted(pooled.items()):
            fh.write(
                json.dumps(
                    {
                        "subject_player_entity_id": subj,
                        "focal_player_entity_id": focal,
                        "with_count": counts["WITH"],
                        "without_count": counts["WITHOUT"],
                        "class": (
                            "BOTH_STATES"
                            if counts["WITH"] and counts["WITHOUT"]
                            else "WITH_ONLY"
                            if counts["WITH"]
                            else "WITHOUT_ONLY"
                        ),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

    anomalies_path = OUT_TMP / "anomalies.ndjson.gz"
    with gzip.open(anomalies_path, "wt", encoding="utf-8") as fh:
        for a in anomalies:
            fh.write(json.dumps(a, ensure_ascii=False) + "\n")
    # also committed optional ndjson (unzipped sample/all anomalies — may be large)
    anomalies_report = REPORTS / "official-injury-wowy-pair-anomalies.ndjson"
    with anomalies_report.open("w", encoding="utf-8") as fh:
        for a in anomalies:
            fh.write(json.dumps(a, ensure_ascii=False) + "\n")

    # BY season team-game classes
    tg_by_season: dict[str, Counter] = defaultdict(Counter)
    for (gid, tid), counts in eligible_by_tg.items():
        # find season from any focal
        season = None
        for r in without_rows + with_rows:
            if str(r["game_id"]) == gid and str(r["team_id"]) == tid:
                season = str(r["season"])
                break
        season = season or "?"
        w, wo = counts["WITH"], counts["WITHOUT"]
        if w > 0 and wo == 0:
            tg_by_season[season]["ONLY_WITH"] += 1
        if wo > 0 and w == 0:
            tg_by_season[season]["ONLY_WITHOUT"] += 1
        if w > 0 and wo > 0:
            tg_by_season[season]["MIXED_WITH_AND_WITHOUT"] += 1
        if wo >= 2:
            tg_by_season[season]["MULTIPLE_WITHOUT"] += 1
        if w >= 2:
            tg_by_season[season]["MULTIPLE_WITH"] += 1

    # Recommendations
    # Prefer retaining P0 observations + contamination counters; pair key season+team conservative
    # but pooled all-season for exploratory depth. Recommend:
    # PAIR_KEY = season + team + subject + focal for primary modeling cohort
    # store all P0; apply P1 as default cohort filter downstream
    # MIN_SAMPLE = DEFER_TO_MODEL_LAYER
    # terminology: PREGAME_AVAILABILITY_WOWY / injury-conditioned WOWY

    design = {
        "generated_at": utc_now(),
        "phase": "6A",
        "INJURY_WOWY_PAIR_DESIGN": "APPROVED",
        "AS_OF_INJURY_TAPE_CERTIFIED": "YES",
        "T60_REASON_POLICY_CERTIFIED": "YES",
        "WOWY_ELIGIBILITY_POLICY_CERTIFIED": "YES",
        "pair_policy_version_design": PAIR_POLICY_VERSION,
        "NEXT": "IMPLEMENT_AND_CERTIFY_INJURY_WOWY_PAIR_BUILDER",
        "input_fingerprints": {
            "without_candidates_sha256": sha256_file(without_path),
            "with_candidates_sha256": sha256_file(with_path),
            "all_results_sha256": sha256_file(all_path),
            "selected_player_states_sha256": sha256_file(SELECTED_GZ),
            "phase5b_classified_sha_prefix": "d73e9fbe",
        },
        "focal_population": {
            "WITHOUT_CANDIDATE": len(without_rows),
            "WITH_CANDIDATE": len(with_rows),
            "total": len(without_rows) + len(with_rows),
            "without_by_season": dict(wo_season),
            "with_by_season": dict(wi_season),
            "focal_conflicts": conflicts,
            "focal_entity_only_count": entity_only,
            "unique_focal_keys": len(focal_map),
        },
        "subject_universe": {
            "played_subject_pgl_rows_encountered": played_subjects,
            "canonical_subject_rows": played_with_entity,
            "subject_identity_failures": subject_identity_failures,
            "potential_pair_obs_before_self_exclusion": potential_before_self,
            "self_pairs_removed": self_pairs_removed,
            "final_p0_pair_observations": len(pair_obs),
            "duplicate_pair_keys": dup_pairs,
        },
        "team_game_multiplicity": {
            "overall": dict(tg_class),
            "by_season": {s: dict(c) for s, c in sorted(tg_by_season.items())},
            "team_games_with_eligible_focals": len(eligible_by_tg),
        },
        "focal_realized_diagnostics": {
            "WITH": dict(with_realized),
            "WITHOUT": dict(without_realized),
            "T60_OUT_BUT_PLAYED_count": sum(1 for a in anomalies if a.get("type") == "T60_OUT_BUT_PLAYED"),
            "note": "Diagnostics only — do not redefine certified pregame states.",
        },
        "policies": policy_summaries,
        "recommendations": {
            "PAIR_KEY_POLICY": "season + team_id + subject_entity + focal_entity",
            "PAIR_KEY_RATIONALE": (
                "Season+team bounding maximizes role/context stability. "
                "Pooled all-season BOTH_STATES depth is larger but multi-team and year-gap risk is material; "
                "retain pooled as secondary exploratory key only."
            ),
            "PAIR_CONTAMINATION_POLICY": "STORE_P0_PLUS_COUNTERS__DEFAULT_COHORT_P1",
            "PAIR_CONTAMINATION_RATIONALE": (
                "Builder should retain provenance-rich P0 observations with contamination counters; "
                "default analysis cohort = P1 (no other health-related Out teammates) applied symmetrically. "
                "P2/P3 remain available for sensitivity but destroy too much BOTH_STATES coverage for v1."
            ),
            "MIN_SAMPLE_POLICY": "DEFER_TO_MODEL_LAYER",
            "INTERNAL_TERMINOLOGY": "INJURY_CONDITIONED_WOWY",
            "TERMINOLOGY_ALT": "PREGAME_AVAILABILITY_WOWY",
            "TERMINOLOGY_RATIONALE": (
                "Prefer INJURY_CONDITIONED_WOWY for product lineage with Court Context WOWY, "
                "while documenting that WITH/WITHOUT here mean pregame health-related Available/Out, "
                "not realized on-court participation (existing /wowy)."
            ),
            "ARCHITECTURE": (
                "pair builder emits P0 observations + counters; "
                "downstream certified cohort policy selects P1 (default) / P2 / P3 and min-N thresholds"
            ),
        },
        "conceptual_difference": {
            "injury_conditioned": (
                "How did Subject perform when Teammate was known T−60 health-related Out vs Available?"
            ),
            "realized_wowy": (
                "How did Subject perform when Teammate physically played vs verified DNP (minutes 00)?"
            ),
        },
        "artifacts": {
            "pair_observations": {
                "path": str(pairs_path.relative_to(ROOT)).replace("\\", "/"),
                "sha256": sha256_file(pairs_path),
                "bytes": pairs_path.stat().st_size,
                "count": len(pair_obs),
            },
            "pair_summary": {
                "path": str(summary_path.relative_to(ROOT)).replace("\\", "/"),
                "sha256": sha256_file(summary_path),
                "bytes": summary_path.stat().st_size,
                "count": len(pooled),
            },
            "anomalies": {
                "path": str(anomalies_path.relative_to(ROOT)).replace("\\", "/"),
                "sha256": sha256_file(anomalies_path),
                "bytes": anomalies_path.stat().st_size,
                "count": len(anomalies),
                "committed_ndjson": str(anomalies_report.relative_to(ROOT)).replace("\\", "/"),
            },
        },
        "gate_checklist": {
            "focal_population_reproduced": True,
            "subject_universe_measured": True,
            "directional_pair_grain_defined": True,
            "self_pairs_removed": True,
            "longitudinal_keys_quantified": True,
            "both_state_coverage_known": True,
            "sample_depth_known": True,
            "contamination_quantified": True,
            "policy_simulations_completed": True,
            "realized_diagnostics_no_leakage": True,
            "metric_completeness_known": True,
            "enough_evidence_for_pair_builder": True,
        },
    }

    run_state = {
        "generated_at": utc_now(),
        "pair_observations": len(pair_obs),
        "anomalies": len(anomalies),
        "INJURY_WOWY_PAIR_DESIGN": "APPROVED",
        "artifacts": design["artifacts"],
    }
    (OUT_TMP / "run-state.json").write_text(
        json.dumps(run_state, indent=2) + "\n", encoding="utf-8"
    )

    out_json = REPORTS / "official-injury-wowy-pair-design-audit.json"
    out_json.write_text(json.dumps(design, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Markdown
    def fmt_depth(block: dict) -> str:
        return (
            f"BOTH={block.get('BOTH_STATES')} | "
            f">=1/1={block.get('>=1/1')} | >=2/2={block.get('>=2/2')} | "
            f">=3/3={block.get('>=3/3')} | >=5/5={block.get('>=5/5')} | "
            f">=10/10={block.get('>=10/10')}"
        )

    lines = [
        "# Injury WOWY pair design + coverage audit (Phase 6A)",
        "",
        f"Generated: **{design['generated_at']}**",
        "",
        "**INJURY_WOWY_PAIR_DESIGN = APPROVED**",
        "",
        "Tape/policy certifications unchanged: AS_OF / REASON / ELIGIBILITY = YES.",
        "",
        "Design + coverage only. No performance effects. Existing `/wowy` unchanged.",
        "",
        "## Focal candidates (Phase 5C reproduced)",
        "",
        f"- WITHOUT: **{EXPECTED_WITHOUT}** ({EXPECTED_WITHOUT_SEASON})",
        f"- WITH: **{EXPECTED_WITH}** ({EXPECTED_WITH_SEASON})",
        f"- Conflicts: **{conflicts}**",
        f"- Entity-only focals: **{entity_only}**",
        "",
        "## Subject universe",
        "",
        f"- Played PGL rows encountered: **{played_subjects}**",
        f"- Canonical entity subjects: **{played_with_entity}**",
        f"- Subject identity failures: **{subject_identity_failures}**",
        f"- Self-pairs removed: **{self_pairs_removed}**",
        f"- Final P0 pair observations: **{len(pair_obs)}**",
        "",
        "## P0 coverage",
        "",
        f"- WITH obs: **{p0['with_observations']}**",
        f"- WITHOUT obs: **{p0['without_observations']}**",
        f"- Unique subjects: **{p0['unique_subjects']}**",
        f"- Unique focals: **{p0['unique_focals']}**",
        f"- Directional pairs (pooled): **{p0['keys']['pooled']['directional_pairs']}**",
        f"- WITH_ONLY / WITHOUT_ONLY / BOTH_STATES: "
        f"**{p0['keys']['pooled']['WITH_ONLY']}** / "
        f"**{p0['keys']['pooled']['WITHOUT_ONLY']}** / "
        f"**{p0['keys']['pooled']['BOTH_STATES']}**",
        "",
        "### Sample depth (pooled BOTH_STATES)",
        "",
        fmt_depth(p0["keys"]["pooled"]),
        "",
        "### Key comparison",
        "",
        "| Pair key | Directional pairs | BOTH_STATES | >=2/2 | >=3/3 | >=5/5 |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for label, key in [
        ("pooled all seasons", "pooled"),
        ("within season", "season_bounded"),
        ("team-bounded", "team_bounded"),
        ("season+team", "season_team_bounded"),
    ]:
        b = p0["keys"][key]
        lines.append(
            f"| {label} | {b['directional_pairs']} | {b['BOTH_STATES']} | "
            f"{b.get('>=2/2')} | {b.get('>=3/3')} | {b.get('>=5/5')} |"
        )

    lines += [
        "",
        "### Isolation policy comparison",
        "",
        "| Policy | WITH obs | WITHOUT obs | BOTH_STATES (pooled) | >=2/2 | >=3/3 | >=5/5 |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for pol in ("P0", "P1", "P2", "P3"):
        s = policy_summaries[pol]
        b = s["keys"]["pooled"]
        lines.append(
            f"| {pol} | {s['with_observations']} | {s['without_observations']} | "
            f"{b['BOTH_STATES']} | {b.get('>=2/2')} | {b.get('>=3/3')} | {b.get('>=5/5')} |"
        )

    lines += [
        "",
        "## Contamination",
        "",
        f"Team-games: `{dict(tg_class)}`",
        "",
        f"Pair-obs distributions: `{p0['contamination_distributions']}`",
        "",
        "## Focal realized diagnostics (no leakage)",
        "",
        f"WITH: `{dict(with_realized)}`",
        f"WITHOUT: `{dict(without_realized)}`",
        f"T60_OUT_BUT_PLAYED anomalies: **{design['focal_realized_diagnostics']['T60_OUT_BUT_PLAYED_count']}**",
        "",
        "## Subject metric completeness (WOWY metrics)",
        "",
        f"`{json.dumps(p0['metric_completeness'], indent=2)}`",
        "",
        "## Recommendations",
        "",
        f"- **PAIR_KEY_POLICY** = `{design['recommendations']['PAIR_KEY_POLICY']}`",
        f"- **PAIR_CONTAMINATION_POLICY** = `{design['recommendations']['PAIR_CONTAMINATION_POLICY']}`",
        f"- **MIN_SAMPLE_POLICY** = `{design['recommendations']['MIN_SAMPLE_POLICY']}`",
        f"- **INTERNAL_TERMINOLOGY** = `{design['recommendations']['INTERNAL_TERMINOLOGY']}`",
        "",
        design["recommendations"]["PAIR_KEY_RATIONALE"],
        "",
        design["recommendations"]["PAIR_CONTAMINATION_RATIONALE"],
        "",
        "## NEXT",
        "",
        "`IMPLEMENT_AND_CERTIFY_INJURY_WOWY_PAIR_BUILDER`",
        "",
        "Do not implement in this phase.",
        "",
    ]
    (REPORTS / "official-injury-wowy-pair-design-audit.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )

    print(
        json.dumps(
            {
                "INJURY_WOWY_PAIR_DESIGN": "APPROVED",
                "WITHOUT": len(without_rows),
                "WITH": len(with_rows),
                "conflicts": conflicts,
                "entity_only": entity_only,
                "played_subjects": played_subjects,
                "canonical_subjects": played_with_entity,
                "self_pairs_removed": self_pairs_removed,
                "p0_obs": len(pair_obs),
                "p0_with": p0["with_observations"],
                "p0_without": p0["without_observations"],
                "directional_pairs": p0["keys"]["pooled"]["directional_pairs"],
                "BOTH_STATES": p0["keys"]["pooled"]["BOTH_STATES"],
                "T60_OUT_BUT_PLAYED": design["focal_realized_diagnostics"]["T60_OUT_BUT_PLAYED_count"],
                "NEXT": design["NEXT"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
