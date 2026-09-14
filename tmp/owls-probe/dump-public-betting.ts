import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { gunzipJson } from '@/lib/providers/owls-insight/archive';
import { OwlsS3Store } from '@/lib/providers/owls-insight/s3-store';

const KEYS = [
  'raw/source=owls_insight/league=nba/season=2023/entity=historical_public_betting/game_date=2023-12-25/provider_game_id=nba:Boston_Celtics@Los_Angeles_Lakers-20231225/page=0001.json.gz',
  'raw/source=owls_insight/league=nba/season=2024/entity=historical_public_betting/game_date=2024-12-25/provider_game_id=nba:Philadelphia_76ers@Boston_Celtics-20241225/page=0001.json.gz',
  'raw/source=owls_insight/league=nba/season=2025/entity=historical_public_betting/game_date=2025-10-21/provider_game_id=nba:Houston_Rockets@Oklahoma_City_Thunder-20251021/page=0001.json.gz',
];

function sketch(v: unknown, depth = 0): unknown {
  if (v == null) return v;
  if (Array.isArray(v)) {
    return {
      _type: 'array',
      length: v.length,
      first: depth < 5 ? sketch(v[0], depth + 1) : '...',
    };
  }
  if (typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      o[k] = depth >= 6 ? typeof val : sketch(val, depth + 1);
    }
    return o;
  }
  return v;
}

async function main() {
  const store = new OwlsS3Store(process.env.NBA_DATA_BUCKET?.trim() || '');
  const dumps = [];
  for (const key of KEYS) {
    const obj = await store.get(key);
    if (!obj) throw new Error(`missing ${key}`);
    const env = gunzipJson<Record<string, unknown>>(obj.body);
    dumps.push({
      key,
      row_count: env.row_count,
      request: env.request,
      payload: env.payload,
      payloadSketch: sketch(env.payload),
    });
  }
  await writeFile('tmp/owls-probe/history-public-betting-live-payloads.json', `${JSON.stringify(dumps, null, 2)}\n`);
  console.log(JSON.stringify(dumps.map((d) => ({ key: d.key, row_count: d.row_count, payloadSketch: d.payloadSketch })), null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
