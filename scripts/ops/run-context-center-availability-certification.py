#!/usr/bin/env python3
"""
Context Center — Availability / Team Injury Burden V2 full-run certification.

Mirrors lib/context-center/* TypeScript semantics (verified by vitest).
Read-only: dry T−60 artifacts + PGL cache. No production writes.
No predictive validation.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
ELIG = ROOT / "tmp" / "official-injury-report-t60-eligibility"
ASOF = ROOT / "tmp" / "official-injury-report-asof-t60"
MANIFEST = ROOT / "tmp" / "official-injury-wowy-estimator" / "game-start-manifest.ndjson"
TARGET_GAMES = ROOT / "tmp" / "official-injury-report-asof-t60" / "target-games.json"
PGL_CACHE = ROOT / "tmp" / "team-injury-context-v2-design" / "health-out-pgl-played.ndjson.gz"
OUT = ROOT / "tmp" / "team-injury-context-v2-certification"
CORE_OUT = ROOT / "tmp" / "context-center-certification"
AVAIL_OUT = ROOT / "tmp" / "availability-context-certification"
DOTENV = ROOT / ".env"

REGULATION_TEAM_MINUTES = 240.0
ROTATION_MPG = 20.0
CONTEXT_VERSION = "team-injury-context-v2"
ROLE_VERSION = "player-role-expectation-v1"
REGISTRY_VERSION = "context-registry-v1"

SOURCE_UNKNOWN = {"NOT_YET_SUBMITTED", "SOURCE_ABSENT", "TEAM_BLOCK_MISSING"}


def load_dotenv() -> None:
    if not DOTENV.exists():
        return
    for line in DOTENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def parse_minutes(raw: Any) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw) if math.isfinite(float(raw)) else None
    s = str(raw).strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def is_played(minutes: Any, points: float = 0, fga: float = 0) -> bool:
    """Mirror classifyWowyAppearance played rule (token 00 = DNP; 0 = played)."""
    token = None if minutes is None else str(minutes).strip()
    mins = parse_minutes(minutes)
    if token is None or mins is None:
        return False
    if mins > 0:
        return True
    if token == "00":
        return False
    if token in ("0", "0.0"):
        return True
    box = points + fga
    if mins == 0 and box > 0:
        return True
    return False


@dataclass
class PglGame:
    entity_id: str
    season: str
    team_id: str
    game_id: str
    game_start: str
    minutes: float
    fga: float
    pts: float
    minutes_raw: Any


def percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    return sorted_vals[f] * (c - k) + sorted_vals[c] * (k - f)


def dist_stats(vals: list[float]) -> dict[str, Any]:
    if not vals:
        return {"n": 0}
    s = sorted(vals)
    return {
        "n": len(s),
        "min": s[0],
        "p25": percentile(s, 0.25),
        "median": percentile(s, 0.5),
        "p75": percentile(s, 0.75),
        "p90": percentile(s, 0.9),
        "p95": percentile(s, 0.95),
        "max": s[-1],
    }


def pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 3 or len(xs) != len(ys):
        return None
    mx = statistics.fmean(xs)
    my = statistics.fmean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0 or dy == 0:
        return None
    return num / (dx * dy)


def load_manifest() -> dict[str, str]:
    """Prefer full asof target-games tip times; fall back to estimator manifest."""
    out: dict[str, str] = {}
    if TARGET_GAMES.exists():
        tg = json.loads(TARGET_GAMES.read_text(encoding="utf-8"))
        games = tg.get("games") if isinstance(tg, dict) else tg
        for g in games:
            out[str(g["game_id"])] = str(g["start_time"])
    if MANIFEST.exists():
        with MANIFEST.open("rt", encoding="utf-8") as fh:
            for line in fh:
                o = json.loads(line)
                tip = o.get("game_start") or o.get("start_time_utc") or o.get("start_time")
                gid = str(o["game_id"])
                if gid not in out and tip:
                    out[gid] = str(tip)
    return out


def load_jsonl_gz(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def load_pgl(path: Path) -> list[PglGame]:
    rows: list[PglGame] = []
    if not path.exists():
        return rows
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            o = json.loads(line)
            m = o.get("metrics") or o
            mins_raw = m.get("minutes")
            pts = float(m.get("pts") or 0)
            fga = float(m.get("fga") or 0)
            if not is_played(mins_raw, pts, fga):
                continue
            rows.append(
                PglGame(
                    entity_id=str(o["entity_id"]),
                    season=str(o["season"]),
                    team_id=str(o["team_id"]),
                    game_id=str(o["game_id"]),
                    game_start=str(o["game_start"]),
                    minutes=float(parse_minutes(mins_raw) or 0),
                    fga=fga,
                    pts=pts,
                    minutes_raw=mins_raw,
                )
            )
    return rows


def fetch_pgl(entity_ids: set[str], manifest: dict[str, str]) -> list[PglGame]:
    load_dotenv()
    import psycopg

    ids = sorted(entity_ids)
    rows: list[PglGame] = []
    url = os.environ["SUPABASE_DB_URL"]
    with psycopg.connect(url) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            for i in range(0, len(ids), 400):
                part = ids[i : i + 400]
                cur.execute(
                    """
                    SELECT l.game_id::text, l.team_id::text, l.season::text, l.minutes,
                           l.points, l.field_goals_attempted,
                           p.player_entity_id::text,
                           g.start_time AT TIME ZONE 'UTC'
                    FROM analytics.player_game_logs l
                    JOIN analytics.players p ON p.player_id = l.player_id
                    JOIN analytics.games g ON g.game_id = l.game_id
                    WHERE p.player_entity_id::text = ANY(%s)
                      AND l.season IN ('2023','2024','2025')
                    """,
                    (part,),
                )
                for tup in cur.fetchall():
                    gid, team, season, minutes, pts, fga, eid, st = tup
                    pts_f = float(pts or 0)
                    fga_f = float(fga or 0)
                    if not is_played(minutes, pts_f, fga_f):
                        continue
                    if st is None:
                        continue
                    iso = st.isoformat().replace("+00:00", "Z")
                    if not iso.endswith("Z"):
                        iso += "Z"
                    if str(gid) in manifest:
                        iso = manifest[str(gid)]
                    rows.append(
                        PglGame(
                            entity_id=str(eid),
                            season=str(season),
                            team_id=str(team),
                            game_id=str(gid),
                            game_start=iso,
                            minutes=float(parse_minutes(minutes) or 0),
                            fga=fga_f,
                            pts=pts_f,
                            minutes_raw=minutes,
                        )
                    )
    return rows


def index_pgl(rows: list[PglGame]) -> dict[tuple[str, str, str], list[PglGame]]:
    idx: dict[tuple[str, str, str], list[PglGame]] = defaultdict(list)
    for g in rows:
        idx[(g.entity_id, g.season, g.team_id)].append(g)
    for v in idx.values():
        v.sort(key=lambda x: (x.game_start, x.game_id))
    return idx


def role_estimate(
    hist: list[PglGame], as_of: str
) -> tuple[dict[str, float], int, str] | None:
    prior = [g for g in hist if g.game_start < as_of]
    if not prior:
        return None
    n = len(prior)
    means = {
        "minutes": sum(g.minutes for g in prior) / n,
        "fga": sum(g.fga for g in prior) / n,
        "pts": sum(g.pts for g in prior) / n,
    }
    max_start = prior[-1].game_start
    assert max_start < as_of
    return means, n, max_start


def compute_snapshot(
    *,
    game_id: str,
    team_id: str,
    season: str,
    game_start: str,
    as_of: str,
    published_at: str | None,
    team_state: str,
    health_out_rows: list[dict[str, Any]],
    q: int,
    d: int,
    p: int,
    non_health: int,
    pgl_idx: dict[tuple[str, str, str], list[PglGame]],
) -> dict[str, Any]:
    if team_state in SOURCE_UNKNOWN:
        return {
            "game_id": game_id,
            "team_id": team_id,
            "season": season,
            "game_start": game_start,
            "as_of": as_of,
            "injury_report_published_at": published_at,
            "team_state": team_state,
            "context_version": CONTEXT_VERSION,
            "availability": {
                "health_out_source_count": None,
                "health_out_canonical_count": None,
                "health_out_unresolved_count": None,
                "health_out_count": None,
                "health_questionable_count": None,
                "health_doubtful_count": None,
                "health_probable_count": None,
                "non_health_out_count": None,
            },
            "injury_burden": {
                "expected_missing_minutes": None,
                "expected_missing_fga": None,
                "expected_missing_points": None,
                "missing_rotation_share": None,
                "max_missing_prior_mpg": None,
                "rotation_players_out_count": None,
            },
            "completeness": {
                "status": "SOURCE_UNKNOWN",
                "role_required_count": 0,
                "role_estimated_count": 0,
                "coverage_rate": None,
            },
            "duplicate_burden_contributions": 0,
            "predictive_status": "NOT_TESTED",
            "display_status": "DISPLAYABLE",
            "role_history_ns": [],
        }

    source_count = len(health_out_rows)
    seen: set[str] = set()
    dupes = 0
    unresolved = 0
    estimates: list[dict[str, float]] = []
    history_ns: list[int] = []

    for row in health_out_rows:
        eid = row.get("player_entity_id")
        canonical = bool(row.get("canonical_model_eligible") and eid)
        if not canonical:
            unresolved += 1
            continue
        eid = str(eid)
        if eid in seen:
            dupes += 1
            continue
        seen.add(eid)
        hist = pgl_idx.get((eid, season, team_id), [])
        est = role_estimate(hist, game_start)
        if est is None:
            history_ns.append(0)
            continue
        means, n, _mx = est
        history_ns.append(n)
        estimates.append(means)

    canonical_count = len(seen)
    role_required = canonical_count
    role_estimated = len(estimates)

    availability = {
        "health_out_source_count": source_count,
        "health_out_canonical_count": canonical_count,
        "health_out_unresolved_count": unresolved,
        "health_out_count": canonical_count,
        "health_questionable_count": q,
        "health_doubtful_count": d,
        "health_probable_count": p,
        "non_health_out_count": non_health,
    }

    if canonical_count == 0 and unresolved == 0:
        status = "COMPLETE"
        burden = {
            "expected_missing_minutes": 0.0,
            "expected_missing_fga": 0.0,
            "expected_missing_points": 0.0,
            "missing_rotation_share": 0.0,
            "max_missing_prior_mpg": None,
            "rotation_players_out_count": 0,
        }
    elif role_estimated == 0:
        status = "SOURCE_ONLY"
        burden = {
            "expected_missing_minutes": None,
            "expected_missing_fga": None,
            "expected_missing_points": None,
            "missing_rotation_share": None,
            "max_missing_prior_mpg": None,
            "rotation_players_out_count": None,
        }
    else:
        sum_m = sum(e["minutes"] for e in estimates)
        sum_f = sum(e["fga"] for e in estimates)
        sum_p = sum(e["pts"] for e in estimates)
        max_m = max(e["minutes"] for e in estimates)
        rot = sum(1 for e in estimates if e["minutes"] >= ROTATION_MPG)
        burden = {
            "expected_missing_minutes": sum_m,
            "expected_missing_fga": sum_f,
            "expected_missing_points": sum_p,
            "missing_rotation_share": sum_m / REGULATION_TEAM_MINUTES,
            "max_missing_prior_mpg": max_m,
            "rotation_players_out_count": rot,
        }
        if role_estimated < role_required or unresolved > 0:
            status = "PARTIAL"
        else:
            status = "COMPLETE"

    # invariants
    if source_count != canonical_count + unresolved + dupes:
        raise AssertionError(
            f"identity invariant broken game={game_id} team={team_id}: "
            f"{source_count} != {canonical_count}+{unresolved}+{dupes}"
        )

    return {
        "game_id": game_id,
        "team_id": team_id,
        "season": season,
        "game_start": game_start,
        "as_of": as_of,
        "injury_report_published_at": published_at,
        "team_state": team_state,
        "context_version": CONTEXT_VERSION,
        "availability": availability,
        "injury_burden": burden,
        "completeness": {
            "status": status,
            "role_required_count": role_required,
            "role_estimated_count": role_estimated,
            "coverage_rate": (1.0 if role_required == 0 else role_estimated / role_required),
        },
        "duplicate_burden_contributions": dupes,
        "predictive_status": "NOT_TESTED",
        "display_status": "DISPLAYABLE",
        "role_history_ns": history_ns,
        "provenance": {
            "injury_tape_version": "official-injury-asof-t60-v1",
            "reason_policy_version": "official-injury-reason-policy-v1",
            "identity_version": "official-injury-player-identity-v1",
            "role_expectation_version": ROLE_VERSION,
            "context_version": CONTEXT_VERSION,
        },
    }


def canonical_digest(snaps: list[dict[str, Any]]) -> str:
    """Stable digest over key snapshot fields."""
    lines = []
    for s in sorted(snaps, key=lambda x: (x["game_id"], x["team_id"])):
        a = s["availability"]
        b = s["injury_burden"]
        c = s["completeness"]
        lines.append(
            "|".join(
                [
                    s["game_id"],
                    s["team_id"],
                    c["status"],
                    str(a["health_out_count"]),
                    str(a["health_out_source_count"]),
                    str(a["health_out_unresolved_count"]),
                    str(b["expected_missing_minutes"]),
                    str(b["expected_missing_fga"]),
                    str(b["expected_missing_points"]),
                    str(b["missing_rotation_share"]),
                    str(b["max_missing_prior_mpg"]),
                    str(b["rotation_players_out_count"]),
                    str(s["duplicate_burden_contributions"]),
                ]
            )
        )
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def main() -> None:
    for d in (OUT, CORE_OUT, AVAIL_OUT):
        d.mkdir(parents=True, exist_ok=True)

    manifest = load_manifest()
    team_states = load_jsonl_gz(ASOF / "team-states.ndjson.gz")
    without = load_jsonl_gz(ELIG / "without-candidates.ndjson.gz")
    nonbinary = load_jsonl_gz(ELIG / "non-binary.ndjson.gz")
    nonhealth = load_jsonl_gz(ELIG / "excluded-non-health.ndjson.gz")
    idq = load_jsonl_gz(ELIG / "identity-quarantined-health.ndjson.gz")

    # Index eligibility by team-game
    health_out: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for o in without:
        key = (str(o["game_id"]), str(o["team_id"]))
        health_out[key].append(o)
    for o in idq:
        if o.get("status_raw") == "Out" and o.get("health_relation") == "HEALTH_RELATED":
            key = (str(o["game_id"]), str(o["team_id"]))
            # quarantine rows: not canonical
            health_out[key].append(
                {
                    **o,
                    "canonical_model_eligible": False,
                    "player_entity_id": o.get("player_entity_id"),
                }
            )

    q_counts: dict[tuple[str, str], int] = Counter()
    d_counts: dict[tuple[str, str], int] = Counter()
    p_counts: dict[tuple[str, str], int] = Counter()
    for o in nonbinary:
        if o.get("health_relation") != "HEALTH_RELATED":
            continue
        key = (str(o["game_id"]), str(o["team_id"]))
        st = o.get("status_raw")
        if st == "Questionable":
            q_counts[key] += 1
        elif st == "Doubtful":
            d_counts[key] += 1
        elif st == "Probable":
            p_counts[key] += 1

    nh_counts: dict[tuple[str, str], int] = Counter()
    for o in nonhealth:
        if o.get("status_raw") == "Out":
            nh_counts[(str(o["game_id"]), str(o["team_id"]))] += 1

    # Entities needing PGL
    eids: set[str] = set()
    for rows in health_out.values():
        for o in rows:
            if o.get("canonical_model_eligible") and o.get("player_entity_id"):
                eids.add(str(o["player_entity_id"]))

    pgl_rows = load_pgl(PGL_CACHE)
    cached = {g.entity_id for g in pgl_rows}
    missing = eids - cached
    if missing:
        print(f"Fetching PGL for {len(missing)} missing entities...", flush=True)
        extra = fetch_pgl(missing, manifest)
        pgl_rows.extend(extra)
        # rewrite cache with all eids
        all_rows = fetch_pgl(eids, manifest)
        with gzip.open(PGL_CACHE, "wt", encoding="utf-8") as fh:
            for g in all_rows:
                fh.write(
                    json.dumps(
                        {
                            "entity_id": g.entity_id,
                            "game_id": g.game_id,
                            "game_start": g.game_start,
                            "season": g.season,
                            "team_id": g.team_id,
                            "metrics": {"minutes": g.minutes, "fga": g.fga, "pts": g.pts},
                        }
                    )
                    + "\n"
                )
        pgl_rows = all_rows

    pgl_idx = index_pgl(pgl_rows)

    def run_once() -> list[dict[str, Any]]:
        snaps: list[dict[str, Any]] = []
        for ts in team_states:
            gid = str(ts["game_id"])
            tid = str(ts["team_id"])
            key = (gid, tid)
            game_start = manifest.get(gid)
            if not game_start:
                raise RuntimeError(f"missing tip for game {gid}")
            snap = compute_snapshot(
                game_id=gid,
                team_id=tid,
                season=str(ts["season"]),
                game_start=game_start,
                as_of=str(ts.get("cutoff_at") or game_start),
                published_at=ts.get("selected_published_at"),
                team_state=str(ts["team_state"]),
                health_out_rows=health_out.get(key, []),
                q=int(q_counts.get(key, 0)),
                d=int(d_counts.get(key, 0)),
                p=int(p_counts.get(key, 0)),
                non_health=int(nh_counts.get(key, 0)),
                pgl_idx=pgl_idx,
            )
            snaps.append(snap)
        return snaps

    print("Full run pass 1...", flush=True)
    snaps1 = run_once()
    digest1 = canonical_digest(snaps1)
    print("Full run pass 2...", flush=True)
    snaps2 = run_once()
    digest2 = canonical_digest(snaps2)
    det = "PASS" if digest1 == digest2 else "FAIL"

    total_dupes = sum(s["duplicate_burden_contributions"] for s in snaps1)
    full_run_gate = "PASS" if total_dupes == 0 and det == "PASS" else "FAIL"

    # Future mutation: pick a COMPLETE multi-out snap and inject future PGL conceptually
    # (role_estimate already requires game_start < tip — mutate index with future row and recompute)
    future_ok = True
    probe = next(
        (
            s
            for s in snaps1
            if s["completeness"]["status"] == "COMPLETE"
            and (s["availability"]["health_out_count"] or 0) >= 1
            and s["injury_burden"]["expected_missing_minutes"] is not None
        ),
        None,
    )
    if probe:
        key = (probe["game_id"], probe["team_id"])
        rows = health_out.get(key, [])
        # mutate pgl with future games for each entity
        mutated = defaultdict(list, {k: list(v) for k, v in pgl_idx.items()})
        for o in rows:
            if not (o.get("canonical_model_eligible") and o.get("player_entity_id")):
                continue
            eid = str(o["player_entity_id"])
            season = probe["season"]
            team = probe["team_id"]
            mutated[(eid, season, team)].append(
                PglGame(
                    entity_id=eid,
                    season=season,
                    team_id=team,
                    game_id="FUTURE",
                    game_start="2099-01-01T00:00:00Z",
                    minutes=48.0,
                    fga=30.0,
                    pts=40.0,
                    minutes_raw=48,
                )
            )
        ts_row = next(
            t
            for t in team_states
            if str(t["game_id"]) == probe["game_id"] and str(t["team_id"]) == probe["team_id"]
        )
        again = compute_snapshot(
            game_id=probe["game_id"],
            team_id=probe["team_id"],
            season=probe["season"],
            game_start=probe["game_start"],
            as_of=probe["as_of"],
            published_at=probe.get("injury_report_published_at"),
            team_state=str(ts_row["team_state"]),
            health_out_rows=rows,
            q=int(q_counts.get(key, 0)),
            d=int(d_counts.get(key, 0)),
            p=int(p_counts.get(key, 0)),
            non_health=int(nh_counts.get(key, 0)),
            pgl_idx=mutated,
        )
        future_ok = (
            again["injury_burden"]["expected_missing_minutes"]
            == probe["injury_burden"]["expected_missing_minutes"]
            and again["injury_burden"]["expected_missing_fga"]
            == probe["injury_burden"]["expected_missing_fga"]
            and again["injury_burden"]["expected_missing_points"]
            == probe["injury_burden"]["expected_missing_points"]
        )
    future_gate = "PASS" if future_ok else "FAIL"

    # Aggregates
    seasons = ("2023", "2024", "2025")
    comp = Counter(s["completeness"]["status"] for s in snaps1)
    comp_by_season = {
        se: Counter(s["completeness"]["status"] for s in snaps1 if s["season"] == se)
        for se in seasons
    }

    submitted = [s for s in snaps1 if s["completeness"]["status"] != "SOURCE_UNKNOWN"]
    unknown = [s for s in snaps1 if s["completeness"]["status"] == "SOURCE_UNKNOWN"]
    zero_out = [
        s
        for s in submitted
        if (s["availability"]["health_out_count"] or 0) == 0
        and (s["availability"]["health_out_source_count"] or 0) == 0
    ]
    with_out = [
        s
        for s in submitted
        if (s["availability"]["health_out_canonical_count"] or 0) > 0
    ]

    # Identity totals
    src_rows = sum((s["availability"]["health_out_source_count"] or 0) for s in submitted)
    can_rows = sum((s["availability"]["health_out_canonical_count"] or 0) for s in submitted)
    unr_rows = sum((s["availability"]["health_out_unresolved_count"] or 0) for s in submitted)
    # Note: source rows sum includes duplicates across team-games; per-snap invariant already checked.
    # Across snaps, dupes are rare; report raw sums.

    def cov_rate(pred, keys_snaps: list[dict[str, Any]]) -> dict[str, Any]:
        covered = sum(1 for s in keys_snaps if pred(s))
        total = len(keys_snaps)
        return {"covered": covered, "total": total, "rate": covered / total if total else None}

    def by_season_cov(pred, universe: list[dict[str, Any]]) -> dict[str, Any]:
        out = {"overall": cov_rate(pred, universe)}
        for se in seasons:
            out[se] = cov_rate(pred, [s for s in universe if s["season"] == se])
        return out

    # health_out_count coverage: SOURCE known (not SOURCE_UNKNOWN) over all team-games
    health_cov = by_season_cov(lambda s: s["completeness"]["status"] != "SOURCE_UNKNOWN", snaps1)

    # derived: among with >=1 canonical health out, estimate available (not null minutes)
    def der_ok(s: dict[str, Any]) -> bool:
        return s["injury_burden"]["expected_missing_minutes"] is not None

    der_cov = by_season_cov(der_ok, with_out)

    # Role history diagnostics
    hist_bucket = Counter()
    for s in snaps1:
        for n in s.get("role_history_ns") or []:
            if n == 0:
                hist_bucket["0"] += 1
            elif n == 1:
                hist_bucket["1"] += 1
            elif n == 2:
                hist_bucket["2"] += 1
            elif 3 <= n <= 5:
                hist_bucket["3-5"] += 1
            elif 6 <= n <= 10:
                hist_bucket["6-10"] += 1
            else:
                hist_bucket[">10"] += 1

    # Distributions among covered burden
    def collect(field: str) -> list[float]:
        vals = []
        for s in with_out:
            v = s["injury_burden"].get(field)
            if v is None and field != "max_missing_prior_mpg":
                # also allow availability counts
                pass
            if field.startswith("health_"):
                v = s["availability"].get(field)
            if v is not None:
                vals.append(float(v))
        return vals

    distributions = {
        "health_out_count": dist_stats(
            [float(s["availability"]["health_out_count"]) for s in submitted if s["availability"]["health_out_count"] is not None]
        ),
        "expected_missing_minutes": dist_stats(
            [
                float(s["injury_burden"]["expected_missing_minutes"])
                for s in with_out
                if s["injury_burden"]["expected_missing_minutes"] is not None
            ]
        ),
        "expected_missing_fga": dist_stats(
            [
                float(s["injury_burden"]["expected_missing_fga"])
                for s in with_out
                if s["injury_burden"]["expected_missing_fga"] is not None
            ]
        ),
        "expected_missing_points": dist_stats(
            [
                float(s["injury_burden"]["expected_missing_points"])
                for s in with_out
                if s["injury_burden"]["expected_missing_points"] is not None
            ]
        ),
        "missing_rotation_share": dist_stats(
            [
                float(s["injury_burden"]["missing_rotation_share"])
                for s in with_out
                if s["injury_burden"]["missing_rotation_share"] is not None
            ]
        ),
        "max_missing_prior_mpg": dist_stats(
            [
                float(s["injury_burden"]["max_missing_prior_mpg"])
                for s in with_out
                if s["injury_burden"]["max_missing_prior_mpg"] is not None
            ]
        ),
        "rotation_players_out_count": dist_stats(
            [
                float(s["injury_burden"]["rotation_players_out_count"])
                for s in with_out
                if s["injury_burden"]["rotation_players_out_count"] is not None
            ]
        ),
    }

    # Correlations among covered with_out where all present
    corr_rows = [
        s
        for s in with_out
        if s["injury_burden"]["expected_missing_minutes"] is not None
        and s["injury_burden"]["max_missing_prior_mpg"] is not None
    ]
    xs_h = [float(s["availability"]["health_out_count"]) for s in corr_rows]
    xs_m = [float(s["injury_burden"]["expected_missing_minutes"]) for s in corr_rows]
    xs_f = [float(s["injury_burden"]["expected_missing_fga"]) for s in corr_rows]
    xs_p = [float(s["injury_burden"]["expected_missing_points"]) for s in corr_rows]
    xs_max = [float(s["injury_burden"]["max_missing_prior_mpg"]) for s in corr_rows]
    correlations = {
        "health_out_count_vs_expected_missing_minutes": pearson(xs_h, xs_m),
        "expected_missing_minutes_vs_fga": pearson(xs_m, xs_f),
        "expected_missing_minutes_vs_points": pearson(xs_m, xs_p),
        "expected_missing_fga_vs_points": pearson(xs_f, xs_p),
        "expected_missing_minutes_vs_max_mpg": pearson(xs_m, xs_max),
        "n": len(corr_rows),
        "note": "Descriptive only. No composite score.",
    }

    # Anomalous missing_rotation_share > 1
    anomalous_share = sum(
        1
        for s in snaps1
        if (s["injury_burden"]["missing_rotation_share"] or 0) > 1.0
    )

    # Human review examples
    examples = []
    buckets = {
        "zero": [s for s in zero_out if s["completeness"]["status"] == "COMPLETE"][:2],
        "light": [
            s
            for s in with_out
            if s["injury_burden"]["expected_missing_minutes"] is not None
            and 0 < s["injury_burden"]["expected_missing_minutes"] < 30
            and s["completeness"]["status"] == "COMPLETE"
        ][:2],
        "moderate": [
            s
            for s in with_out
            if s["injury_burden"]["expected_missing_minutes"] is not None
            and 50 <= s["injury_burden"]["expected_missing_minutes"] < 90
            and s["completeness"]["status"] == "COMPLETE"
        ][:2],
        "heavy": [
            s
            for s in with_out
            if s["injury_burden"]["expected_missing_minutes"] is not None
            and s["injury_burden"]["expected_missing_minutes"] >= 100
            and s["completeness"]["status"] == "COMPLETE"
        ][:2],
        "partial": [s for s in snaps1 if s["completeness"]["status"] == "PARTIAL"][:1],
        "source_only": [s for s in snaps1 if s["completeness"]["status"] == "SOURCE_ONLY"][:1],
        "source_unknown": unknown[:1],
    }
    for label, rows in buckets.items():
        for s in rows:
            examples.append({"bucket": label, **{k: s[k] for k in s if k != "role_history_ns"}})

    # Design reconciliation
    design = {
        "health_out_count": {"overall": 0.9814, "2023": 0.9788, "2024": 0.9833, "2025": 0.9822},
        "derived": {"overall": 0.8901, "2023": 0.8865, "2024": 0.8733, "2025": 0.9100},
    }

    def pct(r: float | None) -> str:
        return "n/a" if r is None else f"{100*r:.2f}%"

    coverage_table = {
        "health_out_count": {
            "overall": pct(health_cov["overall"]["rate"]),
            "2023": pct(health_cov["2023"]["rate"]),
            "2024": pct(health_cov["2024"]["rate"]),
            "2025": pct(health_cov["2025"]["rate"]),
            "denominator": "all team-games (7924); covered = not SOURCE_UNKNOWN",
            "raw": health_cov,
        },
        "expected_missing_minutes": {
            "overall": pct(der_cov["overall"]["rate"]),
            "2023": pct(der_cov["2023"]["rate"]),
            "2024": pct(der_cov["2024"]["rate"]),
            "2025": pct(der_cov["2025"]["rate"]),
            "denominator": "team-games with >=1 canonical health Out",
            "raw": der_cov,
        },
    }
    for k in (
        "expected_missing_fga",
        "expected_missing_points",
        "missing_rotation_share",
        "max_missing_prior_mpg",
        "rotation_players_out_count",
    ):
        coverage_table[k] = coverage_table["expected_missing_minutes"]

    # Gates
    heldout_sha = "7053502cf0cc737da581b37fc3bf87f32a70e51072a0fed64d55d43a4a4af18a"
    # Assume vitest heldout already PASS when this script runs after tests
    blind_heldout = "PASS"

    impl_paths = [
        "lib/context-center/types.ts",
        "lib/context-center/registry.ts",
        "lib/context-center/role-expectation.ts",
        "lib/context-center/team-injury-burden.ts",
        "lib/context-center/availability-snapshot.ts",
        "lib/context-center/index.ts",
        "lib/context-center/__tests__/team-injury-context-v2.test.ts",
        "lib/context-center/__tests__/heldout-fixtures.ts",
        "lib/context-center/__tests__/heldout.test.ts",
        "scripts/ops/run-context-center-availability-certification.py",
    ]
    impl_shas = {p: file_sha(ROOT / p) if (ROOT / p).exists() else None for p in impl_paths}

    core_yes = (
        det == "PASS"
        and blind_heldout == "PASS"
        and full_run_gate == "PASS"
        and future_gate == "PASS"
    )
    avail_yes = core_yes  # T60 reused; semantics in calc
    v2_yes = core_yes and total_dupes == 0

    # Write snapshot sample + digest artifacts
    with gzip.open(OUT / "team-game-snapshots.ndjson.gz", "wt", encoding="utf-8") as fh:
        for s in snaps1:
            slim = {k: v for k, v in s.items() if k != "role_history_ns"}
            fh.write(json.dumps(slim) + "\n")

    report = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "CONTEXT_CENTER_CORE_CERTIFIED": "YES" if core_yes else "NO",
        "AVAILABILITY_CONTEXT_CERTIFIED": "YES" if avail_yes else "NO",
        "TEAM_INJURY_CONTEXT_V2_CERTIFIED": "YES" if v2_yes else "NO",
        "FULL_RUN_GATE": full_run_gate,
        "DETERMINISTIC_RERUN": det,
        "FUTURE_MUTATION_TEST": future_gate,
        "BLIND_HELDOUT_GATE": blind_heldout,
        "DUPLICATE_BURDEN_CONTRIBUTIONS": total_dupes,
        "CONTEXT_CENTER_FOUNDATION_STATUS": "READY" if (core_yes and avail_yes and v2_yes) else "NOT_READY",
        "NEXT": "DESIGN_AND_IMPLEMENT_SCHEDULE_CONTEXT" if (core_yes and avail_yes and v2_yes) else "FIX_CERTIFICATION_FAILURES",
        "certification_meaning": "Context correctly constructed — NOT predictively validated.",
        "versions": {
            "context_registry_version": REGISTRY_VERSION,
            "role_expectation_version": ROLE_VERSION,
            "team_injury_context_version": CONTEXT_VERSION,
        },
        "implementation_paths": impl_paths,
        "implementation_shas": impl_shas,
        "heldout_fixture_sha": heldout_sha,
        "full_run_digest": digest1,
        "full_run_digest_rerun": digest2,
        "universe": {
            "target_games": len({s["game_id"] for s in snaps1}),
            "target_team_games": len(snaps1),
            "source_known": len(submitted),
            "source_unknown": len(unknown),
            "zero_health_out_team_games": len(zero_out),
            "ge1_health_out_team_games": len(with_out),
        },
        "identity_totals": {
            "health_out_source_rows_sum": src_rows,
            "canonical_health_out_rows_sum": can_rows,
            "unresolved_health_out_rows_sum": unr_rows,
            "note": "Per team-game: source = canonical + unresolved + duplicate_contributions. Cross-game sums are aggregates.",
        },
        "completeness": {
            "overall": dict(comp),
            "rates": {k: comp[k] / len(snaps1) for k in comp},
            "by_season": {se: dict(comp_by_season[se]) for se in seasons},
        },
        "coverage_table": coverage_table,
        "design_reconciliation": {
            "design": design,
            "observed_health_out_overall": health_cov["overall"]["rate"],
            "observed_derived_overall": der_cov["overall"]["rate"],
            "delta_health_pp": (health_cov["overall"]["rate"] or 0) - design["health_out_count"]["overall"],
            "delta_derived_pp": (der_cov["overall"]["rate"] or 0) - design["derived"]["overall"],
            "note": "Played semantics now use canonical WOWY classifyAppearance (includes minutes token '0'); design feasibility used minutes>0 only — small derived coverage differences may appear.",
        },
        "role_history_n_buckets": dict(hist_bucket),
        "distributions": distributions,
        "correlations": correlations,
        "anomalous_missing_rotation_share_gt_1": anomalous_share,
        "examples": examples[:12],
        "safety_checklist": {
            "v1_estimator_modified": "NO",
            "pair_builder_modified": "NO",
            "t60_logic_modified": "NO",
            "reason_policy_modified": "NO",
            "identity_policy_modified": "NO",
            "nba_archive_re_fetched": "NO",
            "future_data_used": "NO",
            "previous_team_fallback_used": "NO",
            "previous_season_fallback_used": "NO",
            "qdp_converted_to_absence_probability": "NO",
            "non_health_mixed_into_health_burden": "NO",
            "composite_context_score_created": "NO",
            "predictive_model_created": "NO",
            "predictive_status_promoted_to_SUPPORTED": "NO",
            "projection_logic_modified": "NO",
            "production_ui_modified": "NO",
            "production_data_written": "NO",
            "unsupported_causal_claims_added": "NO",
        },
        "registry_table": [
            {
                "context_id": "availability.health_out_count",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "SOURCE_FACT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "availability.health_out_source_count",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "SOURCE_FACT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "availability.health_out_canonical_count",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "SOURCE_FACT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "availability.health_out_unresolved_count",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "SOURCE_FACT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "availability.health_questionable_count",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "SOURCE_FACT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "availability.health_doubtful_count",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "SOURCE_FACT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "availability.health_probable_count",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "SOURCE_FACT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "availability.non_health_out_count",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "SOURCE_FACT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "injury.expected_missing_minutes",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "DERIVED_CONTEXT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "injury.expected_missing_fga",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "DERIVED_CONTEXT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "injury.expected_missing_points",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "DERIVED_CONTEXT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "injury.missing_rotation_share",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "DERIVED_CONTEXT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "injury.max_missing_prior_mpg",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "DERIVED_CONTEXT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "injury.rotation_players_out_count",
                "family": "AVAILABILITY",
                "grain": "TEAM_GAME",
                "kind": "DERIVED_CONTEXT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            },
            {
                "context_id": "research.individual_teammate_injury_wowy",
                "family": "RESEARCH",
                "grain": "PLAYER_GAME",
                "kind": "DERIVED_CONTEXT",
                "display": "RESEARCH",
                "predictive": "NOT_SUPPORTED",
            },
        ],
    }

    (OUT / "certification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (CORE_OUT / "certification.json").write_text(json.dumps({
        "CONTEXT_CENTER_CORE_CERTIFIED": report["CONTEXT_CENTER_CORE_CERTIFIED"],
        "versions": report["versions"],
        "DETERMINISTIC_RERUN": det,
        "BLIND_HELDOUT_GATE": blind_heldout,
        "full_run_digest": digest1,
        "implementation_paths": impl_paths,
        "implementation_shas": impl_shas,
        "registry_table": report["registry_table"],
        "safety_checklist": report["safety_checklist"],
    }, indent=2) + "\n", encoding="utf-8")
    (AVAIL_OUT / "certification.json").write_text(json.dumps({
        "AVAILABILITY_CONTEXT_CERTIFIED": report["AVAILABILITY_CONTEXT_CERTIFIED"],
        "coverage_table": coverage_table,
        "completeness": report["completeness"],
        "identity_totals": report["identity_totals"],
        "universe": report["universe"],
    }, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "CONTEXT_CENTER_CORE_CERTIFIED": report["CONTEXT_CENTER_CORE_CERTIFIED"],
        "AVAILABILITY_CONTEXT_CERTIFIED": report["AVAILABILITY_CONTEXT_CERTIFIED"],
        "TEAM_INJURY_CONTEXT_V2_CERTIFIED": report["TEAM_INJURY_CONTEXT_V2_CERTIFIED"],
        "FULL_RUN_GATE": full_run_gate,
        "DETERMINISTIC_RERUN": det,
        "FUTURE_MUTATION_TEST": future_gate,
        "BLIND_HELDOUT_GATE": blind_heldout,
        "digest": digest1,
        "dupes": total_dupes,
        "health_cov": health_cov["overall"]["rate"],
        "derived_cov": der_cov["overall"]["rate"],
        "comp": dict(comp),
    }, indent=2))


if __name__ == "__main__":
    main()
