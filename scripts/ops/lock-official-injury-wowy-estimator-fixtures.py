"""Lock Phase 6D estimator fixtures BEFORE TS implementation (reference math only)."""
from __future__ import annotations

import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ops"))
from _injury_wowy_estimator_ref import (  # noqa: E402
    METRICS,
    Obs,
    estimate_pair,
    run_metric_window,
    Z_CRITICAL,
)

FIX = ROOT / "tests" / "fixtures" / "official-injury-wowy-estimator"
PAIR_P1 = ROOT / "tmp" / "official-injury-wowy-pairs" / "p1.ndjson.gz"
MANIFEST = ROOT / "tmp" / "official-injury-wowy-estimator" / "game-start-manifest.ndjson"


def load_manifest() -> dict[str, str]:
    m: dict[str, str] = {}
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        o = json.loads(line)
        m[o["game_id"]] = o["start_time_utc"]
    return m


def load_p1(manifest: dict[str, str]) -> list[Obs]:
    out: list[Obs] = []
    with gzip.open(PAIR_P1, "rt", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            o = json.loads(line)
            gs = manifest[o["game_id"]]
            out.append(
                Obs(
                    game_id=o["game_id"],
                    game_start=gs,
                    season=str(o["season"]),
                    team_id=str(o["team_id"]),
                    subject_player_entity_id=o["subject_player_entity_id"],
                    focal_player_entity_id=o["focal_player_entity_id"],
                    focal_state=o["focal_state"],
                    metrics={k: float(o["subject_metrics"][k]) for k in METRICS},
                    cohort_flags={
                        "cohort_p0": True,
                        "cohort_p1": bool(o.get("cohort_p1")),
                        "cohort_p2": bool(o.get("cohort_p2")),
                        "cohort_p3": bool(o.get("cohort_p3")),
                    },
                )
            )
    return out


def write_fx(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def syn_obs(
    *,
    game_id: str,
    game_start: str,
    season: str,
    team: str,
    subject: str,
    focal: str,
    state: str,
    pts: float,
    minutes: float = 20.0,
) -> Obs:
    mets = {m: 0.0 for m in METRICS}
    mets["pts"] = pts
    mets["minutes"] = minutes
    return Obs(
        game_id=game_id,
        game_start=game_start,
        season=season,
        team_id=team,
        subject_player_entity_id=subject,
        focal_player_entity_id=focal,
        focal_state=state,  # type: ignore
        metrics=mets,
        cohort_flags={"cohort_p0": True, "cohort_p1": True, "cohort_p2": True, "cohort_p3": True},
    )


def lock_synthetic() -> list[dict]:
    """Hand-locked + reference-verified synthetic fixtures."""
    fixtures: list[dict] = []

    # --- Case A: ordinary 2/2 with injected prior world large enough ---
    # Build a closed world: target pair 2/2 + 20 other BOTH pairs with known structure
    # For Case A review values, amendment used fixed mu0=2,tau2=4,sigma2=25.
    # Here we test posterior math via `kind=posterior_only` with locked prior.
    fixtures.append(
        {
            "fixture_id": "syn-case-a-posterior",
            "split": "synthetic",
            "kind": "posterior_only",
            "input": {
                "raw_delta": 5.0,
                "sampling_variance": 2.0,
                "mu0": 2.0,
                "tau2": 4.0,
                "with_n": 2,
                "without_n": 2,
            },
            "expected": {
                "data_weight": 4.0 / 6.0,
                "prior_weight": 2.0 / 6.0,
                "estimated_delta": 4.0,
                "posterior_variance": 4.0 / 3.0,
                "interval_low": 4.0 - Z_CRITICAL * (4.0 / 3.0) ** 0.5,
                "interval_high": 4.0 + Z_CRITICAL * (4.0 / 3.0) ** 0.5,
                "estimation_status": "SPARSE_BOTH_STATES",
                "ui_display_eligible": False,
                "quality_tier": "Q2",
            },
        }
    )

    # Case B 1/1 posterior
    fixtures.append(
        {
            "fixture_id": "syn-case-b-1-1-posterior",
            "split": "synthetic",
            "kind": "posterior_only",
            "input": {
                "raw_delta": 5.0,
                "sampling_variance": 50.0,
                "mu0": 2.0,
                "tau2": 4.0,
                "with_n": 1,
                "without_n": 1,
            },
            "expected": {
                "data_weight": 4.0 / 54.0,
                "prior_weight": 50.0 / 54.0,
                "estimated_delta": (4.0 / 54.0) * 5.0 + (50.0 / 54.0) * 2.0,
                "posterior_variance": (4.0 * 50.0) / 54.0,
                "interval_low": ((4.0 / 54.0) * 5.0 + (50.0 / 54.0) * 2.0)
                - Z_CRITICAL * ((4.0 * 50.0) / 54.0) ** 0.5,
                "interval_high": ((4.0 / 54.0) * 5.0 + (50.0 / 54.0) * 2.0)
                + Z_CRITICAL * ((4.0 * 50.0) / 54.0) ** 0.5,
                "estimation_status": "SPARSE_BOTH_STATES",
                "ui_display_eligible": False,
                "quality_tier": "Q1",
            },
        }
    )

    # Case C high vs low v
    fixtures.append(
        {
            "fixture_id": "syn-case-c-shrinkage-order",
            "split": "synthetic",
            "kind": "shrinkage_order",
            "input": {
                "y": 5.0,
                "mu0": 2.0,
                "tau2": 4.0,
                "v_low": 2.0,
                "v_high": 50.0,
            },
            "expected": {
                "data_weight_low": 4.0 / 6.0,
                "data_weight_high": 4.0 / 54.0,
                "est_low": 4.0,
                "est_high": (4.0 / 54.0) * 5.0 + (50.0 / 54.0) * 2.0,
                "ordering": "high_v_closer_to_mu0",
            },
        }
    )

    # Sign positive / negative raw
    fixtures.append(
        {
            "fixture_id": "syn-sign-positive",
            "split": "synthetic",
            "kind": "raw_delta_only",
            "input": {"with_values": [10.0, 10.0], "without_values": [15.0, 15.0]},
            "expected": {"raw_delta": 5.0},
        }
    )
    fixtures.append(
        {
            "fixture_id": "syn-sign-negative",
            "split": "synthetic",
            "kind": "raw_delta_only",
            "input": {"with_values": [15.0, 15.0], "without_values": [10.0, 10.0]},
            "expected": {"raw_delta": -5.0},
        }
    )

    # Status-only synthetics
    for fid, wn, won, status in [
        ("syn-no-history", 0, 0, "NO_HISTORY"),
        ("syn-with-only", 2, 0, "ONE_SIDED_HISTORY"),
        ("syn-without-only", 0, 3, "ONE_SIDED_HISTORY"),
    ]:
        fixtures.append(
            {
                "fixture_id": fid,
                "split": "synthetic",
                "kind": "status_counts",
                "input": {"with_n": wn, "without_n": won},
                "expected": {
                    "estimation_status": status,
                    "ui_display_eligible": False,
                    "raw_delta": None,
                    "estimated_delta": None,
                },
            }
        )

    # Strict as-of cutoff
    fixtures.append(
        {
            "fixture_id": "syn-strict-asof-cutoff",
            "split": "synthetic",
            "kind": "asof_filter",
            "input": {
                "as_of": "2024-01-01T00:00:00.000Z",
                "game_starts": [
                    "2023-12-31T23:59:59.000Z",
                    "2024-01-01T00:00:00.000Z",
                    "2024-01-01T00:00:01.000Z",
                ],
            },
            "expected": {"eligible_game_starts": ["2023-12-31T23:59:59.000Z"]},
        }
    )

    # Zero variance fallback
    fixtures.append(
        {
            "fixture_id": "syn-zero-variance-fallback",
            "split": "synthetic",
            "kind": "state_variance_rule",
            "input": {"values": [7.0, 7.0], "sigma2_pool": 25.0},
            "expected": {
                "observed_s2": 0.0,
                "variance_used": 25.0,
                "variance_source": "POOLED_ZERO_VARIANCE_FALLBACK",
            },
        }
    )

    # Singleton fallback
    fixtures.append(
        {
            "fixture_id": "syn-singleton-fallback",
            "split": "synthetic",
            "kind": "state_variance_rule",
            "input": {"values": [7.0], "sigma2_pool": 25.0},
            "expected": {
                "variance_used": 25.0,
                "variance_source": "POOLED_SINGLETON_FALLBACK",
            },
        }
    )

    # PRIOR_NOT_ESTIMABLE: tau2<=0 world — build k pairs identical y with tiny v so Q small
    # Simpler: kind=prior_gate with forced prior_pair_count
    fixtures.append(
        {
            "fixture_id": "syn-prior-min-pairs",
            "split": "synthetic",
            "kind": "prior_gate",
            "input": {"prior_pair_count": 19, "pooled_residual_df": 100, "tau2": 1.0},
            "expected": {"prior_estimable": False, "estimation_status": "PRIOR_NOT_ESTIMABLE"},
        }
    )
    fixtures.append(
        {
            "fixture_id": "syn-prior-df-short",
            "split": "synthetic",
            "kind": "prior_gate",
            "input": {"prior_pair_count": 50, "pooled_residual_df": 19, "tau2": 1.0},
            "expected": {"prior_estimable": False, "estimation_status": "PRIOR_NOT_ESTIMABLE"},
        }
    )
    fixtures.append(
        {
            "fixture_id": "syn-prior-tau2-zero",
            "split": "synthetic",
            "kind": "prior_gate",
            "input": {"prior_pair_count": 50, "pooled_residual_df": 100, "tau2": 0.0},
            "expected": {"prior_estimable": False, "estimation_status": "PRIOR_NOT_ESTIMABLE"},
        }
    )

    # Future mutation invariance (structural)
    fixtures.append(
        {
            "fixture_id": "syn-future-mutation",
            "split": "synthetic",
            "kind": "future_mutation",
            "input": {
                "as_of": "2024-06-01T00:00:00.000Z",
                "base_obs_starts": ["2024-01-01T00:00:00.000Z", "2024-02-01T00:00:00.000Z"],
                "future_obs_starts": ["2024-07-01T00:00:00.000Z"],
            },
            "expected": {"outputs_identical_after_mutation": True},
        }
    )

    # Invalid metric fail-close
    fixtures.append(
        {
            "fixture_id": "syn-invalid-metric",
            "split": "synthetic",
            "kind": "invalid_metric",
            "input": {"metric": "fg_pct"},
            "expected": {"fail_closed": True},
        }
    )

    # PAIR_ESTIMATE_AVAILABLE threshold
    fixtures.append(
        {
            "fixture_id": "syn-ui-3-3",
            "split": "synthetic",
            "kind": "posterior_only",
            "input": {
                "raw_delta": 1.0,
                "sampling_variance": 1.0,
                "mu0": 0.0,
                "tau2": 1.0,
                "with_n": 3,
                "without_n": 3,
            },
            "expected": {
                "estimation_status": "PAIR_ESTIMATE_AVAILABLE",
                "ui_display_eligible": True,
                "quality_tier": "Q3",
                "estimated_delta": 0.5,
                "data_weight": 0.5,
            },
        }
    )

    return fixtures


def pick_real_keys(obs: list[Obs]) -> dict[str, tuple]:
    counts: dict[tuple, dict[str, int]] = defaultdict(lambda: {"W": 0, "WO": 0})
    for o in obs:
        k = (o.season, o.team_id, o.subject_player_entity_id, o.focal_player_entity_id)
        if o.focal_state == "PRE_GAME_AVAILABLE":
            counts[k]["W"] += 1
        else:
            counts[k]["WO"] += 1

    def find(pred, exclude: set):
        for k, v in sorted(counts.items()):
            if k in exclude:
                continue
            if pred(v["W"], v["WO"]):
                return k
        raise RuntimeError("no key")

    used: set = set()
    picks = {}
    specs = [
        ("exact_1_1", lambda w, wo: w == 1 and wo == 1),
        ("1_2", lambda w, wo: w == 1 and wo == 2),
        ("2_1", lambda w, wo: w == 2 and wo == 1),
        ("2_2", lambda w, wo: w == 2 and wo == 2),
        ("3_3", lambda w, wo: w >= 3 and wo >= 3 and w == 3 and wo == 3),
        ("ge_5_5", lambda w, wo: w >= 5 and wo >= 5),
        ("imbalance", lambda w, wo: w >= 1 and wo >= 1 and wo / max(w, 1) >= 5),
        ("with_only", lambda w, wo: w > 0 and wo == 0),
        ("without_only", lambda w, wo: w == 0 and wo > 0),
    ]
    for name, pred in specs:
        k = find(pred, used)
        used.add(k)
        picks[name] = k
    # extras for development + held_out diversity
    for i in range(30):
        k = find(lambda w, wo: w >= 1 and wo >= 1, used)
        used.add(k)
        picks[f"both_extra_{i}"] = k
    return picks


def lock_real(obs: list[Obs]) -> None:
    prior, pairs, _ = run_metric_window(
        obs, metric="pts", cohort="P1", mode="RESEARCH_FULL_HISTORY", as_of=None
    )
    picks = pick_real_keys(obs)
    # split: hard / sparse cases in held_out; rest development
    held_names = [
        "exact_1_1",
        "1_2",
        "2_1",
        "imbalance",
        "with_only",
        "without_only",
        "ge_5_5",
        "both_extra_0",
        "both_extra_1",
        "both_extra_2",
        "both_extra_3",
        "both_extra_4",
        "both_extra_5",
        "both_extra_6",
    ]
    manifest_entries = []
    for name, key in picks.items():
        split = "held_out" if name in held_names else "development"
        pr = pairs[key]
        res = estimate_pair(
            pr,
            prior,
            season=key[0],
            team_id=key[1],
            subject=key[2],
            focal=key[3],
            metric="pts",
            cohort="P1",
            mode="RESEARCH_FULL_HISTORY",
            as_of=None,
        )
        fx = {
            "fixture_id": f"{'ho' if split=='held_out' else 'dev'}-{name}-pts",
            "split": split,
            "kind": "real_pair_corpus",
            "category": name,
            "input": {
                "mode": "RESEARCH_FULL_HISTORY",
                "as_of": None,
                "cohort": "P1",
                "metric": "pts",
                "pair_key": {
                    "season": key[0],
                    "team_id": key[1],
                    "subject_player_entity_id": key[2],
                    "focal_player_entity_id": key[3],
                },
                "corpus": "tmp/official-injury-wowy-pairs/p1.ndjson.gz",
                "game_start_manifest": "tmp/official-injury-wowy-estimator/game-start-manifest.ndjson",
            },
            "expected": res,
        }
        write_fx(FIX / split / f"{fx['fixture_id']}.json", fx)
        manifest_entries.append({"fixture_id": fx["fixture_id"], "split": split, "category": name})

    # multi-metric development on 3_3 key
    key = picks["3_3"]
    for metric in ("minutes", "reb", "ast"):
        prior_m, pairs_m, _ = run_metric_window(
            obs, metric=metric, cohort="P1", mode="RESEARCH_FULL_HISTORY", as_of=None
        )
        pr = pairs_m[key]
        res = estimate_pair(
            pr,
            prior_m,
            season=key[0],
            team_id=key[1],
            subject=key[2],
            focal=key[3],
            metric=metric,
            cohort="P1",
            mode="RESEARCH_FULL_HISTORY",
            as_of=None,
        )
        fx = {
            "fixture_id": f"dev-3_3-{metric}",
            "split": "development",
            "kind": "real_pair_corpus",
            "category": f"3_3_{metric}",
            "input": {
                "mode": "RESEARCH_FULL_HISTORY",
                "as_of": None,
                "cohort": "P1",
                "metric": metric,
                "pair_key": {
                    "season": key[0],
                    "team_id": key[1],
                    "subject_player_entity_id": key[2],
                    "focal_player_entity_id": key[3],
                },
                "corpus": "tmp/official-injury-wowy-pairs/p1.ndjson.gz",
                "game_start_manifest": "tmp/official-injury-wowy-estimator/game-start-manifest.ndjson",
            },
            "expected": res,
        }
        write_fx(FIX / "development" / f"{fx['fixture_id']}.json", fx)
        manifest_entries.append({"fixture_id": fx["fixture_id"], "split": "development", "category": fx["category"]})

    # as-of vs research for one BOTH pair
    key = picks["2_2"]
    # pick mid as_of from that pair's games
    pair_obs = [
        o
        for o in obs
        if (o.season, o.team_id, o.subject_player_entity_id, o.focal_player_entity_id) == key
    ]
    starts = sorted({o.game_start for o in pair_obs})
    mid = starts[len(starts) // 2]
    prior_a, pairs_a, _ = run_metric_window(
        obs, metric="pts", cohort="P1", mode="PRODUCTION_AS_OF", as_of=mid
    )
    pr_a = pairs_a.get(key)
    if pr_a is None:
        # pair may have no history before mid — still lock NO_HISTORY / ONE_SIDED
        from _injury_wowy_estimator_ref import PairRaw

        pr_a = PairRaw(0, 0, None, None, None, None, None, None, None, None)
    res_a = estimate_pair(
        pr_a,
        prior_a,
        season=key[0],
        team_id=key[1],
        subject=key[2],
        focal=key[3],
        metric="pts",
        cohort="P1",
        mode="PRODUCTION_AS_OF",
        as_of=mid,
    )
    res_r = estimate_pair(
        pairs[key],
        prior,
        season=key[0],
        team_id=key[1],
        subject=key[2],
        focal=key[3],
        metric="pts",
        cohort="P1",
        mode="RESEARCH_FULL_HISTORY",
        as_of=None,
    )
    fx = {
        "fixture_id": "dev-asof-vs-research-2_2",
        "split": "development",
        "kind": "asof_vs_research",
        "category": "asof_vs_research",
        "input": {
            "pair_key": {
                "season": key[0],
                "team_id": key[1],
                "subject_player_entity_id": key[2],
                "focal_player_entity_id": key[3],
            },
            "metric": "pts",
            "cohort": "P1",
            "as_of": mid,
            "corpus": "tmp/official-injury-wowy-pairs/p1.ndjson.gz",
            "game_start_manifest": "tmp/official-injury-wowy-estimator/game-start-manifest.ndjson",
        },
        "expected": {
            "research": {
                "with_n": res_r["with_n"],
                "without_n": res_r["without_n"],
                "estimation_status": res_r["estimation_status"],
            },
            "asof": {
                "with_n": res_a["with_n"],
                "without_n": res_a["without_n"],
                "estimation_status": res_a["estimation_status"],
                "max_training_game_start": prior_a.max_training_game_start,
                "as_of": mid,
            },
            "counts_differ": (res_r["with_n"], res_r["without_n"])
            != (res_a["with_n"], res_a["without_n"]),
            "asof_max_lt_asof": prior_a.max_training_game_start is None
            or prior_a.max_training_game_start < mid,
        },
    }
    write_fx(FIX / "development" / f"{fx['fixture_id']}.json", fx)
    manifest_entries.append({"fixture_id": fx["fixture_id"], "split": "development", "category": "asof_vs_research"})

    return manifest_entries, prior


def main() -> None:
    FIX.mkdir(parents=True, exist_ok=True)
    syn = lock_synthetic()
    for fx in syn:
        write_fx(FIX / "synthetic" / f"{fx['fixture_id']}.json", fx)

    manifest = load_manifest()
    obs = load_p1(manifest)
    real_manifest, prior = lock_real(obs)

    man = {
        "tolerance": {"abs": 1e-10, "rel": 1e-10},
        "estimator_version": "injury-wowy-estimator-v1",
        "synthetic_count": len(syn),
        "real_entries": real_manifest,
        "research_pts_prior_lock": {
            "prior_pair_count": prior.prior_pair_count,
            "pooled_residual_df": prior.pooled_residual_df,
            "sigma2_pool": prior.sigma2_pool,
            "mu0": prior.mu0,
            "tau2": prior.tau2,
            "estimable": prior.estimable,
        },
        "note": "Real expected outputs locked via Python reference BEFORE TS implementation.",
    }
    write_fx(FIX / "manifest.json", man)
    print(json.dumps({"synthetic": len(syn), "real": len(real_manifest), "prior_estimable": prior.estimable, "k": prior.prior_pair_count}, indent=2))


if __name__ == "__main__":
    main()
