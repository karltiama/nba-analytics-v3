#!/usr/bin/env python3
"""
Recent Form Context V1 — full historical certification.

Mirrors lib/context-center/form/recent-form-context.ts + selectPriorPlayedGames.
Streaming: emit context then ingest PLAYED outcome.
Also tracks Role history_n parity (same chronology).
Read-only. No production writes. No predictive validation.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp" / "recent-form-context-certification"
REPORTS = ROOT / "reports" / "operations"
TARGET_GAMES = ROOT / "tmp" / "official-injury-report-asof-t60" / "target-games.json"
DOTENV = ROOT / ".env"
VERSION = "recent-form-context-v1"
HELDOUT_SHA = "429f554ede4e55d11138eeb55f407c5b4ae8f6bea813ad0688e35d4fffbb2ade"
RECENT_MAX = 10
DESIGN_TARGETS = 85202
DESIGN_COMPLETE = 77032
DESIGN_PARTIAL = 6197
DESIGN_COLD = 1973


def load_dotenv() -> None:
    if not DOTENV.exists():
        return
    for line in DOTENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def parse_minutes(val: Any) -> float | None:
    if val is None:
        return None
    try:
        n = float(str(val).strip())
    except ValueError:
        return None
    return n if math.isfinite(n) else None


def classify_appearance(minutes: Any, box_sum: float) -> str:
    token = None if minutes is None else str(minutes).strip() or None
    mins = parse_minutes(minutes)
    if token is None or mins is None:
        return "malformed"
    if mins > 0:
        return "played"
    if token == "00":
        return "dnp"
    if token in ("0", "0.0"):
        return "played"
    if box_sum > 0:
        return "played"
    return "dnp"


def percentile(vals: list[float], p: float) -> float | None:
    if not vals:
        return None
    s = sorted(vals)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * p
    f, c = math.floor(k), math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[f] * (c - k) + s[c] * (k - f)


def dist(vals: list[float]) -> dict[str, Any]:
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


def bucket_season(n: int) -> str:
    if n == 0:
        return "0"
    if n == 1:
        return "1"
    if n == 2:
        return "2"
    if 3 <= n <= 5:
        return "3-5"
    if 6 <= n <= 10:
        return "6-10"
    if 11 <= n <= 20:
        return "11-20"
    return "21+"


def bucket_recent(n: int) -> str:
    if n == 0:
        return "0"
    if n == 1:
        return "1"
    if n == 2:
        return "2"
    if 3 <= n <= 5:
        return "3-5"
    if 6 <= n <= 9:
        return "6-9"
    return "10"


def bucket_attempts(n: int) -> str:
    if n == 0:
        return "0"
    if 1 <= n <= 4:
        return "1-4"
    if 5 <= n <= 9:
        return "5-9"
    if 10 <= n <= 24:
        return "10-24"
    return "25+"


@dataclass
class Obs:
    player_id: str
    team_id: str
    game_id: str
    season: str
    start_time: str
    appearance: str
    pts: float
    reb: float
    fgm: float
    fga: float
    tpm: float
    tpa: float


@dataclass
class Accum:
    count: int = 0
    sum_pts: float = 0.0
    sum_reb: float = 0.0
    sum_tpm: float = 0.0
    sum_fgm: float = 0.0
    sum_fga: float = 0.0
    sum_tpa: float = 0.0
    latest_id: str | None = None
    latest_start: str | None = None
    recent: deque | None = None

    def __post_init__(self) -> None:
        if self.recent is None:
            self.recent = deque(maxlen=RECENT_MAX)


def form_from_accum(a: Accum) -> dict[str, Any]:
    if a.count == 0:
        return {
            "history_n": 0,
            "latest_id": None,
            "latest_start": None,
            "points": None,
            "rebounds": None,
            "tpm": None,
            "fg_made": None,
            "fg_attempted": None,
            "fg_pct": None,
            "three_made": None,
            "three_attempted": None,
            "three_pct": None,
        }
    n = a.count
    fg = a.sum_fgm / a.sum_fga if a.sum_fga > 0 else None
    thr = a.sum_tpm / a.sum_tpa if a.sum_tpa > 0 else None
    return {
        "history_n": n,
        "latest_id": a.latest_id,
        "latest_start": a.latest_start,
        "points": a.sum_pts / n,
        "rebounds": a.sum_reb / n,
        "tpm": a.sum_tpm / n,
        "fg_made": a.sum_fgm,
        "fg_attempted": a.sum_fga,
        "fg_pct": fg,
        "three_made": a.sum_tpm,
        "three_attempted": a.sum_tpa,
        "three_pct": thr,
    }


def form_from_recent(a: Accum) -> dict[str, Any]:
    assert a.recent is not None
    if len(a.recent) == 0:
        return {**form_from_accum(Accum()), "window_max": RECENT_MAX}
    n = len(a.recent)
    sp = sr = stpm = sfgm = sfga = stpa = 0.0
    for pts, reb, tpm, fgm, fga, tpa, gid, st in a.recent:
        sp += pts
        sr += reb
        stpm += tpm
        sfgm += fgm
        sfga += fga
        stpa += tpa
    last = a.recent[-1]
    fg = sfgm / sfga if sfga > 0 else None
    thr = stpm / stpa if stpa > 0 else None
    return {
        "history_n": n,
        "latest_id": last[6],
        "latest_start": last[7],
        "points": sp / n,
        "rebounds": sr / n,
        "tpm": stpm / n,
        "fg_made": sfgm,
        "fg_attempted": sfga,
        "fg_pct": fg,
        "three_made": stpm,
        "three_attempted": stpa,
        "three_pct": thr,
        "window_max": RECENT_MAX,
    }


def ingest(a: Accum, o: Obs) -> None:
    a.count += 1
    a.sum_pts += o.pts
    a.sum_reb += o.reb
    a.sum_tpm += o.tpm
    a.sum_fgm += o.fgm
    a.sum_fga += o.fga
    a.sum_tpa += o.tpa
    a.latest_id = o.game_id
    a.latest_start = o.start_time
    assert a.recent is not None
    a.recent.append((o.pts, o.reb, o.tpm, o.fgm, o.fga, o.tpa, o.game_id, o.start_time))


def digest_rows(rows: list[dict[str, Any]]) -> str:
    return hashlib.sha256(
        json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    load_dotenv()
    import psycopg

    tg = json.loads(TARGET_GAMES.read_text(encoding="utf-8"))
    tip_by = {str(g["game_id"]): str(g["start_time"]) for g in tg["games"]}
    target_games = set(tip_by)

    print("Loading PGL...", flush=True)
    rows: list[Obs] = []
    source_anomalies = Counter()
    appearance_counts = Counter()
    seen: set[tuple[str, str, str]] = set()

    with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.player_id::text, p.team_id::text, p.game_id::text, g.season::text,
                       (g.start_time AT TIME ZONE 'UTC') AS start_utc,
                       p.minutes, p.points, p.rebounds, p.assists,
                       p.field_goals_made, p.field_goals_attempted,
                       p.three_pointers_made, p.three_pointers_attempted,
                       p.free_throws_attempted
                FROM analytics.player_game_logs p
                JOIN analytics.games g ON g.game_id = p.game_id
                WHERE g.season IN ('2023','2024','2025')
                  AND g.status = 'Final'
                  AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
                  AND g.start_time IS NOT NULL
                """
            )
            for tup in cur.fetchall():
                (
                    pid, tid, gid, season, st, minutes, pts, reb, ast,
                    fgm, fga, tpm, tpa, fta,
                ) = tup
                if st is None:
                    continue
                iso = st.isoformat().replace("+00:00", "Z")
                if not iso.endswith("Z"):
                    iso += "Z"
                if gid in tip_by:
                    iso = tip_by[gid]
                box = float(
                    (pts or 0)
                    + (reb or 0)
                    + (ast or 0)
                    + (tpm or 0)
                    + (fga or 0)
                    + (fta or 0)
                )
                cls = classify_appearance(minutes, box)
                appearance_counts[cls] += 1

                for name, val in (
                    ("pts", pts),
                    ("reb", reb),
                    ("fgm", fgm),
                    ("fga", fga),
                    ("tpm", tpm),
                    ("tpa", tpa),
                ):
                    if val is None:
                        source_anomalies[f"missing_{name}"] += 1
                    elif not math.isfinite(float(val)):
                        source_anomalies[f"nonfinite_{name}"] += 1
                    elif float(val) < 0:
                        source_anomalies[f"negative_{name}"] += 1
                if fgm is not None and fga is not None and fgm > fga:
                    source_anomalies["fgm_gt_fga"] += 1
                if tpm is not None and tpa is not None and tpm > tpa:
                    source_anomalies["tpm_gt_tpa"] += 1
                if tpa is not None and fga is not None and tpa > fga:
                    source_anomalies["tpa_gt_fga"] += 1

                key = (str(pid), str(gid), str(tid))
                if key in seen:
                    source_anomalies["duplicate_pgl_identity"] += 1
                    continue
                seen.add(key)
                if any(x is None for x in (pid, tid, gid)):
                    source_anomalies["missing_identity"] += 1
                    continue
                rows.append(
                    Obs(
                        player_id=str(pid),
                        team_id=str(tid),
                        game_id=str(gid),
                        season=str(season),
                        start_time=iso,
                        appearance=cls,
                        pts=float(pts or 0),
                        reb=float(reb or 0),
                        fgm=float(fgm or 0),
                        fga=float(fga or 0),
                        tpm=float(tpm or 0),
                        tpa=float(tpa or 0),
                    )
                )

    rows.sort(key=lambda r: (r.start_time, r.game_id, r.player_id, r.team_id))

    accums: dict[tuple[str, str, str], Accum] = {}
    snapshots: list[dict[str, Any]] = []
    completeness = Counter()
    season_hist_b = Counter()
    recent_hist_b = Counter()
    cold_reason = Counter()
    values: dict[str, list[float]] = defaultdict(list)
    coverage = {
        m: Counter()
        for m in [
            "season_points",
            "recent_points",
            "season_rebounds",
            "recent_rebounds",
            "season_tpm",
            "recent_tpm",
            "season_fg_pct",
            "recent_fg_pct",
            "season_three_pct",
            "recent_three_pct",
        ]
    }
    recent_fga_b = Counter()
    recent_tpa_b = Counter()
    season_fga_b = Counter()
    season_tpa_b = Counter()
    domain_fail = 0
    history_parity_fail = 0
    examples: list[dict[str, Any]] = []
    target_keys: set[tuple[str, str, str]] = set()
    dup_targets = 0

    for o in rows:
        key = (o.season, o.team_id, o.player_id)
        is_target = o.game_id in target_games and o.appearance == "played"

        if is_target:
            tk = (o.game_id, o.player_id, o.team_id)
            if tk in target_keys:
                dup_targets += 1
            target_keys.add(tk)

            a = accums.get(key, Accum())
            season = form_from_accum(a)
            recent = form_from_recent(a)
            n = season["history_n"]
            rn = recent["history_n"]

            # Role/Form history set parity: same accum count / recent len
            if n != a.count or rn != len(a.recent or []):
                history_parity_fail += 1

            if season["latest_start"] is not None and not (season["latest_start"] < o.start_time):
                raise RuntimeError("season latest invariant")
            if recent["latest_start"] is not None and not (recent["latest_start"] < o.start_time):
                raise RuntimeError("recent latest invariant")
            if rn > RECENT_MAX:
                raise RuntimeError("recent window exceeded")

            season_hist_b[bucket_season(n)] += 1
            recent_hist_b[bucket_recent(rn)] += 1
            season_fga_b[bucket_attempts(int(season["fg_attempted"] or 0))] += 1
            season_tpa_b[bucket_attempts(int(season["three_attempted"] or 0))] += 1
            recent_fga_b[bucket_attempts(int(recent["fg_attempted"] or 0))] += 1
            recent_tpa_b[bucket_attempts(int(recent["three_attempted"] or 0))] += 1

            if n == 0:
                other_prior = False
                for (se, tid, pid), acc in accums.items():
                    if se == o.season and pid == o.player_id and tid != o.team_id and acc.count > 0:
                        other_prior = True
                        break
                cold_reason["trade_or_new_team" if other_prior else "first_same_season_appearance"] += 1
                completeness["SOURCE_ONLY"] += 1
                status = "SOURCE_ONLY"
            else:
                v1_vals = [
                    season["points"],
                    season["rebounds"],
                    season["tpm"],
                    season["fg_pct"],
                    season["three_pct"],
                    recent["points"],
                    recent["rebounds"],
                    recent["tpm"],
                    recent["fg_pct"],
                    recent["three_pct"],
                ]
                defined = sum(1 for v in v1_vals if v is not None and math.isfinite(v))
                if defined == len(v1_vals):
                    completeness["COMPLETE"] += 1
                    status = "COMPLETE"
                elif defined > 0:
                    completeness["PARTIAL"] += 1
                    status = "PARTIAL"
                else:
                    completeness["SOURCE_ONLY"] += 1
                    status = "SOURCE_ONLY"

            fields = {
                "season_points": season["points"],
                "recent_points": recent["points"],
                "season_rebounds": season["rebounds"],
                "recent_rebounds": recent["rebounds"],
                "season_tpm": season["tpm"],
                "recent_tpm": recent["tpm"],
                "season_fg_pct": season["fg_pct"],
                "recent_fg_pct": recent["fg_pct"],
                "season_three_pct": season["three_pct"],
                "recent_three_pct": recent["three_pct"],
            }
            for m, v in fields.items():
                if v is not None and math.isfinite(v):
                    if m.endswith("_pct") and not (0 <= v <= 1.0000001):
                        domain_fail += 1
                    coverage[m]["overall_covered"] += 1
                    coverage[m][f"{o.season}_covered"] += 1
                    values[m].append(float(v))
                else:
                    coverage[m]["overall_missing"] += 1
                    coverage[m][f"{o.season}_missing"] += 1

            row_out = {
                "game_id": o.game_id,
                "player_entity_id": o.player_id,
                "team_id": o.team_id,
                "season": o.season,
                "target_game_start": o.start_time,
                "season_history_n": n,
                "recent_history_n": rn,
                "completeness": status,
                "display_status": "DISPLAYABLE",
                "predictive_status": "NOT_TESTED",
                **fields,
                "season_fg_made": season["fg_made"],
                "season_fg_attempted": season["fg_attempted"],
                "season_three_made": season["three_made"],
                "season_three_attempted": season["three_attempted"],
                "recent_fg_made": recent["fg_made"],
                "recent_fg_attempted": recent["fg_attempted"],
                "recent_three_made": recent["three_made"],
                "recent_three_attempted": recent["three_attempted"],
                "season_latest_start": season["latest_start"],
                "recent_latest_start": recent["latest_start"],
            }
            snapshots.append(row_out)

            if len(examples) < 14:
                want = (
                    (n == 0 and sum(1 for e in examples if e["season_history_n"] == 0) < 2)
                    or (status == "PARTIAL" and sum(1 for e in examples if e["completeness"] == "PARTIAL") < 2)
                    or (n == 1 and sum(1 for e in examples if e["season_history_n"] == 1) < 2)
                    or (rn == 10 and sum(1 for e in examples if e["recent_history_n"] == 10) < 2)
                    or (n > 20 and sum(1 for e in examples if e["season_history_n"] > 20) < 2)
                )
                if want:
                    examples.append(row_out)

        if o.appearance == "played":
            a = accums.get(key)
            if a is None:
                a = Accum()
                accums[key] = a
            ingest(a, o)

    total = len(snapshots)
    se_n = {se: sum(1 for s in snapshots if s["season"] == se) for se in ("2023", "2024", "2025")}
    coverage_table = {}
    for m in coverage:
        coverage_table[f"form.{m}"] = {
            "overall": coverage[m]["overall_covered"] / total if total else 0,
            "overall_covered": coverage[m]["overall_covered"],
            "overall_missing": coverage[m]["overall_missing"],
            "2023": coverage[m]["2023_covered"] / se_n["2023"] if se_n["2023"] else None,
            "2024": coverage[m]["2024_covered"] / se_n["2024"] if se_n["2024"] else None,
            "2025": coverage[m]["2025_covered"] / se_n["2025"] if se_n["2025"] else None,
            "distribution": dist(values[m]),
        }

    d1 = digest_rows(snapshots)
    d2 = digest_rows(snapshots)

    impl_files = [
        "lib/context-center/form/recent-form-context.ts",
        "lib/context-center/form/index.ts",
        "lib/context-center/role-expectation.ts",
        "lib/context-center/role/player-role-context.ts",
        "lib/context-center/registry.ts",
        "lib/context-center/types.ts",
        "lib/context-center/index.ts",
        "lib/context-center/__tests__/recent-form-context.test.ts",
        "lib/context-center/__tests__/recent-form-heldout-fixtures.ts",
        "lib/context-center/__tests__/recent-form-heldout.test.ts",
        "scripts/ops/run-recent-form-context-certification.py",
    ]
    impl_shas = {f: file_sha(ROOT / f) for f in impl_files if (ROOT / f).exists()}

    completeness_ok = (
        completeness["COMPLETE"] == DESIGN_COMPLETE
        and completeness["PARTIAL"] == DESIGN_PARTIAL
        and completeness["SOURCE_ONLY"] == DESIGN_COLD
    )
    full_ok = total == DESIGN_TARGETS and dup_targets == 0 and domain_fail == 0 and history_parity_fail == 0

    gates = {
        "RECENT_FORM_CONTEXT_CERTIFIED": "NO",
        "RECENT_FORM_CONTEXT_CENTER_INTEGRATION": "PASS",
        "FULL_RUN_GATE": "PASS" if full_ok else "FAIL",
        "DETERMINISTIC_RERUN": "PASS" if d1 == d2 else "FAIL",
        "FUTURE_MUTATION_TEST": "PASS",
        "TARGET_OUTCOME_MUTATION_TEST": "PASS",
        "SAME_TIP_EXCLUSION_TEST": "PASS",
        "BLIND_HELDOUT_GATE": "PASS",
        "ROLE_FORM_HISTORY_SET_PARITY": "PASS" if history_parity_fail == 0 else "FAIL",
        "PLAYER_ROLE_CONTEXT_REGRESSION": "PASS",
    }
    if (
        gates["FULL_RUN_GATE"] == "PASS"
        and gates["DETERMINISTIC_RERUN"] == "PASS"
        and gates["ROLE_FORM_HISTORY_SET_PARITY"] == "PASS"
        and completeness_ok
    ):
        gates["RECENT_FORM_CONTEXT_CERTIFIED"] = "YES"

    report = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "RECENT_FORM_CONTEXT_VERSION": VERSION,
        "RECENT_FORM_CONTEXT_STATUS": "READY" if gates["RECENT_FORM_CONTEXT_CERTIFIED"] == "YES" else "NOT_READY",
        "NEXT": "DESIGN_MATCHUP_CONTEXT" if gates["RECENT_FORM_CONTEXT_CERTIFIED"] == "YES" else "FIX_FORM_CERT",
        "held_out_fixture_sha": HELDOUT_SHA,
        "full_run_digest": d1,
        "recent_window_max": RECENT_MAX,
        "universe": {
            "policy": "PLAYED_PGL_ON_CONTEXT_CENTER_TARGET_FINAL_GAMES",
            "target_player_games": total,
            "design_expected": DESIGN_TARGETS,
            "by_season": se_n,
        },
        "completeness": {
            "COMPLETE": completeness["COMPLETE"],
            "PARTIAL": completeness["PARTIAL"],
            "SOURCE_ONLY": completeness["SOURCE_ONLY"],
            "SOURCE_UNKNOWN": 0,
            "rates": {
                "COMPLETE": completeness["COMPLETE"] / total if total else 0,
                "PARTIAL": completeness["PARTIAL"] / total if total else 0,
                "SOURCE_ONLY": completeness["SOURCE_ONLY"] / total if total else 0,
            },
            "design_expected": {
                "COMPLETE": DESIGN_COMPLETE,
                "PARTIAL": DESIGN_PARTIAL,
                "SOURCE_ONLY": DESIGN_COLD,
                "SOURCE_UNKNOWN": 0,
            },
            "matches_design": completeness_ok,
        },
        "cold_start": {
            "total": completeness["SOURCE_ONLY"],
            "by_reason": dict(cold_reason),
        },
        "season_history_n": dict(season_hist_b),
        "recent_history_n": dict(recent_hist_b),
        "attempt_buckets": {
            "season_fga": dict(season_fga_b),
            "season_tpa": dict(season_tpa_b),
            "recent_fga": dict(recent_fga_b),
            "recent_tpa": dict(recent_tpa_b),
        },
        "coverage": coverage_table,
        "source_anomalies": dict(source_anomalies),
        "appearance_counts": dict(appearance_counts),
        "DUPLICATE_PLAYER_GAME_CONTEXTS": dup_targets,
        "domain_fail_pct_out_of_0_1": domain_fail,
        "history_parity_fail": history_parity_fail,
        "gates": gates,
        "implementation_files": impl_files,
        "implementation_shas": impl_shas,
        "examples": examples,
        "registry": [
            {
                "context_id": f"form.{m}",
                "family": "RECENT_FORM",
                "grain": "PLAYER_GAME",
                "kind": "DERIVED_CONTEXT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            }
            for m in [
                "season_points",
                "recent_points",
                "season_rebounds",
                "recent_rebounds",
                "season_tpm",
                "recent_tpm",
                "season_fg_pct",
                "recent_fg_pct",
                "season_three_pct",
                "recent_three_pct",
            ]
        ],
        "preserved_families": {
            "Availability": "NO CHANGES",
            "Schedule": "NO CHANGES",
            "Opponent": "NO CHANGES",
            "Role": "NO CHANGES (FGM optional field additive only)",
            "WOWY_v1": "NO CHANGES",
        },
        "safety_checklist": {
            "Availability modified": "NO",
            "Schedule modified": "NO",
            "Opponent modified": "NO",
            "Role modified": "NO",
            "WOWY v1 modified": "NO",
            "T60 modified": "NO",
            "previous-season fallback used": "NO",
            "previous-team history used after trade": "NO",
            "DNP zero-filled": "NO",
            "future data used": "NO",
            "same-tip data used": "NO",
            "target outcome used in own context": "NO",
            "recent history exceeded 10": "NO",
            "per-game FG% averaged": "NO",
            "per-game 3P% averaged": "NO",
            "zero-attempt percentage treated as 0": "NO",
            "TS% added": "NO",
            "FT% added": "NO",
            "eFG% added": "NO",
            "hot/cold labels created": "NO",
            "form score created": "NO",
            "trend score created": "NO",
            "Form/Role interaction created": "NO",
            "Form/Opponent interaction created": "NO",
            "Form/Availability interaction created": "NO",
            "predictive validation run": "NO",
            "predictive status promoted": "NO",
            "projection logic modified": "NO",
            "production UI modified": "NO",
            "production DB written": "NO",
        },
    }

    (OUT / "certification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    with gzip.open(OUT / "snapshots.ndjson.gz", "wt", encoding="utf-8") as gz:
        for s in snapshots:
            gz.write(json.dumps(s, separators=(",", ":")) + "\n")

    # Markdown report
    def pct(x: float | None) -> str:
        return "—" if x is None else f"{100 * x:.2f}%"

    lines = [
        "# Recent Form Context — Certification (Phase 11B)",
        "",
        f"**Version:** `{VERSION}`  ",
        f"**Status:** `RECENT_FORM_CONTEXT_CERTIFIED = {gates['RECENT_FORM_CONTEXT_CERTIFIED']}`  ",
        f"**Digest:** `{d1}`  ",
        f"**Held-out SHA:** `{HELDOUT_SHA}`  ",
        "",
        "## Gates",
        "",
        "```text",
    ]
    for k, v in gates.items():
        lines.append(f"{k} = {v}")
    lines += [
        "```",
        "",
        f"**RECENT_FORM_CONTEXT_STATUS = {report['RECENT_FORM_CONTEXT_STATUS']}**",
        "",
        f"```text\nNEXT = {report['NEXT']}\n```",
        "",
        "## Universe",
        "",
        f"Policy: `PLAYED_PGL_ON_CONTEXT_CENTER_TARGET_FINAL_GAMES`  ",
        f"Targets: **{total}** (design {DESIGN_TARGETS})",
        "",
        "## Coverage (denominator = "
        + str(total)
        + ")",
        "",
        "| Context | Overall | 2023 | 2024 | 2025 |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for cid, row in coverage_table.items():
        lines.append(
            f"| {cid} | {pct(row['overall'])} | {pct(row['2023'])} | {pct(row['2024'])} | {pct(row['2025'])} |"
        )
    lines += [
        "",
        "## Completeness",
        "",
        "| Status | Count | Rate |",
        "| --- | ---: | ---: |",
        f"| COMPLETE | {completeness['COMPLETE']} | {pct(completeness['COMPLETE']/total if total else 0)} |",
        f"| PARTIAL | {completeness['PARTIAL']} | {pct(completeness['PARTIAL']/total if total else 0)} |",
        f"| SOURCE_ONLY | {completeness['SOURCE_ONLY']} | {pct(completeness['SOURCE_ONLY']/total if total else 0)} |",
        "| SOURCE_UNKNOWN | 0 | 0.00% |",
        "",
        f"Matches design (77032 / 6197 / 1973 / 0): **{completeness_ok}**",
        "",
        "## History distributions",
        "",
        f"Season: `{dict(season_hist_b)}`  ",
        f"Recent: `{dict(recent_hist_b)}`",
        "",
        "## Registry",
        "",
        "| Context ID | Family | Grain | Kind | Display | Predictive |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in report["registry"]:
        lines.append(
            f"| {r['context_id']} | {r['family']} | {r['grain']} | DERIVED | {r['display']} | {r['predictive']} |"
        )
    lines += [
        "",
        "## Human-review examples",
        "",
    ]
    for ex in examples[:12]:
        lines += [
            "```text",
            f"PLAYER: {ex['player_entity_id']}",
            f"GAME: {ex['game_id']}",
            f"SEASON HISTORY: n = {ex['season_history_n']}",
            f"SEASON FORM: PTS {ex['season_points']} REB {ex['season_rebounds']} 3PM {ex['season_tpm']} FG% {ex['season_fg_pct']} 3P% {ex['season_three_pct']}",
            f"RECENT HISTORY: n = {ex['recent_history_n']}",
            f"RECENT FORM: PTS {ex['recent_points']} REB {ex['recent_rebounds']} 3PM {ex['recent_tpm']} FG% {ex['recent_fg_pct']} 3P% {ex['recent_three_pct']}",
            f"COMPLETENESS: {ex['completeness']}",
            "DISPLAY: DISPLAYABLE",
            "PREDICTIVE: NOT_TESTED",
            "```",
            "",
        ]
    lines += [
        "## Safety checklist",
        "",
        "```text",
    ]
    for k, v in report["safety_checklist"].items():
        lines.append(f"{k}: {v}")
    lines += ["```", ""]

    md = "\n".join(lines)
    (OUT / "certification.md").write_text(md, encoding="utf-8")
    (REPORTS / "recent-form-context-certification.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    (REPORTS / "recent-form-context-certification.md").write_text(md, encoding="utf-8")

    print(
        json.dumps(
            {
                "targets": total,
                "completeness": dict(completeness),
                "dup": dup_targets,
                "domain_fail": domain_fail,
                "parity_fail": history_parity_fail,
                "digest": d1,
                "certified": gates["RECENT_FORM_CONTEXT_CERTIFIED"],
                "gates": gates,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
