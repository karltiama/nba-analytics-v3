"""Phase 6C feasibility diagnostics (no player effects)."""
from __future__ import annotations

import gzip
import json
import os
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_dotenv() -> None:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main() -> None:
    load_dotenv()
    import psycopg

    p1 = []
    with gzip.open(ROOT / "tmp/official-injury-wowy-pairs/p1.ndjson.gz", "rt", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                p1.append(json.loads(line))

    game_ids = sorted({o["game_id"] for o in p1})
    out: dict = {"p1_obs": len(p1), "unique_games": len(game_ids)}

    url = os.environ["SUPABASE_DB_URL"]
    with psycopg.connect(url) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) FILTER (WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL),
                       COUNT(*)
                FROM analytics.games WHERE game_id = ANY(%s)
                """,
                (game_ids,),
            )
            has_ha, n = cur.fetchone()
            out["games_home_away_complete"] = {"complete": has_ha, "n": n, "rate": has_ha / n}

            cur.execute(
                """
                SELECT COUNT(*) FILTER (WHERE opponent_team_id IS NOT NULL),
                       COUNT(*) FILTER (WHERE is_home IS NOT NULL),
                       COUNT(*) FILTER (WHERE game_date IS NOT NULL),
                       COUNT(*)
                FROM analytics.player_game_logs
                WHERE game_id = ANY(%s)
                """,
                (game_ids,),
            )
            opp, is_home, gdate, n2 = cur.fetchone()
            out["pgl_covariates"] = {
                "opponent_rate": opp / n2,
                "is_home_rate": is_home / n2,
                "game_date_rate": gdate / n2,
                "n": n2,
            }

            # Rest/B2B computable from team game dates historically
            cur.execute(
                """
                SELECT COUNT(*) FROM (
                  SELECT team_id, season, game_date
                  FROM analytics.team_game_stats
                  WHERE season IN ('2023','2024','2025') AND game_date IS NOT NULL
                  GROUP BY 1,2,3
                ) t
                """
            )
            out["team_game_dates_available"] = cur.fetchone()[0]
        conn.execute("COMMIT")

    pair_counts: dict = defaultdict(lambda: {"W": 0, "WO": 0})
    for o in p1:
        k = (o["season"], o["team_id"], o["subject_player_entity_id"], o["focal_player_entity_id"])
        if o["focal_state"] == "PRE_GAME_AVAILABLE":
            pair_counts[k]["W"] += 1
        else:
            pair_counts[k]["WO"] += 1
    both = {k: v for k, v in pair_counts.items() if v["W"] > 0 and v["WO"] > 0}

    sst_games: dict = defaultdict(set)
    for o in p1:
        sst_games[(o["season"], o["team_id"], o["subject_player_entity_id"])].add(o["game_id"])

    extras = []
    for (season, team, subj, _focal), v in both.items():
        pair_games = v["W"] + v["WO"]
        total = len(sst_games[(season, team, subj)])
        extras.append(total - pair_games)

    extras_s = sorted(extras)
    out["same_st_extra_games_among_both"] = {
        "pairs": len(extras),
        "with_any_extra": sum(1 for e in extras if e > 0),
        "median_extra": extras_s[len(extras_s) // 2] if extras_s else None,
        "p90_extra": extras_s[int(0.9 * (len(extras_s) - 1))] if extras_s else None,
        "note": "Extra unique subject games in P1 corpus for same season+team beyond this pair's W+WO counts (proxy; not full season PGL).",
    }

    # quality tier coverage
    n_keys = len(pair_counts)
    n_both = len(both)
    out["coverage"] = {
        "all_keys": n_keys,
        "both": n_both,
        "ge_1_1": sum(1 for v in both.values() if v["W"] >= 1 and v["WO"] >= 1),
        "ge_2_2": sum(1 for v in both.values() if v["W"] >= 2 and v["WO"] >= 2),
        "ge_3_3": sum(1 for v in both.values() if v["W"] >= 3 and v["WO"] >= 3),
        "ge_5_5": sum(1 for v in both.values() if v["W"] >= 5 and v["WO"] >= 5),
        "exactly_1_1": sum(1 for v in both.values() if v["W"] == 1 and v["WO"] == 1),
        "pct_keys_ge_1_1": round(100 * n_both / n_keys, 2),
        "pct_keys_ge_2_2": round(100 * sum(1 for v in both.values() if v["W"] >= 2 and v["WO"] >= 2) / n_keys, 2),
        "pct_keys_ge_3_3": round(100 * sum(1 for v in both.values() if v["W"] >= 3 and v["WO"] >= 3) / n_keys, 2),
        "pct_keys_ge_5_5": round(100 * sum(1 for v in both.values() if v["W"] >= 5 and v["WO"] >= 5) / n_keys, 2),
    }

    out_path = ROOT / "tmp" / "official-injury-wowy-estimator-design"
    out_path.mkdir(parents=True, exist_ok=True)
    (out_path / "feasibility.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
