"""
Isolated CatBoost training for Court Context learned projection r1.

Not imported by Next.js. Do not put CatBoost on the request path.

  python -m pip install -r scripts/modeling/requirements-modeling.txt
  python scripts/modeling/train_catboost_projection.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from catboost import CatBoostRegressor

SEED = 20260914
TARGETS = {
    "points": "actual_pts",
    "rebounds": "actual_reb",
    "assists": "actual_ast",
    "threes": "actual_threes",
}

# Equal budget: six predefined configs for C and for D.
CONFIGS = [
    {"depth": 4, "learning_rate": 0.08, "l2_leaf_reg": 3.0, "iterations": 500},
    {"depth": 6, "learning_rate": 0.08, "l2_leaf_reg": 3.0, "iterations": 500},
    {"depth": 8, "learning_rate": 0.08, "l2_leaf_reg": 3.0, "iterations": 500},
    {"depth": 6, "learning_rate": 0.03, "l2_leaf_reg": 3.0, "iterations": 800},
    {"depth": 6, "learning_rate": 0.08, "l2_leaf_reg": 1.0, "iterations": 500},
    {"depth": 6, "learning_rate": 0.08, "l2_leaf_reg": 10.0, "iterations": 500},
]


def mae(y: np.ndarray, p: np.ndarray) -> float:
    mask = np.isfinite(y) & np.isfinite(p)
    if mask.sum() == 0:
        return float("nan")
    return float(np.mean(np.abs(y[mask] - p[mask])))


def load_rows(path: Path) -> pd.DataFrame:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return pd.DataFrame(rows)


def expand_features(df: pd.DataFrame, col: str, allowlist: list[str]) -> pd.DataFrame:
    feats = pd.json_normalize(df[col]).reindex(columns=allowlist)
    feats.columns = [f"{col}__{c}" for c in feats.columns]
    return feats


def fit_select(
    x_train: pd.DataFrame,
    y_train: np.ndarray,
    x_val: pd.DataFrame,
    y_val: np.ndarray,
    artifact_dir: Path,
    tag: str,
) -> tuple[dict, CatBoostRegressor]:
    best = None
    best_model: CatBoostRegressor | None = None
    trials = []
    train_mask = np.isfinite(y_train)
    val_mask = np.isfinite(y_val)
    x_train = x_train.reset_index(drop=True)
    x_val = x_val.reset_index(drop=True)
    x_tr = x_train.iloc[train_mask]
    y_tr = y_train[train_mask]
    x_va = x_val.iloc[val_mask]
    y_va = y_val[val_mask]
    for i, cfg in enumerate(CONFIGS):
        model = CatBoostRegressor(
            loss_function="RMSE",
            random_seed=SEED,
            verbose=False,
            allow_writing_files=False,
            early_stopping_rounds=40,
            **cfg,
        )
        model.fit(x_tr, y_tr, eval_set=(x_va, y_va), use_best_model=True)
        pred_val = model.predict(x_va)
        score = mae(y_va, pred_val)
        used_iter = int(model.get_best_iteration() or cfg["iterations"])
        trial = {
            "config_id": i,
            "config": cfg,
            "val_mae": score,
            "best_iteration": used_iter,
            "tree_count": int(model.tree_count_),
        }
        trials.append(trial)
        if best is None or score < best["val_mae"]:
            model_path = artifact_dir / f"{tag}.cbm"
            model.save_model(str(model_path))
            best = {**trial, "model_path": str(model_path).replace("\\", "/")}
            best_model = model
    if best is None or best_model is None:
        raise RuntimeError(f"No model selected for {tag}")
    return {"selected": best, "trials": trials}, best_model


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in-dir", default="reports/modeling/learned-r1")
    args = parser.parse_args()
    in_dir = Path(args.in_dir)
    rows_path = in_dir / "rows.jsonl"
    spec_path = in_dir / "feature_spec.json"
    recon_path = in_dir / "reconciliation.json"
    if not rows_path.exists():
        print(f"missing {rows_path}; run export first", file=sys.stderr)
        return 1

    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    recon = json.loads(recon_path.read_text(encoding="utf-8"))
    allow_c = list(spec["feature_c_allowlist"])
    allow_d = list(spec["feature_d_allowlist"])
    extra = [name for name in allow_d if name not in set(allow_c)]
    df = load_rows(rows_path)
    df = df[df["common_eligible"] == True].copy()  # noqa: E712
    df = df[df["split"].isin(["train", "validation", "test"])].copy()

    feat_c = expand_features(df, "features_c", allow_c)
    feat_d_extra = expand_features(df, "features_d_extra", extra)
    feat_d_extra.columns = [c.replace("features_d_extra__", "features_d__") for c in feat_d_extra.columns]
    feat_c_for_d = feat_c.copy()
    feat_c_for_d.columns = [c.replace("features_c__", "features_d__") for c in feat_c_for_d.columns]
    feat_d = pd.concat([feat_c_for_d, feat_d_extra], axis=1)
    base = df.reset_index(drop=True)
    feat_c = feat_c.reset_index(drop=True).apply(pd.to_numeric, errors="coerce")
    feat_d = feat_d.reset_index(drop=True).apply(pd.to_numeric, errors="coerce")

    train_idx = (base["split"] == "train").to_numpy()
    val_idx = (base["split"] == "validation").to_numpy()

    artifact_dir = in_dir / "artifacts"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    selection: dict = {
        "seed": SEED,
        "loss": "RMSE",
        "early_stopping_rounds": 40,
        "n_configs_per_target_and_set": len(CONFIGS),
        "dataset_sha256": recon.get("dataset_sha256"),
        "feature_spec_version": spec.get("feature_spec_version"),
        "catboost_version": __import__("catboost").__version__,
        "pandas_version": pd.__version__,
        "numpy_version": np.__version__,
        "note": "2024 validation only for early stopping and selection. 2025 was not used to pick configs.",
        "models": {},
    }

    preds = {
        "player_id": base["player_id"],
        "game_id": base["game_id"],
        "split": base["split"],
        "basketball_date": base["basketball_date"],
    }

    for target, label_col in TARGETS.items():
        y = pd.to_numeric(base[label_col], errors="coerce").to_numpy(dtype=float)
        for set_name in ("c", "d"):
            x = feat_c if set_name == "c" else feat_d
            tag = f"{set_name}_{target}"
            print(f"training {tag} ...", flush=True)
            result, model = fit_select(
                x.iloc[train_idx],
                y[train_idx],
                x.iloc[val_idx],
                y[val_idx],
                artifact_dir,
                tag,
            )
            selection["models"][tag] = result
            preds[f"yhat_{set_name}_{target}"] = model.predict(x)

    pred_df = pd.DataFrame(preds)
    pred_path = in_dir / "predictions.jsonl"
    pred_df.to_json(pred_path, orient="records", lines=True)
    selection_path = in_dir / "selection.json"
    selection_path.write_text(json.dumps(selection, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {pred_path}")
    print(f"wrote {selection_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
