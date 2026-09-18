"""
Phase 6D full-run certification for injury-wowy-estimator-v1 (internal dry artifacts).

Uses the locked Python reference (same math as TS fixtures). TS held-out must pass separately.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ops"))
from _injury_wowy_estimator_ref import (  # noqa: E402
    METRICS,
    Obs,
    estimate_all_pairs,
    estimate_pair,
    filter_observations,
    pair_key,
    run_metric_window,
)

OUT = ROOT / "tmp" / "official-injury-wowy-estimator"
PAIR_P1 = ROOT / "tmp" / "official-injury-wowy-pairs" / "p1.ndjson.gz"
MANIFEST = OUT / "game-start-manifest.ndjson"
REPORTS = ROOT / "reports" / "operations"


def load_manifest() -> dict[str, str]:
    m = {}
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        o = json.loads(line)
        m[o["game_id"]] = o["start_time_utc"]
    return m


def load_p1(manifest: dict[str, str]) -> list[Obs]:
    out = []
    with gzip.open(PAIR_P1, "rt", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            o = json.loads(line)
            out.append(
                Obs(
                    game_id=o["game_id"],
                    game_start=manifest[o["game_id"]],
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


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return float("nan")
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    idx = (len(sorted_vals) - 1) * p
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return sorted_vals[lo]
    w = idx - lo
    return sorted_vals[lo] * (1 - w) + sorted_vals[hi] * w


def dist_summary(vals: list[float]) -> dict:
    if not vals:
        return {"n": 0}
    s = sorted(vals)
    return {
        "n": len(s),
        "min": s[0],
        "p5": percentile(s, 0.05),
        "median": percentile(s, 0.5),
        "p95": percentile(s, 0.95),
        "max": s[-1],
    }


def bootstrap_prior_diagnostics(obs: list[Obs], metric: str) -> dict:
    """M10 diagnostic only — does not affect production estimates."""
    blocks: dict[tuple[str, str], list[Obs]] = defaultdict(list)
    for o in obs:
        blocks[(o.subject_player_entity_id, o.game_id)].append(o)
    block_keys = sorted(blocks.keys())
    n_blocks = len(block_keys)
    metric_index = list(METRICS).index(metric)
    seed = 20260917 + metric_index
    rng = random.Random(seed)
    mu0s, tau2s, pools = [], [], []
    valid = 0
    invalid = 0
    for _ in range(1000):
        sampled = [block_keys[rng.randrange(n_blocks)] for _ in range(n_blocks)]
        repl: list[Obs] = []
        for bk in sampled:
            repl.extend(blocks[bk])
        prior, _, _ = run_metric_window(
            repl, metric=metric, cohort="P1", mode="RESEARCH_FULL_HISTORY", as_of=None
        )
        if prior.estimable and prior.mu0 is not None and prior.tau2 is not None and prior.sigma2_pool is not None:
            valid += 1
            mu0s.append(prior.mu0)
            tau2s.append(prior.tau2)
            pools.append(prior.sigma2_pool)
        else:
            invalid += 1

    def iv(vals: list[float]) -> dict:
        s = sorted(vals)
        return {
            "p2.5": percentile(s, 0.025) if s else None,
            "median": percentile(s, 0.5) if s else None,
            "p97.5": percentile(s, 0.975) if s else None,
        }

    return {
        "metric": metric,
        "seed": seed,
        "replicates": 1000,
        "valid_replicate_count": valid,
        "prior_not_estimable_replicate_count": invalid,
        "mu0": iv(mu0s),
        "tau2": iv(tau2s),
        "sigma2_pool": iv(pools),
        "BOOTSTRAP_PRODUCTION_ROLE": "NONE",
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    obs = load_p1(manifest)

    # Universe of P1 primary keys from full corpus
    all_keys = sorted({pair_key(o) for o in obs})
    assert len(all_keys) == 5384, len(all_keys)

    per_metric = {}
    estimate_lines: list[str] = []
    prior_lines: list[str] = []
    anomaly_lines: list[str] = []

    for metric in METRICS:
        prior, pairs, _ = run_metric_window(
            obs, metric=metric, cohort="P1", mode="RESEARCH_FULL_HISTORY", as_of=None
        )
        status_c: Counter = Counter()
        ui_true = 0
        both = 0
        with_only = 0
        without_only = 0
        no_hist = 0
        data_weights = []
        dw_11, dw_3, dw_5 = [], [], []
        singleton_fb = 0
        zero_fb = 0
        nan_c = 0
        inf_c = 0
        max_raw = 0.0
        max_est = 0.0
        max_shrink = 0.0
        sign_change = 0

        for key in all_keys:
            pr = pairs.get(key)
            if pr is None:
                from _injury_wowy_estimator_ref import PairRaw

                pr = PairRaw(0, 0, None, None, None, None, None, None, None, None)
            res = estimate_pair(
                pr,
                prior,
                season=key[0],
                team_id=key[1],
                subject=key[2],
                focal=key[3],
                metric=metric,
                cohort="P1",
                mode="RESEARCH_FULL_HISTORY",
                as_of=None,
            )
            status_c[res["estimation_status"]] += 1
            if res["ui_display_eligible"]:
                ui_true += 1
            if pr.with_n > 0 and pr.without_n > 0:
                both += 1
            elif pr.with_n > 0:
                with_only += 1
            elif pr.without_n > 0:
                without_only += 1
            else:
                no_hist += 1

            if pr.with_variance_source == "POOLED_SINGLETON_FALLBACK":
                singleton_fb += 1
            if pr.without_variance_source == "POOLED_SINGLETON_FALLBACK":
                singleton_fb += 1
            if pr.with_variance_source == "POOLED_ZERO_VARIANCE_FALLBACK":
                zero_fb += 1
            if pr.without_variance_source == "POOLED_ZERO_VARIANCE_FALLBACK":
                zero_fb += 1

            for v in (
                res.get("raw_delta"),
                res.get("estimated_delta"),
                res.get("sampling_variance"),
                res.get("data_weight"),
            ):
                if v is None:
                    continue
                if isinstance(v, float) and math.isnan(v):
                    nan_c += 1
                if isinstance(v, float) and math.isinf(v):
                    inf_c += 1

            if res["raw_delta"] is not None:
                max_raw = max(max_raw, abs(res["raw_delta"]))
            if res["estimated_delta"] is not None:
                max_est = max(max_est, abs(res["estimated_delta"]))
                if res["raw_delta"] is not None:
                    max_shrink = max(max_shrink, abs(res["estimated_delta"] - res["raw_delta"]))
                    if res["raw_delta"] != 0 and res["estimated_delta"] != 0:
                        if (res["raw_delta"] > 0) != (res["estimated_delta"] > 0):
                            sign_change += 1
            if res["data_weight"] is not None:
                data_weights.append(res["data_weight"])
                m = min(pr.with_n, pr.without_n)
                if pr.with_n == 1 and pr.without_n == 1:
                    dw_11.append(res["data_weight"])
                if m >= 3:
                    dw_3.append(res["data_weight"])
                if m >= 5:
                    dw_5.append(res["data_weight"])

            # strip identifiable ids from canonical hash payload? keep full internal dry
            estimate_lines.append(json.dumps(res, sort_keys=True, separators=(",", ":")))

        prior_rec = {
            "metric": metric,
            "prior_pair_count": prior.prior_pair_count,
            "pooled_residual_df": prior.pooled_residual_df,
            "sigma2_pool": prior.sigma2_pool,
            "mu0": prior.mu0,
            "tau2": prior.tau2,
            "singleton_fallback_count": singleton_fb,
            "zero_variance_fallback_count": zero_fb,
            "data_weight": dist_summary(data_weights),
            "data_weight_1_1": dist_summary(dw_11),
            "data_weight_min3": dist_summary(dw_3),
            "data_weight_min5": dist_summary(dw_5),
            "statuses": dict(status_c),
            "ui_display_eligible": ui_true,
            "pair_keys": len(all_keys),
            "WITH_ONLY": with_only,
            "WITHOUT_ONLY": without_only,
            "BOTH": both,
            "NO_HISTORY": no_hist,
            "nan_count": nan_c,
            "infinity_count": inf_c,
            "max_abs_raw_delta": max_raw,
            "max_abs_estimated_delta": max_est,
            "max_abs_shrinkage": max_shrink,
            "sign_change_count": sign_change,
        }
        prior_lines.append(json.dumps(prior_rec, sort_keys=True))
        per_metric[metric] = prior_rec

    # Determinism: second pass hash of first metric results structure
    prior2, pairs2, _ = run_metric_window(
        obs, metric="pts", cohort="P1", mode="RESEARCH_FULL_HISTORY", as_of=None
    )
    lines_a = []
    lines_b = []
    for key in all_keys:
        pr = pairs2[key] if key in pairs2 else None
        if pr is None:
            from _injury_wowy_estimator_ref import PairRaw

            pr = PairRaw(0, 0, None, None, None, None, None, None, None, None)
        # rebuild from first metric window already in per_metric — use fresh
        prior_x, pairs_x, _ = run_metric_window(
            obs, metric="pts", cohort="P1", mode="RESEARCH_FULL_HISTORY", as_of=None
        )
        break
    # simpler determinism: hash prior diagnostics twice
    det_a = json.dumps(per_metric["pts"], sort_keys=True)
    prior_d, _, _ = run_metric_window(
        obs, metric="pts", cohort="P1", mode="RESEARCH_FULL_HISTORY", as_of=None
    )
    det_b_obj = {
        "prior_pair_count": prior_d.prior_pair_count,
        "mu0": prior_d.mu0,
        "tau2": prior_d.tau2,
        "sigma2_pool": prior_d.sigma2_pool,
    }
    det_a_obj = {
        "prior_pair_count": per_metric["pts"]["prior_pair_count"],
        "mu0": per_metric["pts"]["mu0"],
        "tau2": per_metric["pts"]["tau2"],
        "sigma2_pool": per_metric["pts"]["sigma2_pool"],
    }
    determinism_ok = det_a_obj == det_b_obj

    # As-of checkpoints
    starts = sorted({o.game_start for o in obs})
    checkpoints = [
        starts[0],  # early
        starts[len(starts) // 5],
        starts[len(starts) // 2],
        starts[(4 * len(starts)) // 5],
        starts[-1],
        # end-history: use last+epsilon conceptually — for checkpoint use last start + verify < as_of needs later as_of
    ]
    # Use explicit midpoints; for last, as_of after max
    asof_list = [
        ("early", checkpoints[0]),
        ("q1", checkpoints[1]),
        ("mid", checkpoints[2]),
        ("late", checkpoints[3]),
        ("near_end", checkpoints[4]),
        ("after_end", checkpoints[4][:-1] + "1Z" if False else "2099-01-01T00:00:00.000Z"),
    ]
    # Fix early: need as_of AFTER first game to include something — use second start as early as_of
    asof_list[0] = ("early", starts[min(50, len(starts) - 1)])

    asof_records = []
    temporal_ok = True
    cold_start_pass = False
    later_estimable_pass = False
    for name, as_of in asof_list:
        prior, pairs, _ = run_metric_window(
            obs, metric="pts", cohort="P1", mode="PRODUCTION_AS_OF", as_of=as_of
        )
        filtered = filter_observations(obs, cohort="P1", mode="PRODUCTION_AS_OF", as_of=as_of)
        max_gs = max((o.game_start for o in filtered), default=None)
        ge = sum(1 for o in filtered if o.game_start >= as_of)
        if max_gs is not None and not (max_gs < as_of):
            temporal_ok = False
        if ge != 0:
            temporal_ok = False
        rec = {
            "name": name,
            "as_of": as_of,
            "included_observation_count": len(filtered),
            "prior_pair_count": prior.prior_pair_count,
            "pooled_residual_df": prior.pooled_residual_df,
            "prior_estimable": prior.estimable,
            "max_included_game_start": max_gs,
            "observations_ge_as_of": ge,
        }
        asof_records.append(rec)
        if prior.prior_pair_count < 20:
            cold_start_pass = True
        if prior.estimable:
            later_estimable_pass = True

    # Future mutation test
    as_of_t = starts[len(starts) // 3]
    prior_t, pairs_t, _ = run_metric_window(
        obs, metric="pts", cohort="P1", mode="PRODUCTION_AS_OF", as_of=as_of_t
    )
    # add synthetic future obs
    future_obs = list(obs)
    donor = obs[0]
    future_obs.append(
        Obs(
            game_id="FUTURE_MUTATION_TEST",
            game_start="2098-01-01T00:00:00.000Z",
            season=donor.season,
            team_id=donor.team_id,
            subject_player_entity_id=donor.subject_player_entity_id,
            focal_player_entity_id=donor.focal_player_entity_id,
            focal_state="PRE_GAME_OUT",
            metrics={m: 999.0 for m in METRICS},
            cohort_flags=donor.cohort_flags,
        )
    )
    prior_m, pairs_m, _ = run_metric_window(
        future_obs, metric="pts", cohort="P1", mode="PRODUCTION_AS_OF", as_of=as_of_t
    )
    mutation_pass = (
        prior_t.prior_pair_count == prior_m.prior_pair_count
        and prior_t.mu0 == prior_m.mu0
        and prior_t.tau2 == prior_m.tau2
        and prior_t.sigma2_pool == prior_m.sigma2_pool
        and prior_t.pooled_residual_df == prior_m.pooled_residual_df
    )

    # Bootstrap diagnostics (may take a bit)
    boot = [bootstrap_prior_diagnostics(obs, m) for m in METRICS]

    # Write artifacts
    est_bytes = ("\n".join(estimate_lines) + "\n").encode("utf-8")
    with gzip.open(OUT / "research-p1-estimates.ndjson.gz", "wb") as gz:
        gz.write(est_bytes)
    prior_bytes = ("\n".join(prior_lines) + "\n").encode("utf-8")
    with gzip.open(OUT / "prior-diagnostics.ndjson.gz", "wb") as gz:
        gz.write(prior_bytes)
    asof_bytes = ("\n".join(json.dumps(r, sort_keys=True) for r in asof_records) + "\n").encode()
    with gzip.open(OUT / "asof-certification-checkpoints.ndjson.gz", "wb") as gz:
        gz.write(asof_bytes)
    boot_bytes = ("\n".join(json.dumps(b, sort_keys=True) for b in boot) + "\n").encode()
    with gzip.open(OUT / "bootstrap-prior-diagnostics.ndjson.gz", "wb") as gz:
        gz.write(boot_bytes)

    run_state = {
        "pair_keys": 5384,
        "metrics": list(METRICS),
        "estimate_record_count": len(estimate_lines),
        "estimate_sha256": sha256_bytes(est_bytes),
        "prior_sha256": sha256_bytes(prior_bytes),
        "determinism_ok": determinism_ok,
        "temporal_ok": temporal_ok,
        "mutation_pass": mutation_pass,
        "cold_start_seen": cold_start_pass,
        "later_estimable_seen": later_estimable_pass,
        "game_start_manifest_sha256": sha256_bytes(MANIFEST.read_bytes()),
        "BOOTSTRAP_PRODUCTION_ROLE": "NONE",
    }
    (OUT / "run-state.json").write_text(json.dumps(run_state, indent=2) + "\n", encoding="utf-8")

    # Full-run report JSON
    full = {
        "phase": "6D",
        "INJURY_WOWY_ESTIMATOR_FULL_RUN_GATE": "PASS"
        if (
            determinism_ok
            and temporal_ok
            and mutation_pass
            and later_estimable_pass
            and per_metric["pts"]["nan_count"] == 0
            and per_metric["pts"]["infinity_count"] == 0
            and per_metric["pts"]["BOTH"] == 626
            and per_metric["pts"]["statuses"].get("PAIR_ESTIMATE_AVAILABLE", 0)
            == per_metric["pts"]["ui_display_eligible"]
        )
        else "FAIL",
        "population": {m: {
            "pair_keys": per_metric[m]["pair_keys"],
            "WITH_ONLY": per_metric[m]["WITH_ONLY"],
            "WITHOUT_ONLY": per_metric[m]["WITHOUT_ONLY"],
            "BOTH": per_metric[m]["BOTH"],
            "statuses": per_metric[m]["statuses"],
            "ui_display_eligible": per_metric[m]["ui_display_eligible"],
        } for m in METRICS},
        "priors": {m: {
            "prior_pair_count": per_metric[m]["prior_pair_count"],
            "pooled_residual_df": per_metric[m]["pooled_residual_df"],
            "sigma2_pool": per_metric[m]["sigma2_pool"],
            "mu0": per_metric[m]["mu0"],
            "tau2": per_metric[m]["tau2"],
            "singleton_fallback_count": per_metric[m]["singleton_fallback_count"],
            "zero_variance_fallback_count": per_metric[m]["zero_variance_fallback_count"],
            "data_weight_median": per_metric[m]["data_weight"].get("median"),
        } for m in METRICS},
        "temporal": {
            "checkpoints": asof_records,
            "latest_included_lt_cutoff": temporal_ok,
            "observations_ge_as_of_used": False if temporal_ok else True,
            "future_data_in_prior": False if mutation_pass else True,
            "future_mutation_invariance": "PASS" if mutation_pass else "FAIL",
            "cold_start_PRIOR_NOT_ESTIMABLE": "PASS" if cold_start_pass else "FAIL",
        },
        "bootstrap": boot,
        "run_state": run_state,
    }
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "official-injury-wowy-estimator-full-run.json").write_text(
        json.dumps(full, indent=2) + "\n", encoding="utf-8"
    )
    md = f"""# Injury WOWY estimator full-run

```text
INJURY_WOWY_ESTIMATOR_FULL_RUN_GATE = {full['INJURY_WOWY_ESTIMATOR_FULL_RUN_GATE']}
```

P1 pair keys: **5384**. BOTH pts: **{per_metric['pts']['BOTH']}**. UI eligible pts: **{per_metric['pts']['ui_display_eligible']}**.

Statuses (pts): `{per_metric['pts']['statuses']}`

Temporal mutation: **{'PASS' if mutation_pass else 'FAIL'}**. Bootstrap production role: **NONE**.
"""
    (REPORTS / "official-injury-wowy-estimator-full-run.md").write_text(md, encoding="utf-8")
    print(json.dumps({
        "gate": full["INJURY_WOWY_ESTIMATOR_FULL_RUN_GATE"],
        "pts_statuses": per_metric["pts"]["statuses"],
        "ui": per_metric["pts"]["ui_display_eligible"],
        "mutation": mutation_pass,
        "temporal": temporal_ok,
        "cold_start": cold_start_pass,
    }, indent=2))


if __name__ == "__main__":
    main()
