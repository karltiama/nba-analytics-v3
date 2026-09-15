"""
Isolated CatBoost inference for frozen PTS C / REB C shadow scoring.
Not imported by Next.js.

  python scripts/modeling/score_catboost_shadow.py --bundle reports/modeling/shadow-pts-reb-c-r1 --in features.jsonl --out predictions.jsonl
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from catboost import CatBoostRegressor


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", default="reports/modeling/shadow-pts-reb-c-r1")
    parser.add_argument("--in", dest="in_path", required=True)
    parser.add_argument("--out", dest="out_path", required=True)
    args = parser.parse_args()
    bundle = Path(args.bundle)
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    order = list(manifest["feature_order"])
    expected_pts = manifest["model_sha256"]["points"]
    expected_reb = manifest["model_sha256"]["rebounds"]
    pts_path = bundle / "c_points.cbm"
    reb_path = bundle / "c_rebounds.cbm"
    pts_hash = sha256_file(pts_path)
    reb_hash = sha256_file(reb_path)
    if pts_hash != expected_pts or reb_hash != expected_reb:
        raise SystemExit(
            f"artifact checksum mismatch: points {pts_hash} vs {expected_pts}; rebounds {reb_hash} vs {expected_reb}"
        )

    pts = CatBoostRegressor()
    pts.load_model(str(pts_path))
    reb = CatBoostRegressor()
    reb.load_model(str(reb_path))
    for model, label in ((pts, "points"), (reb, "rebounds")):
        names = list(model.feature_names_)
        prefixed = [f"features_c__{n}" for n in order]
        if names not in (order, prefixed):
            raise SystemExit(f"Feature ordering/artifact mismatch for {label}: {names}")

    rows_out = []
    with Path(args.in_path).open("r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            feats = row.get("features_c") or {}
            x = np.array([[feats.get(name) for name in order]], dtype=float)
            rows_out.append(
                {
                    "player_id": row.get("player_id"),
                    "game_id": row.get("game_id"),
                    "yhat_c_points": float(pts.predict(x)[0]),
                    "yhat_c_rebounds": float(reb.predict(x)[0]),
                }
            )
    Path(args.out_path).write_text(
        "".join(json.dumps(r) + "\n" for r in rows_out), encoding="utf-8"
    )
    print(f"scored {len(rows_out)} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
