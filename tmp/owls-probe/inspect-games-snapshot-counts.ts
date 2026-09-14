import 'dotenv/config';
import { gunzipSync } from 'node:zlib';
import { OwlsS3Store } from '../../lib/providers/owls-insight/s3-store';
import { extractRows } from '../../lib/providers/owls-insight/client';
import { asRecord } from '../../lib/providers/owls-insight/normalize';

async function main() {
  const s3 = new OwlsS3Store(process.env.NBA_DATA_BUCKET?.trim() || '');
  const keys = [
    'raw/source=owls_insight/league=nba/season=2023/entity=historical_games/game_date=2024-01-16/provider_game_id=cc-1038155/page=0001.json.gz',
    'raw/source=owls_insight/league=nba/season=2023/entity=historical_games/game_date=2023-12-25/provider_game_id=cc-1037995/page=0001.json.gz',
    'raw/source=owls_insight/league=nba/season=2024/entity=historical_games/game_date=2025-01-11/provider_game_id=cc-15907966/page=0001.json.gz',
    'raw/source=owls_insight/league=nba/season=2025/entity=historical_games/game_date=2025-12-25/provider_game_id=cc-18447233/page=0001.json.gz',
  ];
  for (const key of keys) {
    const obj = await s3.get(key);
    if (!obj) {
      console.log({ key, missing: true });
      continue;
    }
    const env = JSON.parse(gunzipSync(obj.body).toString());
    const rows = extractRows(env.payload).map(asRecord).filter(Boolean) as Record<string, unknown>[];
    console.log(
      JSON.stringify(
        {
          key,
          n: rows.length,
          keys: rows[0] ? Object.keys(rows[0]) : [],
          sample: rows.slice(0, 3).map((r) => ({
            eventId: r.eventId,
            gameDate: r.gameDate,
            propsSnapshots: r.propsSnapshots,
            propSnapshots: r.propSnapshots,
            oddsSnapshots: r.oddsSnapshots,
            numeric: Object.fromEntries(
              Object.entries(r).filter(([, v]) => typeof v === 'number')
            ),
          })),
        },
        null,
        2
      )
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
