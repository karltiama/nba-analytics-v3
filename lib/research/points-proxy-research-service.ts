import { S3Client } from '@aws-sdk/client-s3';

import { fetchBdlPlayerNamesByIds, getBalldontlieApiKeyFromEnv } from '@/lib/balldontlie/bdl-player-names-from-api';

import { S3Storage } from '@/lib/aws/s3';

import { normalizePlayerIdForLookup } from '@/lib/research/player-display-name-lookup-builder';

import {

  mergePlayerDisplayNameMaps,

  parsePlayerIdDisplayNameLookupJson,

  playerIdDisplayNameLookupS3Keys,

} from '@/lib/research/player-id-display-name-lookup';

import {

  breakdownResultsS3Key,

  buildPointsProxyLabViewModel,

  comparisonResultsS3Key,

  DEFAULT_POINTS_PROXY_SEASONS_TAG,

  parseBreakdownResultsJson,

  parseComparisonResultsJson,

  type ParsedBreakdownPayload,

  type PointsProxyLabViewModel,

} from '@/lib/research/points-proxy-research-view-model';



export type LoadPointsProxyLabResult =

  | { ok: true; viewModel: PointsProxyLabViewModel; bucket: string }

  | { ok: false; code: 'NOT_CONFIGURED'; message: string };



function getS3(): S3Storage | null {

  const bucket = process.env.NBA_DATA_BUCKET?.trim();

  if (!bucket) return null;

  const region = process.env.AWS_REGION?.trim() || 'us-east-1';

  return new S3Storage({ bucket, client: new S3Client({ region }) });

}



function safeJsonParse(text: string): unknown {

  try {

    return JSON.parse(text) as unknown;

  } catch {

    return null;

  }

}



/** Parse S3 lookup body; unwrap accidental double-JSON encoding. */

function parseLookupPayloadText(text: string): unknown {

  let v: unknown = safeJsonParse(text);

  if (typeof v === 'string') {

    const inner = safeJsonParse(v);

    if (inner != null) v = inner;

  }

  return v;

}



function collectTopPlayerIdsFromBreakdown(breakdown: ParsedBreakdownPayload, perStrategy: number): string[] {

  const out = new Set<string>();

  for (const b of breakdown.strategies_breakdown) {

    const sorted = [...b.player_frequency].sort((a, c) => c.signal_count - a.signal_count).slice(0, perStrategy);

    for (const p of sorted) {

      const id = normalizePlayerIdForLookup(p.player_id);

      if (id) out.add(id);

    }

  }

  return [...out];

}



/**

 * Read-only load of multi-season comparison + breakdown JSON from the data lake.

 * Does not recompute strategies.

 */

export async function loadPointsProxyResearchLab(args?: {

  seasonsTag?: string;

}): Promise<LoadPointsProxyLabResult> {

  const seasonsTag = args?.seasonsTag?.trim() || DEFAULT_POINTS_PROXY_SEASONS_TAG;

  const s3 = getS3();

  if (!s3) {

    return {

      ok: false,

      code: 'NOT_CONFIGURED',

      message:

        'NBA_DATA_BUCKET is not set. Configure the bucket on the server to load research artifacts from S3.',

    };

  }



  const cKey = comparisonResultsS3Key(seasonsTag);

  const bKey = breakdownResultsS3Key(seasonsTag);

  const cText = await s3.getText(cKey);

  const bText = await s3.getText(bKey);



  const comparison = cText != null ? parseComparisonResultsJson(safeJsonParse(cText)) : null;

  const breakdown = bText != null ? parseBreakdownResultsJson(safeJsonParse(bText)) : null;



  const lookupKeys = [...playerIdDisplayNameLookupS3Keys(seasonsTag)];

  let s3LookupFilesFound = 0;

  let playerDisplayNameById = new Map<string, string>();

  try {

    const lookupMaps: Map<string, string>[] = [];

    for (const key of lookupKeys) {

      const lt = await s3.getText(key);

      if (lt == null) continue;

      s3LookupFilesFound += 1;

      const parsed = parseLookupPayloadText(lt);

      lookupMaps.push(parsePlayerIdDisplayNameLookupJson(parsed));

    }

    playerDisplayNameById = mergePlayerDisplayNameMaps(lookupMaps);

  } catch {

    playerDisplayNameById = new Map();

  }



  const s3EntryCount = playerDisplayNameById.size;

  let bdlFilledCount = 0;



  const bdlKey = getBalldontlieApiKeyFromEnv();

  if (breakdown && bdlKey) {

    const candidates = collectTopPlayerIdsFromBreakdown(breakdown, 30);

    const missing = candidates.filter((id) => !playerDisplayNameById.has(id));

    if (missing.length > 0) {

      const bdlMap = await fetchBdlPlayerNamesByIds({ playerIds: missing, apiKey: bdlKey, maxIds: 100 });

      for (const [k, v] of bdlMap) {

        if (!playerDisplayNameById.has(k)) {

          playerDisplayNameById.set(k, v);

          bdlFilledCount += 1;

        }

      }

    }

  }



  const viewModel = buildPointsProxyLabViewModel({

    seasonsTag,

    comparison,

    breakdown,

    playerDisplayNameById,

    playerDisplayNameLookupMeta: {

      s3_lookup_keys_tried: lookupKeys,

      s3_lookup_files_found: s3LookupFilesFound,

      s3_lookup_entry_count: s3EntryCount,

      bdl_filled_count: bdlFilledCount,

    },

  });



  return { ok: true, viewModel, bucket: s3.bucket };

}


