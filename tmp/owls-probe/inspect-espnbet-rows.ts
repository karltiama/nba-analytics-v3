import { gunzipSync } from 'node:zlib';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { extractRows } from '../../lib/providers/owls-insight/client';
import { asRecord } from '../../lib/providers/owls-insight/normalize';

async function main() {
  const s3 = new S3Client({ region: 'us-east-1' });
  const key =
    'raw/source=owls_insight/league=nba/season=2024/entity=historical_player_props/game_date=2024-12-25/provider_game_id=nba:Philadelphia 76ers@Boston Celtics-20241225/page=0001.json.gz';
  const out = await s3.send(
    new GetObjectCommand({ Bucket: 'nba-analytics-data-260029269390', Key: key })
  );
  const env = JSON.parse(gunzipSync(Buffer.from(await out.Body!.transformToByteArray())).toString());
  const rows = extractRows(env.payload).map(asRecord).filter((x): x is Record<string, unknown> => x != null);
  const openingNull = rows.filter((r) => r.opening == null).length;
  const closingNull = rows.filter((r) => r.closing == null).length;
  const openingPartial = rows.filter((r) => {
    const o = asRecord(r.opening);
    return o && (o.line == null || o.overPrice == null || o.underPrice == null);
  }).length;
  const closingPartial = rows.filter((r) => {
    const o = asRecord(r.closing);
    return o && (o.line == null || o.overPrice == null || o.underPrice == null);
  }).length;
  console.log(
    JSON.stringify(
      {
        n: rows.length,
        keys: Object.keys(rows[0] ?? {}),
        openingNull,
        closingNull,
        openingPartial,
        closingPartial,
        sample: rows.slice(0, 4),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
