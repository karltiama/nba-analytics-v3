#!/usr/bin/env python3
"""
Phase 18B — Apply MIN prospective schema + arm window (no backfill, no MAE).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOTENV = ROOT / ".env"
MIGRATION = ROOT / "db" / "schemas" / "MIGRATION_aux_min_prospective_shadow.sql"
ARTIFACT_DIR = ROOT / "lib" / "context-projection" / "artifacts"
REPORTS = ROOT / "reports" / "operations"

WINDOW_ID = "aux-min-role-avail-joint-v1-first750"
PTS_WINDOW = "prod-pts-context-v1-first500"
MODEL_SHA = "7354e0a8f9a8a15ade3c5f77e95b45b009661f49abfdcfea2c1e9edc3a4b1904"
PTS_SHA = "36f68abdab110ea13e78ac03d573aa3718b9ae7bb8b9bbd8a0d5983d83df478a"


def load_dotenv() -> None:
    if not DOTENV.exists():
        return
    for line in DOTENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main() -> None:
    load_dotenv()
    import psycopg

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sql = MIGRATION.read_text(encoding="utf-8")

    with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as conn:
        conn.execute(sql)
        conn.commit()

        # Schema gate
        for rel in (
            "analytics.prospective_min_shadow_predictions",
            "analytics.prospective_min_shadow_outcomes",
        ):
            row = conn.execute("SELECT to_regclass(%s) AS r", (rel,)).fetchone()
            if row is None or row[0] is None:
                raise SystemExit(f"AUX_MIN_SCHEMA_GATE_FAIL: missing {rel}")

        # Ensure PTS table still exists (apply frozen PTS migration if missing — do not alter semantics)
        pts = conn.execute(
            "SELECT to_regclass(%s) AS r", ("analytics.prospective_shadow_predictions",)
        ).fetchone()
        if pts is None or pts[0] is None:
            pts_sql = (
                ROOT / "db" / "schemas" / "MIGRATION_pts_production_context_prospective_shadow.sql"
            ).read_text(encoding="utf-8")
            conn.execute(pts_sql)
            conn.commit()
            pts = conn.execute(
                "SELECT to_regclass(%s) AS r", ("analytics.prospective_shadow_predictions",)
            ).fetchone()
        if pts is None or pts[0] is None:
            raise SystemExit("PTS_SHADOW_REGRESSION_FAIL: PTS table missing")

        # Genuine counts only — no backfill
        pregame_n = conn.execute(
            """
            SELECT COUNT(*)::int FROM analytics.prospective_min_shadow_predictions
             WHERE prospective_window_id = %s
               AND branch = 'ROLE_AVAIL_JOINT'
               AND pregame_eligibility_status = 'PRIMARY_ELIGIBLE'
            """,
            (WINDOW_ID,),
        ).fetchone()[0]

        finalized_n = conn.execute(
            """
            SELECT COUNT(*)::int
              FROM analytics.prospective_min_shadow_outcomes o
              JOIN analytics.prospective_min_shadow_predictions p
                ON p.shadow_prediction_id = o.shadow_prediction_id
             WHERE p.prospective_window_id = %s
               AND o.primary_scoring_eligible = true
               AND o.primary_sequence_number IS NOT NULL
               AND o.primary_sequence_number <= 750
            """,
            (WINDOW_ID,),
        ).fetchone()[0]

        played_n = conn.execute(
            """
            SELECT COUNT(*)::int
              FROM analytics.prospective_min_shadow_outcomes o
              JOIN analytics.prospective_min_shadow_predictions p
                ON p.shadow_prediction_id = o.shadow_prediction_id
             WHERE p.prospective_window_id = %s
               AND o.resolved_appearance_class = 'played'
               AND p.branch = 'ROLE_AVAIL_JOINT'
               AND p.pregame_eligibility_status = 'PRIMARY_ELIGIBLE'
            """,
            (WINDOW_ID,),
        ).fetchone()[0]

        dnp_n = conn.execute(
            """
            SELECT COUNT(*)::int
              FROM analytics.prospective_min_shadow_outcomes o
              JOIN analytics.prospective_min_shadow_predictions p
                ON p.shadow_prediction_id = o.shadow_prediction_id
             WHERE p.prospective_window_id = %s
               AND o.resolved_appearance_class = 'dnp'
            """,
            (WINDOW_ID,),
        ).fetchone()[0]

        unresolved_n = conn.execute(
            """
            SELECT COUNT(*)::int
              FROM analytics.prospective_min_shadow_predictions p
              LEFT JOIN analytics.prospective_min_shadow_outcomes o
                ON o.shadow_prediction_id = p.shadow_prediction_id
             WHERE p.prospective_window_id = %s
               AND p.branch = 'ROLE_AVAIL_JOINT'
               AND p.pregame_eligibility_status = 'PRIMARY_ELIGIBLE'
               AND (o.shadow_prediction_id IS NULL
                    OR o.resolved_appearance_class IN ('unresolved'))
            """,
            (WINDOW_ID,),
        ).fetchone()[0]

        pts_n = conn.execute(
            """
            SELECT COUNT(*)::int FROM analytics.prospective_shadow_predictions
             WHERE prospective_window_id = %s
               AND eligibility_status = 'PRIMARY_ELIGIBLE'
            """,
            (PTS_WINDOW,),
        ).fetchone()[0]

    # Verify frozen model artifact unchanged
    art = json.loads(
        (ARTIFACT_DIR / "aux-min-model_artifact.json").read_text(encoding="utf-8")
    )
    if art["model_artifact_sha"] != MODEL_SHA:
        raise SystemExit("AUX_MIN_MODEL_ARTIFACT_CHANGED")

    pts_art = json.loads(
        (ARTIFACT_DIR / "pts-production-context-prospective-window-v1.json").read_text(
            encoding="utf-8"
        )
    )
    if pts_art["model_artifact_sha"] != PTS_SHA:
        raise SystemExit("PTS_MODEL_CHANGED")
    if pts_art["PROSPECTIVE_REQUIRED_N"] != 500:
        raise SystemExit("PTS_REQUIRED_N_CHANGED")

    status = (
        "READY_FOR_PROSPECTIVE_COLLECTION"
        if pregame_n == 0
        else ("READY_FOR_READOUT" if finalized_n >= 750 else "COLLECTING")
    )

    payload = {
        "phase": "18B",
        "armed_at": now,
        "window_opened_at": now,
        "AUX_MIN_PROSPECTIVE_COLLECTION_IMPLEMENTED": "YES",
        "AUX_MIN_PROSPECTIVE_IMPLEMENTATION_GATE": "PASS",
        "AUX_MIN_SCHEMA_GATE": "PASS",
        "AUX_MIN_MODEL_ARTIFACT_FREEZE_GATE": "PASS",
        "AUX_MIN_MODEL_ARTIFACT_CHANGED": "NO",
        "PROSPECTIVE_MIN_WINDOW_ID": WINDOW_ID,
        "AUX_MIN_SHADOW_STORAGE": "analytics.prospective_min_shadow_predictions",
        "PROSPECTIVE_MIN_REQUIRED_N": 750,
        "PROSPECTIVE_MIN_PREGAME_N": pregame_n,
        "PROSPECTIVE_MIN_FINALIZED_PRIMARY_N": finalized_n,
        "RESOLVED_PLAYED_N": played_n,
        "RESOLVED_DNP_N": dnp_n,
        "UNRESOLVED_N": unresolved_n,
        "PROSPECTIVE_MIN_STATUS": status,
        "AUXILIARY_MIN_SHADOW_STATUS": status,
        "MIN_PRODUCTION_PATH": "DEFER_PROPS_EXPLORER",
        "activation_mechanism": (
            "Schema applied via MIGRATION_aux_min_prospective_shadow.sql; "
            "collection armed via scripts/ops/arm-aux-min-prospective-collection.py; "
            "records built by lib/context-projection/min/arm.ts buildProspectiveMinShadowRecord; "
            "persisted by insertProspectiveMinShadowPrediction; "
            "outcomes via resolveMinOutcomeAndRecompute; "
            "NOT wired into Props Explorer request path."
        ),
        "model_id": "aux-min-context-role-avail-joint-v1",
        "model_artifact_sha": MODEL_SHA,
        "feature_manifest_sha": art["feature_manifest_sha"],
        "training_manifest_sha": art["training_manifest_sha"],
        "MIN_CANONICAL_SNAPSHOT_POLICY": "LATEST_ELIGIBLE_AT_OR_BEFORE_T_MINUS_60",
        "PTS_MODEL_SHA": PTS_SHA,
        "PTS_CURRENT_N": pts_n,
        "PTS_REQUIRED_N": 500,
        "PTS_WINDOW": PTS_WINDOW,
        "PTS_MODEL_CHANGED": "NO",
        "PTS_WINDOW_CHANGED": "NO",
        "PTS_PROSPECTIVE_WINDOW_ISOLATION": "PASS",
        "NEXT": (
            "START_AUXILIARY_MIN_PROSPECTIVE_COLLECTION"
            if status == "READY_FOR_PROSPECTIVE_COLLECTION"
            else (
                "CERTIFY_AUXILIARY_MIN_PROSPECTIVE_VALIDATION"
                if status == "READY_FOR_READOUT"
                else "CONTINUE_AUXILIARY_MIN_PROSPECTIVE_COLLECTION"
            )
        ),
        "PTS_NEXT": "CONTINUE_PROSPECTIVE_PTS_SHADOW_COLLECTION",
    }

    REPORTS.mkdir(parents=True, exist_ok=True)
    out = REPORTS / "auxiliary-min-prospective-arm-status.json"
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    (ARTIFACT_DIR / "auxiliary-min-prospective-arm-status.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
