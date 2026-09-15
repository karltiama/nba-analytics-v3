"""
AWS Lambda handler for frozen PTS C / REB C CatBoost scoring.
Downloads checksummed artifacts from S3 on cold start. Does not retrain.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np
from catboost import CatBoostRegressor

TMP = Path("/tmp/shadow-bundle")
_MODELS = None


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _download(bucket: str, prefix: str) -> Path:
    import boto3

    TMP.mkdir(parents=True, exist_ok=True)
    s3 = boto3.client("s3")
    for name in ("manifest.json", "c_points.cbm", "c_rebounds.cbm"):
        dest = TMP / name
        s3.download_file(bucket, f"{prefix}/{name}", str(dest))
    return TMP


def load_models(bucket: str | None, prefix: str | None):
    global _MODELS
    if _MODELS is not None:
        return _MODELS
    bundle = Path(os.environ.get("SHADOW_BUNDLE_DIR", str(TMP)))
    if bucket and prefix:
        bundle = _download(bucket, prefix)
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    order = list(manifest["feature_order"])
    pts_path = bundle / "c_points.cbm"
    reb_path = bundle / "c_rebounds.cbm"
    pts_hash = sha256_bytes(pts_path.read_bytes())
    reb_hash = sha256_bytes(reb_path.read_bytes())
    if pts_hash != manifest["model_sha256"]["points"] or reb_hash != manifest["model_sha256"]["rebounds"]:
        raise RuntimeError("artifact checksum mismatch")
    pts = CatBoostRegressor()
    pts.load_model(str(pts_path))
    reb = CatBoostRegressor()
    reb.load_model(str(reb_path))
    _MODELS = {"order": order, "pts": pts, "reb": reb}
    return _MODELS


def handler(event, _context=None):
    rows = event.get("rows") or []
    models = load_models(event.get("bucket"), event.get("prefix"))
    order = models["order"]
    out = []
    for row in rows:
        feats = row.get("features_c") or {}
        x = np.array([[feats.get(name) for name in order]], dtype=float)
        out.append(
            {
                "player_id": row.get("player_id"),
                "game_id": row.get("game_id"),
                "yhat_c_points": float(models["pts"].predict(x)[0]),
                "yhat_c_rebounds": float(models["reb"].predict(x)[0]),
            }
        )
    return {"predictions": out}
