"""Build READ-ONLY game-start manifest for pair-corpus game_ids (Phase 6D M8)."""
from __future__ import annotations

import gzip
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp" / "official-injury-wowy-estimator"
PAIR_DIR = ROOT / "tmp" / "official-injury-wowy-pairs"


def load_dotenv() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main() -> None:
    load_dotenv()
    import psycopg

    game_ids: set[str] = set()
    for name in ("p0", "p1", "p2", "p3"):
        path = PAIR_DIR / f"{name}.ndjson.gz"
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                game_ids.add(json.loads(line)["game_id"])

    ids = sorted(game_ids, key=lambda x: (len(x), x))
    url = os.environ["SUPABASE_DB_URL"]
    rows: list[dict] = []
    with psycopg.connect(url) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT game_id::text, start_time AT TIME ZONE 'UTC'
                FROM analytics.games
                WHERE game_id = ANY(%s)
                ORDER BY game_id::text
                """,
                (ids,),
            )
            for gid, st in cur.fetchall():
                if st is None:
                    raise SystemExit(f"null start_time for game_id={gid}")
                iso = st.isoformat().replace("+00:00", "Z")
                if iso.endswith("Z") is False and "+" not in iso and iso.count("-") >= 3:
                    # ensure Z suffix for UTC
                    iso = iso + "Z" if not iso.endswith("Z") else iso
                rows.append({"game_id": str(gid), "start_time_utc": iso})
        conn.execute("COMMIT")

    # normalize ISO to always end with Z
    for r in rows:
        st = r["start_time_utc"]
        if st.endswith("+00:00"):
            r["start_time_utc"] = st[:-6] + "Z"
        elif not st.endswith("Z"):
            # psycopg may return naive UTC
            r["start_time_utc"] = st + ("Z" if "T" in st else "")

    by_id = {r["game_id"]: r for r in rows}
    missing = [g for g in ids if g not in by_id]
    if missing:
        raise SystemExit(f"missing start_time for {len(missing)} games e.g. {missing[:5]}")
    if len(by_id) != len(rows):
        raise SystemExit("duplicate game_id in query result")

    ordered = [by_id[g] for g in ids]
    OUT.mkdir(parents=True, exist_ok=True)
    out_path = OUT / "game-start-manifest.ndjson.gz"
    payload = "".join(json.dumps(r, separators=(",", ":")) + "\n" for r in ordered)
    raw = payload.encode("utf-8")
    with gzip.open(out_path, "wb") as gz:
        gz.write(raw)

    # also uncompressed for easy sha of content
    plain = OUT / "game-start-manifest.ndjson"
    plain.write_text(payload, encoding="utf-8")
    sha = hashlib.sha256(raw).hexdigest()
    meta = {
        "row_count": len(ordered),
        "sha256_ndjson_bytes": sha,
        "null_count": 0,
        "duplicate_count": 0,
        "missing_count": 0,
        "path_gz": str(out_path.relative_to(ROOT)).replace("\\", "/"),
        "path_ndjson": str(plain.relative_to(ROOT)).replace("\\", "/"),
    }
    (OUT / "game-start-manifest.meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
