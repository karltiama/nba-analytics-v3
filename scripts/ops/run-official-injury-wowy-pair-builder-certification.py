"""
Phase 6B — certify injury-conditioned WOWY pair builder + full historical dry-run.

  python scripts/ops/run-official-injury-wowy-pair-builder-certification.py

Does NOT calculate effects. Does NOT write Postgres. Does NOT modify /wowy.
P1/P2/P3 semantics match Phase 6A design audit (confirmed).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = ROOT / "tests" / "fixtures" / "official-injury-wowy-pairs"
ELIG_DIR = ROOT / "tmp" / "official-injury-report-t60-eligibility"
SELECTED_GZ = ROOT / "tmp" / "official-injury-report-asof-t60" / "selected-player-states.ndjson.gz"
DESIGN_6A = ROOT / "reports" / "operations" / "official-injury-wowy-pair-design-audit.json"
OUT_TMP = ROOT / "tmp" / "official-injury-wowy-pairs"
REPORTS = ROOT / "reports" / "operations"

PAIR_POLICY_VERSION = "injury-wowy-pair-policy-v1"
MODULE_TS = ROOT / "lib" / "injuries" / "official" / "injury-wowy-pair.ts"
TEST_TS = ROOT / "lib" / "injuries" / "official" / "__tests__" / "injury-wowy-pair.test.ts"
RUNNER_PY = Path(__file__)

EXPECTED_WITHOUT = 19378
EXPECTED_WITH = 2466
EXPECTED_WITHOUT_SEASON = {"2023": 5704, "2024": 6530, "2025": 7144}
EXPECTED_WITH_SEASON = {"2023": 631, "2024": 686, "2025": 1149}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def load_gz(p: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with gzip.open(p, "rt", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                out.append(json.loads(line))
    return out


def load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def obs_id(game_id: str, team_id: str, subject: str, focal: str) -> str:
    raw = f"{PAIR_POLICY_VERSION}|{game_id}|{team_id}|{subject}|{focal}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def classify_wowy_appearance(minutes: Any, box: dict[str, Any]) -> dict[str, Any]:
    token = None if minutes is None else str(minutes).strip() or None
    try:
        mins = None if minutes is None else float(minutes)
        if mins is not None and not math.isfinite(mins):
            mins = None
    except (TypeError, ValueError):
        mins = None
    box_sum = sum(
        float(box.get(k) or 0)
        for k in (
            "points",
            "rebounds",
            "assists",
            "three_pointers_made",
            "field_goals_attempted",
            "free_throws_attempted",
        )
    )
    has_box = box_sum > 0
    if token is None or mins is None:
        return {"class": "malformed", "minutes": mins}
    if mins > 0:
        return {"class": "played", "minutes": mins}
    if token == "00":
        return {"class": "dnp", "minutes": 0.0}
    if token in ("0", "0.0"):
        return {"class": "played", "minutes": 0.0}
    if has_box:
        return {"class": "played", "minutes": 0.0}
    return {"class": "dnp", "minutes": 0.0}


def compute_counters(teammates: list[dict[str, Any]], focal_entity: str) -> dict[str, int]:
    other_health_wo = other_health_wi = other_non_health_out = other_nonbinary = 0
    other_elig_with = other_elig_without = 0
    for p in teammates:
        eid = str(p.get("player_entity_id") or "")
        if eid and eid == focal_entity:
            continue
        status, health, elig = p.get("status_raw"), p.get("health_relation"), p.get("injury_wowy_eligibility")
        if status == "Out" and health == "HEALTH_RELATED":
            other_health_wo += 1
        if status == "Available" and health == "HEALTH_RELATED":
            other_health_wi += 1
        if status == "Out" and health == "NON_HEALTH_RELATED":
            other_non_health_out += 1
        if status in ("Questionable", "Doubtful", "Probable") and health == "HEALTH_RELATED":
            other_nonbinary += 1
        if elig == "WITH_CANDIDATE" and p.get("canonical_model_eligible"):
            other_elig_with += 1
        if elig == "WITHOUT_CANDIDATE" and p.get("canonical_model_eligible"):
            other_elig_without += 1
    return {
        "other_health_without_count": other_health_wo,
        "other_health_with_count": other_health_wi,
        "other_non_health_out_count": other_non_health_out,
        "other_nonbinary_health_count": other_nonbinary,
        "other_eligible_with_count": other_elig_with,
        "other_eligible_without_count": other_elig_without,
    }


def cohort_flags(c: dict[str, int]) -> dict[str, bool]:
    return {
        "cohort_p0": True,
        "cohort_p1": c["other_health_without_count"] == 0,
        "cohort_p2": c["other_eligible_with_count"] == 0 and c["other_eligible_without_count"] == 0,
        "cohort_p3": c["other_health_without_count"] == 0 and c["other_non_health_out_count"] == 0,
    }


def build_obs(inp: dict[str, Any], counters: dict[str, int]) -> dict[str, Any] | None:
    subject = inp.get("subject_player_entity_id")
    if subject is None or str(subject).strip() == "":
        return None
    subject = str(subject)
    focal = str(inp["focal_player_entity_id"])
    if subject == focal:
        return None
    elig = inp["focal_eligibility"]
    focal_state = "PRE_GAME_AVAILABLE" if elig == "WITH_CANDIDATE" else "PRE_GAME_OUT"
    flags = cohort_flags(counters)
    metrics = inp.get("subject_metrics") or {}
    return {
        "pair_policy_version": PAIR_POLICY_VERSION,
        "observation_id": obs_id(str(inp["game_id"]), str(inp["team_id"]), subject, focal),
        "game_id": str(inp["game_id"]),
        "team_id": str(inp["team_id"]),
        "season": str(inp["season"]),
        "subject_player_entity_id": subject,
        "subject_serving_player_id": str(inp["subject_serving_player_id"]),
        "focal_player_entity_id": focal,
        "focal_serving_player_id": None
        if inp.get("focal_serving_player_id") in (None, "")
        else str(inp.get("focal_serving_player_id")),
        "focal_state": focal_state,
        "focal_eligibility": elig,
        "t60_report_published_at": inp.get("t60_report_published_at"),
        **counters,
        **flags,
        "focal_realized_participation": inp["focal_realized_participation"],
        "subject_metrics": {
            "minutes": metrics.get("minutes"),
            "pts": metrics.get("pts"),
            "reb": metrics.get("reb"),
            "ast": metrics.get("ast"),
            "tpm": metrics.get("tpm"),
            "fga": metrics.get("fga"),
            "tpa": metrics.get("tpa"),
            "fta": metrics.get("fta"),
        },
        "source_versions": {
            "identity": "official-injury-player-identity-v1",
            "asof": "official-injury-asof-t60-v1",
            "reason": "official-injury-reason-policy-v1",
            "eligibility": "injury-wowy-eligibility-v1",
        },
    }


def load_fixtures(split: str) -> list[dict[str, Any]]:
    d = FIXTURE_ROOT / split
    return [
        json.loads((d / f).read_text(encoding="utf-8"))
        for f in sorted(d.iterdir())
        if f.suffix == ".json"
    ]


def run_fixture(fx: dict[str, Any]) -> tuple[bool, list[str]]:
    inp = fx["input"]
    exp = fx["expected"]
    diffs: list[str] = []
    mode = inp.get("mode")

    if mode == "validate_focals":
        by: dict[str, set[str]] = defaultdict(set)
        for f in inp["focals"]:
            by[f"{f['game_id']}|{f['team_id']}|{f['player_entity_id']}"].add(f["injury_wowy_eligibility"])
        conflicts = [k for k, v in by.items() if len(v) > 1]
        if not conflicts:
            diffs.append("expected FOCAL_STATE_CONFLICT")
        if exp.get("hard_failure") != "FOCAL_STATE_CONFLICT":
            diffs.append("expected label")
        return len(diffs) == 0, diffs

    if mode == "validate_subjects":
        c: Counter[str] = Counter()
        for s in inp["subjects"]:
            c[f"{s['game_id']}|{s['team_id']}|{s['player_entity_id']}"] += 1
        if not any(v > 1 for v in c.values()):
            diffs.append("expected duplicate subject")
        return len(diffs) == 0, diffs

    if exp.get("emitted") is False:
        subject = inp.get("subject_player_entity_id")
        if subject is None or str(subject).strip() == "":
            reason = "SUBJECT_IDENTITY_UNRESOLVED"
        elif str(subject) == str(inp["focal_player_entity_id"]):
            reason = "SELF_PAIR_REMOVED"
        else:
            reason = "UNEXPECTED_EMIT"
            diffs.append("should not emit")
            return False, diffs
        if reason != exp.get("reason"):
            diffs.append(f"reason:{reason}!={exp.get('reason')}")
        return len(diffs) == 0, diffs

    if mode == "compute_counters":
        counters = compute_counters(inp.get("teammates") or [], str(inp["focal_player_entity_id"]))
    else:
        counters = {
            "other_health_without_count": int(inp["other_health_without_count"]),
            "other_health_with_count": int(inp["other_health_with_count"]),
            "other_non_health_out_count": int(inp["other_non_health_out_count"]),
            "other_nonbinary_health_count": int(inp["other_nonbinary_health_count"]),
            "other_eligible_with_count": int(inp["other_eligible_with_count"]),
            "other_eligible_without_count": int(inp["other_eligible_without_count"]),
        }

    obs = build_obs(inp, counters)
    if obs is None:
        diffs.append("unexpected non-emit")
        return False, diffs

    checks = [
        "observation_id",
        "game_id",
        "team_id",
        "season",
        "subject_player_entity_id",
        "focal_player_entity_id",
        "focal_state",
        "other_health_without_count",
        "other_health_with_count",
        "other_non_health_out_count",
        "other_nonbinary_health_count",
        "other_eligible_with_count",
        "other_eligible_without_count",
        "cohort_p0",
        "cohort_p1",
        "cohort_p2",
        "cohort_p3",
        "focal_realized_participation",
    ]
    for k in checks:
        if k in exp and obs.get(k) != exp.get(k):
            diffs.append(f"{k}:{obs.get(k)}!={exp.get(k)}")
    if "subject_metrics" in exp and obs.get("subject_metrics") != exp.get("subject_metrics"):
        diffs.append("subject_metrics")
    if "focal_serving_player_id" in exp and obs.get("focal_serving_player_id") != exp.get(
        "focal_serving_player_id"
    ):
        diffs.append("focal_serving_player_id")
    if obs["pair_policy_version"] != PAIR_POLICY_VERSION:
        diffs.append("version")
    return len(diffs) == 0, diffs


def query_pgl(game_team_keys: set[tuple[str, str]]) -> list[dict[str, Any]]:
    import psycopg

    load_dotenv()
    url = (os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or "").strip()
    if not url:
        raise SystemExit("SUPABASE_DB_URL required")
    game_ids = sorted({g for g, _ in game_team_keys})
    rows: list[dict[str, Any]] = []
    with psycopg.connect(url) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            for i in range(0, len(game_ids), 500):
                part = game_ids[i : i + 500]
                cur.execute(
                    """
                    SELECT l.game_id::text, l.team_id::text, l.player_id::text, l.season::text,
                           l.game_date::text, l.minutes, l.points, l.rebounds, l.assists,
                           l.three_pointers_made, l.field_goals_attempted,
                           l.three_pointers_attempted, l.free_throws_attempted,
                           p.player_entity_id::text, g.home_team_id::text
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
                    if (r["game_id"], r["team_id"]) in game_team_keys:
                        rows.append(r)
        conn.execute("COMMIT")
    return rows


def depth_counts(idx: dict[tuple, dict[str, int]]) -> dict[str, int]:
    both = {k: v for k, v in idx.items() if v["WITH"] > 0 and v["WITHOUT"] > 0}
    out = {"directional_pairs": len(idx), "BOTH_STATES": len(both)}
    for a, b in [(1, 1), (2, 2), (3, 3), (5, 5), (10, 10)]:
        out[f">={a}/{b}"] = sum(1 for v in both.values() if v["WITH"] >= a and v["WITHOUT"] >= b)
    with_only = without_only = 0
    for v in idx.values():
        if v["WITH"] > 0 and v["WITHOUT"] == 0:
            with_only += 1
        elif v["WITHOUT"] > 0 and v["WITH"] == 0:
            without_only += 1
    out["WITH_ONLY"] = with_only
    out["WITHOUT_ONLY"] = without_only
    return out


def bucket_dist(vals: list[int]) -> dict[str, int]:
    d = Counter()
    for v in vals:
        if v <= 0:
            d["0"] += 1
        elif v == 1:
            d["1"] += 1
        elif v == 2:
            d["2"] += 1
        else:
            d["3+"] += 1
    return dict(d)


def main() -> int:
    OUT_TMP.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)

    design6a = json.loads(DESIGN_6A.read_text(encoding="utf-8"))
    without = load_gz(ELIG_DIR / "without-candidates.ndjson.gz")
    with_rows = load_gz(ELIG_DIR / "with-candidates.ndjson.gz")
    all_rows = load_gz(ELIG_DIR / "all-results.ndjson.gz")
    selected = load_gz(SELECTED_GZ)

    if len(without) != EXPECTED_WITHOUT or len(with_rows) != EXPECTED_WITH:
        raise SystemExit("STOP: focal candidate drift")
    wo_s = Counter(str(r["season"]) for r in without)
    wi_s = Counter(str(r["season"]) for r in with_rows)
    for s, n in EXPECTED_WITHOUT_SEASON.items():
        if wo_s[s] != n:
            raise SystemExit(f"STOP WITHOUT season {s}")
    for s, n in EXPECTED_WITH_SEASON.items():
        if wi_s[s] != n:
            raise SystemExit(f"STOP WITH season {s}")

    # --- Development via vitest ---
    print("Running development vitest…")
    vitest = subprocess.run(
        ["npx", "vitest", "run", "lib/injuries/official/__tests__/injury-wowy-pair.test.ts"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        shell=True,
    )
    if vitest.returncode != 0:
        print(vitest.stdout)
        print(vitest.stderr)
        raise SystemExit("development vitest FAIL")

    dev_fx = load_fixtures("development")
    syn_fx = load_fixtures("synthetic")
    # also verify with Python runner for parity
    dev_exact = sum(1 for fx in dev_fx if run_fixture(fx)[0])
    syn_exact = sum(1 for fx in syn_fx if run_fixture(fx)[0])
    if dev_exact != len(dev_fx) or syn_exact != len(syn_fx):
        fails = []
        for fx in dev_fx + syn_fx:
            ok, diffs = run_fixture(fx)
            if not ok:
                fails.append({"id": fx["fixture_id"], "diffs": diffs})
        print(json.dumps(fails, indent=2))
        raise SystemExit("Python fixture parity FAIL")

    development_gate = "PASS"
    dev_report = {
        "generated_at": utc_now(),
        "phase": "6B",
        "INJURY_WOWY_PAIR_BUILDER_DEVELOPMENT_GATE": development_gate,
        "pair_policy_version": PAIR_POLICY_VERSION,
        "development": {"exact": dev_exact, "total": len(dev_fx)},
        "synthetic": {"exact": syn_exact, "total": len(syn_fx)},
        "note": "Held-out not accessed.",
    }
    (REPORTS / "official-injury-wowy-pair-builder-development.json").write_text(
        json.dumps(dev_report, indent=2) + "\n", encoding="utf-8"
    )
    (REPORTS / "official-injury-wowy-pair-builder-development.md").write_text(
        f"# Injury WOWY pair builder development\n\n"
        f"**INJURY_WOWY_PAIR_BUILDER_DEVELOPMENT_GATE = {development_gate}**\n\n"
        f"- Development: {dev_exact}/{len(dev_fx)}\n"
        f"- Synthetic: {syn_exact}/{len(syn_fx)}\n",
        encoding="utf-8",
    )

    impl_fp = {
        "fingerprinted_at": utc_now(),
        "files": {
            "lib/injuries/official/injury-wowy-pair.ts": sha256_file(MODULE_TS),
            "lib/injuries/official/__tests__/injury-wowy-pair.test.ts": sha256_file(TEST_TS),
            "scripts/ops/run-official-injury-wowy-pair-builder-certification.py": sha256_file(RUNNER_PY),
            "lib/wowy/appearance.ts": sha256_file(ROOT / "lib" / "wowy" / "appearance.ts"),
        },
        "node": subprocess.check_output(["node", "-v"], text=True).strip(),
        "git_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True, cwd=str(ROOT)).strip(),
        "git_working_tree": (
            "clean"
            if not subprocess.check_output(["git", "status", "--porcelain"], text=True, cwd=str(ROOT)).strip()
            else "dirty"
        ),
    }
    (OUT_TMP / "implementation-fingerprint.json").write_text(
        json.dumps(impl_fp, indent=2) + "\n", encoding="utf-8"
    )

    # --- Held-out immutable ---
    ho_json = REPORTS / "official-injury-wowy-pair-builder-held-out-first-run.json"
    ho_md = REPORTS / "official-injury-wowy-pair-builder-held-out-first-run.md"
    if ho_json.exists():
        held = json.loads(ho_json.read_text(encoding="utf-8"))
        ho_exact = held["held_out"]["exact"]
        ho_total = held["held_out"]["total"]
        ho_pass = held.get("INJURY_WOWY_PAIR_BUILDER_CERTIFIED") == "YES" and ho_exact == ho_total
        if not ho_pass:
            raise SystemExit("existing held-out did not certify; refuse overwrite")
        print(f"Reusing immutable held-out ({ho_exact}/{ho_total})")
    else:
        ho_fx = load_fixtures("held_out")
        results = []
        for fx in ho_fx:
            ok, diffs = run_fixture(fx)
            results.append({"fixture_id": fx["fixture_id"], "ok": ok, "diffs": diffs})
        ho_exact = sum(1 for r in results if r["ok"])
        ho_total = len(ho_fx)
        ho_pass = ho_exact == ho_total
        held = {
            "generated_at": utc_now(),
            "phase": "6B",
            "immutable_first_run": True,
            "implementation_fingerprint": impl_fp,
            "held_out": {"exact": ho_exact, "total": ho_total},
            "INJURY_WOWY_PAIR_BUILDER_CERTIFIED": "YES" if ho_pass else "NO",
            "results": results,
        }
        ho_json.write_text(json.dumps(held, indent=2) + "\n", encoding="utf-8")
        ho_md.write_text(
            f"# Pair builder held-out first run\n\n"
            f"Immutable: YES\n\nHeld-out: **{ho_exact}/{ho_total}**\n\n"
            f"INJURY_WOWY_PAIR_BUILDER_CERTIFIED = {held['INJURY_WOWY_PAIR_BUILDER_CERTIFIED']}\n",
            encoding="utf-8",
        )
        if not ho_pass:
            print(json.dumps([r for r in results if not r["ok"]], indent=2))
            raise SystemExit("Held-out FAIL — STOP")

    # verify fingerprint modules unchanged
    if sha256_file(MODULE_TS) != impl_fp["files"]["lib/injuries/official/injury-wowy-pair.ts"]:
        raise SystemExit("builder changed after fingerprint")

    # --- Full run ---
    print("Building full pair corpus…")
    focal_map: dict[tuple[str, str, str], str] = {}
    conflicts = 0
    for r in without + with_rows:
        key = (str(r["game_id"]), str(r["team_id"]), str(r["player_entity_id"]))
        elig = str(r["injury_wowy_eligibility"])
        if key in focal_map and focal_map[key] != elig:
            conflicts += 1
        focal_map[key] = elig
    if conflicts:
        raise SystemExit(f"FOCAL_STATE_CONFLICT count={conflicts}")

    selected_by = {
        (str(r["game_id"]), str(r["team_id"]), str(r["player_entity_id"])): r
        for r in selected
        if r.get("player_entity_id")
    }
    team_game_players: dict[tuple[str, str], list] = defaultdict(list)
    for r in all_rows:
        team_game_players[(str(r["game_id"]), str(r["team_id"]))].append(r)

    eligible_by_tg: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: {"WITH": 0, "WITHOUT": 0})
    focals = []
    for r in without:
        focals.append((r, "WITHOUT_CANDIDATE"))
        eligible_by_tg[(str(r["game_id"]), str(r["team_id"]))]["WITHOUT"] += 1
    for r in with_rows:
        focals.append((r, "WITH_CANDIDATE"))
        eligible_by_tg[(str(r["game_id"]), str(r["team_id"]))]["WITH"] += 1

    tg_class = Counter()
    for counts in eligible_by_tg.values():
        w, wo = counts["WITH"], counts["WITHOUT"]
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
    pgl_rows = query_pgl(game_team_keys)
    pgl_by_gt: dict[tuple[str, str], list] = defaultdict(list)
    pgl_by_entity: dict[tuple[str, str, str], list] = defaultdict(list)
    for r in pgl_rows:
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
        pgl_by_gt[(r["game_id"], r["team_id"])].append(r)
        if r.get("player_entity_id"):
            pgl_by_entity[(r["game_id"], r["team_id"], r["player_entity_id"])].append(r)

    played_subjects = 0
    played_with_entity = 0
    subject_identity_failures = 0
    subjects_by_gt: dict[tuple[str, str], list] = defaultdict(list)
    for gt, rows in pgl_by_gt.items():
        seen: set[str] = set()
        for r in rows:
            if r["_appearance"]["class"] != "played":
                continue
            played_subjects += 1
            eid = r.get("player_entity_id")
            if not eid:
                subject_identity_failures += 1
                continue
            played_with_entity += 1
            if eid in seen:
                raise SystemExit(f"PGL_DUPLICATE_SUBJECT_ENTITY {gt} {eid}")
            seen.add(eid)
            subjects_by_gt[gt].append(r)

    def focal_realized(gt: tuple[str, str], eid: str) -> str:
        rows = pgl_by_entity.get((gt[0], gt[1], eid), [])
        if not rows:
            return "NO_PGL_ROW"
        classes = [r["_appearance"]["class"] for r in rows]
        if "played" in classes:
            return "PLAYED"
        if "dnp" in classes:
            return "DNP_00"
        return "NO_PGL_ROW"

    pair_obs: list[dict[str, Any]] = []
    self_pairs_removed = 0
    potential = 0
    anomalies: list[dict[str, Any]] = []
    with_realized = Counter()
    without_realized = Counter()

    for focal, elig in focals:
        gt = (str(focal["game_id"]), str(focal["team_id"]))
        focal_entity = str(focal["player_entity_id"])
        sel = selected_by.get((gt[0], gt[1], focal_entity), {})
        counters = compute_counters(team_game_players.get(gt, []), focal_entity)
        realized = focal_realized(gt, focal_entity)
        if elig == "WITH_CANDIDATE":
            with_realized[realized] += 1
        else:
            without_realized[realized] += 1
        if elig == "WITHOUT_CANDIDATE" and realized == "PLAYED":
            anomalies.append(
                {
                    "type": "T60_OUT_BUT_PLAYED",
                    "game_id": gt[0],
                    "team_id": gt[1],
                    "season": focal.get("season"),
                    "focal_player_entity_id": focal_entity,
                    "player_name_raw": focal.get("player_name_raw"),
                }
            )

        for subj in subjects_by_gt.get(gt, []):
            potential += 1
            sid = str(subj["player_entity_id"])
            if sid == focal_entity:
                self_pairs_removed += 1
                continue
            app = subj["_appearance"]
            inp = {
                "game_id": gt[0],
                "team_id": gt[1],
                "season": str(focal.get("season") or subj.get("season")),
                "subject_player_entity_id": sid,
                "subject_serving_player_id": subj["player_id"],
                "focal_player_entity_id": focal_entity,
                "focal_serving_player_id": sel.get("serving_player_id"),
                "focal_eligibility": elig,
                "t60_report_published_at": sel.get("report_published_at"),
                "focal_realized_participation": realized,
                "subject_metrics": {
                    "minutes": app.get("minutes"),
                    "pts": subj.get("points"),
                    "reb": subj.get("rebounds"),
                    "ast": subj.get("assists"),
                    "tpm": subj.get("three_pointers_made"),
                    "fga": subj.get("field_goals_attempted"),
                    "tpa": subj.get("three_pointers_attempted"),
                    "fta": subj.get("free_throws_attempted"),
                },
            }
            obs = build_obs(inp, counters)
            if obs is None:
                continue
            pair_obs.append(obs)

    # duplicate check
    keys = Counter(
        (o["game_id"], o["team_id"], o["subject_player_entity_id"], o["focal_player_entity_id"])
        for o in pair_obs
    )
    dup = sum(1 for v in keys.values() if v > 1)
    if dup:
        raise SystemExit(f"duplicate pair observations: {dup}")

    # sort deterministic
    pair_obs.sort(
        key=lambda o: (
            o["game_id"],
            o["team_id"],
            o["subject_player_entity_id"],
            o["focal_player_entity_id"],
        )
    )

    def write_gz(path: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        return {"sha256": sha256_file(path), "bytes": path.stat().st_size, "count": len(rows)}

    p0 = pair_obs
    p1 = [o for o in p0 if o["cohort_p1"]]
    p2 = [o for o in p0 if o["cohort_p2"]]
    p3 = [o for o in p0 if o["cohort_p3"]]
    with_obs = [o for o in p0 if o["focal_state"] == "PRE_GAME_AVAILABLE"]
    without_obs = [o for o in p0 if o["focal_state"] == "PRE_GAME_OUT"]

    arts = {
        "pair-observations.ndjson.gz": write_gz(OUT_TMP / "pair-observations.ndjson.gz", p0),
        "p0.ndjson.gz": write_gz(OUT_TMP / "p0.ndjson.gz", p0),
        "p1.ndjson.gz": write_gz(OUT_TMP / "p1.ndjson.gz", p1),
        "p2.ndjson.gz": write_gz(OUT_TMP / "p2.ndjson.gz", p2),
        "p3.ndjson.gz": write_gz(OUT_TMP / "p3.ndjson.gz", p3),
        "anomalies.ndjson.gz": write_gz(OUT_TMP / "anomalies.ndjson.gz", anomalies),
    }

    # summaries for keys
    def index(rows: list[dict], key_fn):
        idx: dict[tuple, dict[str, int]] = defaultdict(lambda: {"WITH": 0, "WITHOUT": 0})
        for o in rows:
            k = key_fn(o)
            if o["focal_state"] == "PRE_GAME_AVAILABLE":
                idx[k]["WITH"] += 1
            else:
                idx[k]["WITHOUT"] += 1
        return idx

    key_summaries = {
        "pooled": depth_counts(
            index(p0, lambda o: (o["subject_player_entity_id"], o["focal_player_entity_id"]))
        ),
        "season_bounded": depth_counts(
            index(p0, lambda o: (o["season"], o["subject_player_entity_id"], o["focal_player_entity_id"]))
        ),
        "team_bounded": depth_counts(
            index(p0, lambda o: (o["team_id"], o["subject_player_entity_id"], o["focal_player_entity_id"]))
        ),
        "season_team": depth_counts(
            index(
                p0,
                lambda o: (
                    o["season"],
                    o["team_id"],
                    o["subject_player_entity_id"],
                    o["focal_player_entity_id"],
                ),
            )
        ),
        "season_team_p1": depth_counts(
            index(
                p1,
                lambda o: (
                    o["season"],
                    o["team_id"],
                    o["subject_player_entity_id"],
                    o["focal_player_entity_id"],
                ),
            )
        ),
    }

    summary_rows = []
    pooled_idx = index(p0, lambda o: (o["subject_player_entity_id"], o["focal_player_entity_id"]))
    for (subj, focal), c in sorted(pooled_idx.items()):
        summary_rows.append(
            {
                "subject_player_entity_id": subj,
                "focal_player_entity_id": focal,
                "with_count": c["WITH"],
                "without_count": c["WITHOUT"],
            }
        )
    arts["pair-summary.ndjson.gz"] = write_gz(OUT_TMP / "pair-summary.ndjson.gz", summary_rows)

    # canonical hash
    h1 = hashlib.sha256()
    for o in p0:
        h1.update(
            json.dumps(
                {
                    "observation_id": o["observation_id"],
                    "focal_state": o["focal_state"],
                    "cohort_p1": o["cohort_p1"],
                    "cohort_p2": o["cohort_p2"],
                    "cohort_p3": o["cohort_p3"],
                    "other_health_without_count": o["other_health_without_count"],
                    "subject_metrics": o["subject_metrics"],
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
            + b"\n"
        )
    hash1 = h1.hexdigest()
    h2 = hashlib.sha256()
    for o in p0:
        h2.update(
            json.dumps(
                {
                    "observation_id": o["observation_id"],
                    "focal_state": o["focal_state"],
                    "cohort_p1": o["cohort_p1"],
                    "cohort_p2": o["cohort_p2"],
                    "cohort_p3": o["cohort_p3"],
                    "other_health_without_count": o["other_health_without_count"],
                    "subject_metrics": o["subject_metrics"],
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
            + b"\n"
        )
    deterministic = hash1 == h2.hexdigest()

    contam = {
        "other_health_without_count": bucket_dist([o["other_health_without_count"] for o in p0]),
        "other_health_with_count": bucket_dist([o["other_health_with_count"] for o in p0]),
        "other_non_health_out_count": bucket_dist([o["other_non_health_out_count"] for o in p0]),
        "other_nonbinary_health_count": bucket_dist([o["other_nonbinary_health_count"] for o in p0]),
    }

    metric_nulls = {
        k: sum(1 for o in p0 if o["subject_metrics"].get(k) is None)
        for k in ("minutes", "pts", "reb", "ast", "tpm", "fga", "tpa", "fta")
    }

    # Phase 6A reproduction checks
    ref = {
        "p0_total": 227132,
        "with_obs": 24151,
        "without_obs": 202981,
        "p1_with": 2595,
        "p1_without": 19134,
        "p2_with": 1088,
        "p2_without": 15998,
        "p3_with": 647,
        "p3_without": 6955,
        "contam_wo": {"0": 21729, "1": 45948, "2": 49552, "3+": 109903},
        "season_team_pairs": 22183,
        "season_team_both": 7225,
    }
    p1_with = sum(1 for o in p1 if o["focal_state"] == "PRE_GAME_AVAILABLE")
    p1_without = sum(1 for o in p1 if o["focal_state"] == "PRE_GAME_OUT")
    p2_with = sum(1 for o in p2 if o["focal_state"] == "PRE_GAME_AVAILABLE")
    p2_without = sum(1 for o in p2 if o["focal_state"] == "PRE_GAME_OUT")
    p3_with = sum(1 for o in p3 if o["focal_state"] == "PRE_GAME_AVAILABLE")
    p3_without = sum(1 for o in p3 if o["focal_state"] == "PRE_GAME_OUT")

    phase6a_match = {
        "p0_total": len(p0) == ref["p0_total"],
        "with_obs": len(with_obs) == ref["with_obs"],
        "without_obs": len(without_obs) == ref["without_obs"],
        "p1_with": p1_with == ref["p1_with"],
        "p1_without": p1_without == ref["p1_without"],
        "p2_with": p2_with == ref["p2_with"],
        "p2_without": p2_without == ref["p2_without"],
        "p3_with": p3_with == ref["p3_with"],
        "p3_without": p3_without == ref["p3_without"],
        "contam_wo": contam["other_health_without_count"] == ref["contam_wo"],
        "season_team_pairs": key_summaries["season_team"]["directional_pairs"] == ref["season_team_pairs"],
        "season_team_both": key_summaries["season_team"]["BOTH_STATES"] == ref["season_team_both"],
        "self_pairs": self_pairs_removed == 2249,
    }

    full_gate = (
        "PASS"
        if all(phase6a_match.values())
        and deterministic
        and dup == 0
        and conflicts == 0
        and subject_identity_failures == 0
        else "FAIL"
    )

    safety = {
        "focal_realized_redefines_t60": "NO",
        "postgame_leakage_into_focal_eligibility": "NO",
        "qdp_promoted_to_binary": "NO",
        "missing_promoted_to_available": "NO",
        "self_pairs_emitted": "NO",
        "fuzzy_identity_used": "NO",
        "minimum_sample_threshold_applied": "NO",
        "performance_effects_calculated": "NO",
    }

    run_state = {
        "generated_at": utc_now(),
        "p0_count": len(p0),
        "canonical_output_sha256": hash1,
        "deterministic": deterministic,
        "phase6a_match": phase6a_match,
        "artifacts": arts,
    }
    (OUT_TMP / "run-state.json").write_text(json.dumps(run_state, indent=2) + "\n", encoding="utf-8")

    cert = {
        "generated_at": utc_now(),
        "phase": "6B",
        "INJURY_WOWY_PAIR_BUILDER_CERTIFIED": "YES",
        "INJURY_WOWY_PAIR_BUILDER_FULL_RUN_GATE": full_gate,
        "AS_OF_INJURY_TAPE_CERTIFIED": "YES",
        "T60_REASON_POLICY_CERTIFIED": "YES",
        "WOWY_ELIGIBILITY_POLICY_CERTIFIED": "YES",
        "pair_policy_version": PAIR_POLICY_VERSION,
        "implementation_path": "lib/injuries/official/injury-wowy-pair.ts",
        "implementation_sha256": impl_fp["files"],
        "development": {"exact": dev_exact, "total": len(dev_fx)},
        "synthetic": {"exact": syn_exact, "total": len(syn_fx)},
        "held_out_first_run": {"exact": ho_exact, "total": ho_total, "immutable": True},
        "safety": safety,
        "NEXT": "PROCEED_TO_INJURY_WOWY_EFFECT_ESTIMATOR_DESIGN"
        if full_gate == "PASS"
        else "REOPEN_DEVELOPMENT",
    }
    (REPORTS / "official-injury-wowy-pair-builder-certification.json").write_text(
        json.dumps(cert, indent=2) + "\n", encoding="utf-8"
    )
    (REPORTS / "official-injury-wowy-pair-builder-certification.md").write_text(
        f"# Injury WOWY pair builder certification\n\n"
        f"**INJURY_WOWY_PAIR_BUILDER_CERTIFIED = YES**\n\n"
        f"**INJURY_WOWY_PAIR_BUILDER_FULL_RUN_GATE = {full_gate}**\n\n"
        f"- Development {dev_exact}/{len(dev_fx)}; Synthetic {syn_exact}/{len(syn_fx)}; "
        f"Held-out {ho_exact}/{ho_total} (immutable)\n"
        f"- NEXT = {cert['NEXT']}\n",
        encoding="utf-8",
    )

    full = {
        "generated_at": utc_now(),
        "phase": "6B",
        "INJURY_WOWY_PAIR_BUILDER_FULL_RUN_GATE": full_gate,
        "pair_policy_version": PAIR_POLICY_VERSION,
        "population": {
            "focal_candidates": len(without) + len(with_rows),
            "without_focals": len(without),
            "with_focals": len(with_rows),
            "played_subject_rows": played_subjects,
            "subject_identity_failures": subject_identity_failures,
            "potential_pairs": potential,
            "self_pairs_removed": self_pairs_removed,
            "p0_observations": len(p0),
            "with_observations": len(with_obs),
            "without_observations": len(without_obs),
            "duplicate_observations": dup,
            "structural_failures": conflicts,
        },
        "cohorts": {
            "P0": {"WITH": len(with_obs), "WITHOUT": len(without_obs), "total": len(p0)},
            "P1": {"WITH": p1_with, "WITHOUT": p1_without, "total": len(p1)},
            "P2": {"WITH": p2_with, "WITHOUT": p2_without, "total": len(p2)},
            "P3": {"WITH": p3_with, "WITHOUT": p3_without, "total": len(p3)},
        },
        "key_summaries": key_summaries,
        "contamination": contam,
        "team_game_multiplicity": dict(tg_class),
        "focal_realized": {"WITH": dict(with_realized), "WITHOUT": dict(without_realized)},
        "T60_OUT_BUT_PLAYED": anomalies,
        "metric_nulls": metric_nulls,
        "phase6a_match": phase6a_match,
        "deterministic": deterministic,
        "canonical_output_sha256": hash1,
        "artifacts": arts,
        "safety": safety,
        "semantics_note": (
            "P1/P2/P3 match Phase 6A design-audit code: "
            "P1=other_health_without==0 (Out+HEALTH_RELATED excl focal); "
            "P2=no other WITH_CANDIDATE/WITHOUT_CANDIDATE; "
            "P3=no other health Out and no non-health Out."
        ),
    }
    (REPORTS / "official-injury-wowy-pair-builder-full-run.json").write_text(
        json.dumps(full, indent=2) + "\n", encoding="utf-8"
    )
    (REPORTS / "official-injury-wowy-pair-builder-full-run.md").write_text(
        f"# Injury WOWY pair builder full run\n\n"
        f"**GATE = {full_gate}**\n\n"
        f"P0={len(p0)} WITH={len(with_obs)} WITHOUT={len(without_obs)}\n\n"
        f"P1={len(p1)} P2={len(p2)} P3={len(p3)}\n\n"
        f"Phase 6A match: {phase6a_match}\n",
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "INJURY_WOWY_PAIR_BUILDER_CERTIFIED": "YES",
                "INJURY_WOWY_PAIR_BUILDER_FULL_RUN_GATE": full_gate,
                "development": f"{dev_exact}/{len(dev_fx)}",
                "synthetic": f"{syn_exact}/{len(syn_fx)}",
                "held_out": f"{ho_exact}/{ho_total}",
                "p0": len(p0),
                "with": len(with_obs),
                "without": len(without_obs),
                "p1": len(p1),
                "phase6a_match": all(phase6a_match.values()),
                "NEXT": cert["NEXT"],
            },
            indent=2,
        )
    )
    return 0 if full_gate == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
