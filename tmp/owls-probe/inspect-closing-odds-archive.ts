import 'dotenv/config';
import { gunzipSync } from 'node:zlib';
import { OwlsS3Store } from '../../lib/providers/owls-insight/s3-store';
import type { OwlsArchiveEnvelope } from '../../lib/providers/owls-insight/types';

const keys = [
  'raw/source=owls_insight/league=nba/season=2023/entity=historical_closing_odds/game_date=2023-12-25/provider_game_id=nba:Boston_Celtics@Los_Angeles_Lakers-20231225/page=0001.json.gz',
  'raw/source=owls_insight/league=nba/season=2024/entity=historical_closing_odds/game_date=2024-12-25/provider_game_id=nba:Philadelphia_76ers@Boston_Celtics-20241225/page=0001.json.gz',
  'raw/source=owls_insight/league=nba/season=2025/entity=historical_closing_odds/game_date=2025-10-21/provider_game_id=nba:Houston_Rockets@Oklahoma_City_Thunder-20251021/page=0001.json.gz',
];

async function main() {
  const store = new OwlsS3Store(process.env.NBA_DATA_BUCKET?.trim() || '');
  for (const key of keys) {
    const obj = await store.get(key);
    if (!obj) {
      console.log({ key, missing: true });
      continue;
    }
    const env = JSON.parse(gunzipSync(obj.body).toString('utf8')) as OwlsArchiveEnvelope;
    const payload = env.payload as {
      success?: boolean;
      data?: { odds?: unknown[]; pagination?: unknown; dataQuality?: unknown };
    };
    console.log(
      JSON.stringify(
        {
          key,
          checksum: env.checksum,
          row_count: env.row_count,
          schema: env.schema,
          request: env.request,
          dataQuality: payload.data?.dataQuality ?? null,
          odds: payload.data?.odds ?? null,
          pagination: payload.data?.pagination ?? null,
        },
        null,
        2
      )
    );
  }
}

main();
