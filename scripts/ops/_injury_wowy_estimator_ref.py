"""
Phase 6D reference estimator math (fixture lock + certification).

Implements Phase 6C + 6C.1 amendment exactly. Not the production TS module;
used to lock golden expectations and run corpus certification.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Iterable, Literal, Sequence

METRICS = ("minutes", "pts", "reb", "ast", "tpm", "fga", "tpa", "fta")
Z_CRITICAL = 1.959963984540054
INTERVAL_LEVEL = 0.95
MIN_PRIOR_PAIRS = 20
MIN_POOLED_RESIDUAL_DF = 20
ESTIMATOR_VERSION = "injury-wowy-estimator-v1"
PAIR_POLICY_VERSION = "injury-wowy-pair-policy-v1"
ABS_TOL = 1e-10
REL_TOL = 1e-10

Cohort = Literal["P0", "P1", "P2", "P3"]
Mode = Literal["RESEARCH_FULL_HISTORY", "PRODUCTION_AS_OF"]
Status = Literal[
    "NO_HISTORY",
    "ONE_SIDED_HISTORY",
    "PRIOR_NOT_ESTIMABLE",
    "SPARSE_BOTH_STATES",
    "PAIR_ESTIMATE_AVAILABLE",
]


def nearly_equal(a: float, b: float, abs_tol: float = ABS_TOL, rel_tol: float = REL_TOL) -> bool:
    return math.isclose(a, b, abs_tol=abs_tol, rel_tol=rel_tol)


def sample_variance(values: Sequence[float]) -> float | None:
    n = len(values)
    if n < 2:
        return None
    mean = sum(values) / n
    sse = sum((x - mean) ** 2 for x in values)
    return sse / (n - 1)


@dataclass
class Obs:
    game_id: str
    game_start: str  # ISO UTC
    season: str
    team_id: str
    subject_player_entity_id: str
    focal_player_entity_id: str
    focal_state: Literal["PRE_GAME_AVAILABLE", "PRE_GAME_OUT"]
    metrics: dict[str, float]
    cohort_flags: dict[str, bool] = field(default_factory=dict)


def cohort_flag(obs: Obs, cohort: Cohort) -> bool:
    key = f"cohort_{cohort.lower()}"
    if key in obs.cohort_flags:
        return bool(obs.cohort_flags[key])
    # allow synthetic without flags when cohort forced by caller filter
    return True


def filter_observations(
    observations: Sequence[Obs],
    *,
    cohort: Cohort,
    mode: Mode,
    as_of: str | None,
) -> list[Obs]:
    out: list[Obs] = []
    for o in observations:
        if not cohort_flag(o, cohort):
            continue
        if mode == "PRODUCTION_AS_OF":
            if as_of is None:
                raise ValueError("PRODUCTION_AS_OF requires as_of")
            if not (o.game_start < as_of):
                continue
        out.append(o)
    return out


def pair_key(o: Obs) -> tuple[str, str, str, str]:
    return (o.season, o.team_id, o.subject_player_entity_id, o.focal_player_entity_id)


@dataclass
class CellStats:
    n: int
    mean: float
    sse: float
    sample_var: float | None  # None if n<2


def build_cells(obs: Sequence[Obs], metric: str) -> dict[tuple, CellStats]:
    buckets: dict[tuple, list[float]] = defaultdict(list)
    for o in obs:
        if metric not in o.metrics or o.metrics[metric] is None:
            continue
        key = (*pair_key(o), o.focal_state)
        buckets[key].append(float(o.metrics[metric]))
    cells: dict[tuple, CellStats] = {}
    for key, vals in buckets.items():
        n = len(vals)
        mean = sum(vals) / n
        sse = sum((x - mean) ** 2 for x in vals)
        sv = sse / (n - 1) if n >= 2 else None
        cells[key] = CellStats(n=n, mean=mean, sse=sse, sample_var=sv)
    return cells


def pooled_residual_variance(cells: dict[tuple, CellStats]) -> tuple[float | None, int]:
    sse_sum = 0.0
    df_sum = 0
    for c in cells.values():
        if c.n < 2:
            continue
        sse_sum += c.sse
        df_sum += c.n - 1
    if df_sum < MIN_POOLED_RESIDUAL_DF:
        return None, df_sum
    if df_sum <= 0:
        return None, df_sum
    sigma2 = sse_sum / df_sum
    if not math.isfinite(sigma2) or sigma2 <= 0:
        return None, df_sum
    return sigma2, df_sum


@dataclass
class PairState:
    n: int
    mean: float | None
    variance_used: float | None
    variance_source: str | None
    values_sum: float


@dataclass
class PairRaw:
    with_n: int
    without_n: int
    with_mean: float | None
    without_mean: float | None
    raw_delta: float | None
    with_variance_used: float | None
    without_variance_used: float | None
    with_variance_source: str | None
    without_variance_source: str | None
    sampling_variance: float | None


def state_from_cell(
    cell: CellStats | None, sigma2_pool: float | None
) -> PairState:
    if cell is None or cell.n == 0:
        return PairState(0, None, None, None, 0.0)
    if cell.n == 1:
        if sigma2_pool is None:
            return PairState(1, cell.mean, None, None, cell.mean)
        return PairState(1, cell.mean, sigma2_pool, "POOLED_SINGLETON_FALLBACK", cell.mean)
    assert cell.sample_var is not None
    if cell.sample_var > 0 and math.isfinite(cell.sample_var):
        return PairState(
            cell.n, cell.mean, cell.sample_var, "OBSERVED_SAMPLE_VARIANCE", cell.mean * cell.n
        )
    # zero or invalid observed variance
    if sigma2_pool is None:
        return PairState(cell.n, cell.mean, None, None, cell.mean * cell.n)
    return PairState(
        cell.n, cell.mean, sigma2_pool, "POOLED_ZERO_VARIANCE_FALLBACK", cell.mean * cell.n
    )


def pair_raw_from_cells(
    cells: dict[tuple, CellStats],
    key: tuple[str, str, str, str],
    sigma2_pool: float | None,
) -> PairRaw:
    avail = state_from_cell(cells.get((*key, "PRE_GAME_AVAILABLE")), sigma2_pool)
    out = state_from_cell(cells.get((*key, "PRE_GAME_OUT")), sigma2_pool)
    raw = None
    v = None
    if avail.n > 0 and out.n > 0 and avail.mean is not None and out.mean is not None:
        raw = out.mean - avail.mean
        if (
            avail.variance_used is not None
            and out.variance_used is not None
            and avail.variance_used > 0
            and out.variance_used > 0
        ):
            v = out.variance_used / out.n + avail.variance_used / avail.n
            if not math.isfinite(v) or v <= 0:
                v = None
    return PairRaw(
        with_n=avail.n,
        without_n=out.n,
        with_mean=avail.mean,
        without_mean=out.mean,
        raw_delta=raw,
        with_variance_used=avail.variance_used,
        without_variance_used=out.variance_used,
        with_variance_source=avail.variance_source,
        without_variance_source=out.variance_source,
        sampling_variance=v,
    )


@dataclass
class Prior:
    prior_pair_count: int
    pooled_residual_df: int
    sigma2_pool: float | None
    mu0: float | None
    tau2: float | None
    estimable: bool
    max_training_game_start: str | None = None


def estimate_prior(
    pairs: dict[tuple, PairRaw],
    sigma2_pool: float | None,
    pooled_df: int,
) -> Prior:
    if sigma2_pool is None or pooled_df < MIN_POOLED_RESIDUAL_DF:
        return Prior(0, pooled_df, sigma2_pool, None, None, False)
    ys: list[float] = []
    vs: list[float] = []
    for pr in pairs.values():
        if pr.with_n < 1 or pr.without_n < 1:
            continue
        if pr.raw_delta is None or pr.sampling_variance is None:
            continue
        if not math.isfinite(pr.raw_delta) or not math.isfinite(pr.sampling_variance):
            continue
        if pr.sampling_variance <= 0:
            continue
        ys.append(pr.raw_delta)
        vs.append(pr.sampling_variance)
    k = len(ys)
    if k < MIN_PRIOR_PAIRS:
        return Prior(k, pooled_df, sigma2_pool, None, None, False)
    w = [1.0 / v for v in vs]
    sw = sum(w)
    mu_fe = sum(wi * yi for wi, yi in zip(w, ys)) / sw
    Q = sum(wi * (yi - mu_fe) ** 2 for wi, yi in zip(w, ys))
    C = sw - sum(wi * wi for wi in w) / sw
    if not math.isfinite(C) or C <= 0:
        return Prior(k, pooled_df, sigma2_pool, None, None, False)
    tau2 = max(0.0, (Q - (k - 1)) / C)
    if not math.isfinite(tau2) or tau2 <= 0:
        return Prior(k, pooled_df, sigma2_pool, None, None, False)
    a = [1.0 / (vi + tau2) for vi in vs]
    sa = sum(a)
    mu0 = sum(ai * yi for ai, yi in zip(a, ys)) / sa
    if not math.isfinite(mu0):
        return Prior(k, pooled_df, sigma2_pool, None, None, False)
    return Prior(k, pooled_df, sigma2_pool, mu0, tau2, True)


def quality_tier(status: Status, with_n: int, without_n: int) -> str:
    if status in ("NO_HISTORY", "ONE_SIDED_HISTORY", "PRIOR_NOT_ESTIMABLE"):
        return "Q0"
    m = min(with_n, without_n)
    if m == 1:
        return "Q1"
    if m == 2:
        return "Q2"
    if m in (3, 4):
        return "Q3"
    return "Q4"


def estimate_pair(
    pr: PairRaw,
    prior: Prior,
    *,
    season: str,
    team_id: str,
    subject: str,
    focal: str,
    metric: str,
    cohort: Cohort,
    mode: Mode,
    as_of: str | None,
) -> dict[str, Any]:
    base: dict[str, Any] = {
        "estimator_version": ESTIMATOR_VERSION,
        "pair_policy_version": PAIR_POLICY_VERSION,
        "mode": mode,
        "as_of": as_of,
        "cohort_policy": cohort,
        "season": season,
        "team_id": team_id,
        "subject_player_entity_id": subject,
        "focal_player_entity_id": focal,
        "metric": metric,
        "with_n": pr.with_n,
        "without_n": pr.without_n,
        "with_mean": pr.with_mean,
        "without_mean": pr.without_mean,
        "raw_delta": pr.raw_delta,
        "with_variance_used": pr.with_variance_used,
        "without_variance_used": pr.without_variance_used,
        "with_variance_source": pr.with_variance_source,
        "without_variance_source": pr.without_variance_source,
        "sampling_variance": pr.sampling_variance,
        "prior_pair_count": prior.prior_pair_count,
        "pooled_residual_df": prior.pooled_residual_df,
        "pooled_residual_variance": prior.sigma2_pool,
        "prior_mean": prior.mu0,
        "prior_variance": prior.tau2,
        "data_weight": None,
        "prior_weight": None,
        "estimated_delta": None,
        "posterior_variance": None,
        "interval_level": INTERVAL_LEVEL,
        "interval_low": None,
        "interval_high": None,
        "sign_convention": "WITHOUT_MINUS_WITH",
    }

    if pr.with_n == 0 and pr.without_n == 0:
        status: Status = "NO_HISTORY"
    elif pr.with_n == 0 or pr.without_n == 0:
        status = "ONE_SIDED_HISTORY"
    elif not prior.estimable or pr.raw_delta is None or pr.sampling_variance is None:
        status = "PRIOR_NOT_ESTIMABLE"
    else:
        # EB
        y = pr.raw_delta
        v = pr.sampling_variance
        tau2 = prior.tau2
        mu0 = prior.mu0
        assert tau2 is not None and mu0 is not None
        data_w = tau2 / (tau2 + v)
        prior_w = v / (tau2 + v)
        est = data_w * y + prior_w * mu0
        post_v = (tau2 * v) / (tau2 + v)
        if (
            not math.isfinite(y)
            or not math.isfinite(v)
            or v <= 0
            or not math.isfinite(mu0)
            or not math.isfinite(tau2)
            or tau2 <= 0
            or not math.isfinite(data_w)
            or not (0 < data_w < 1)
            or not math.isfinite(post_v)
            or post_v <= 0
            or not math.isfinite(est)
        ):
            status = "PRIOR_NOT_ESTIMABLE"
        else:
            lo = est - Z_CRITICAL * math.sqrt(post_v)
            hi = est + Z_CRITICAL * math.sqrt(post_v)
            if not math.isfinite(lo) or not math.isfinite(hi):
                status = "PRIOR_NOT_ESTIMABLE"
            else:
                base.update(
                    {
                        "data_weight": data_w,
                        "prior_weight": prior_w,
                        "estimated_delta": est,
                        "posterior_variance": post_v,
                        "interval_low": lo,
                        "interval_high": hi,
                    }
                )
                if min(pr.with_n, pr.without_n) < 3:
                    status = "SPARSE_BOTH_STATES"
                else:
                    status = "PAIR_ESTIMATE_AVAILABLE"

    base["estimation_status"] = status
    base["quality_tier"] = quality_tier(status, pr.with_n, pr.without_n)
    base["ui_display_eligible"] = status == "PAIR_ESTIMATE_AVAILABLE"
    return base


def run_metric_window(
    observations: Sequence[Obs],
    *,
    metric: str,
    cohort: Cohort,
    mode: Mode,
    as_of: str | None,
) -> tuple[Prior, dict[tuple, PairRaw], dict[tuple, CellStats]]:
    filtered = filter_observations(observations, cohort=cohort, mode=mode, as_of=as_of)
    cells = build_cells(filtered, metric)
    sigma2, df = pooled_residual_variance(cells)
    keys = {(c[0], c[1], c[2], c[3]) for c in cells}
    pairs = {k: pair_raw_from_cells(cells, k, sigma2) for k in keys}
    prior = estimate_prior(pairs, sigma2, df)
    if filtered:
        prior.max_training_game_start = max(o.game_start for o in filtered)
    return prior, pairs, cells


def estimate_all_pairs(
    observations: Sequence[Obs],
    *,
    metric: str,
    cohort: Cohort,
    mode: Mode,
    as_of: str | None,
) -> list[dict[str, Any]]:
    prior, pairs, _ = run_metric_window(
        observations, metric=metric, cohort=cohort, mode=mode, as_of=as_of
    )
    results = []
    for key, pr in sorted(pairs.items()):
        results.append(
            estimate_pair(
                pr,
                prior,
                season=key[0],
                team_id=key[1],
                subject=key[2],
                focal=key[3],
                metric=metric,
                cohort=cohort,
                mode=mode,
                as_of=as_of,
            )
        )
    # also emit NO_HISTORY? only keys present in data — full-run should enumerate all keys from corpus
    return results
