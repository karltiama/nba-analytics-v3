/**
 * Summarize EV Track B (anchored) vs theoretical anchor cap: distribution, saturation, raw vs anchored.
 *
 *   npx tsx scripts/ev-b-sanity-check.ts
 *
 * Requires SUPABASE_DB_URL and the same DB as props-explorer.
 * `dotenv/config` must run before any module that reads `process.env` at load time (e.g. `lib/db`).
 */
import 'dotenv/config';

import { query } from '../lib/db';
import { getPlayerPropModelInputs, getStatsForPropType } from '../lib/betting/player-prop-inputs';
import {
  computePropEvFields,
  type PropEvRowInput,
  maxAbsEvAllowedByAnchorBand,
} from '../lib/betting/player-prop-ev-row';
import * as fs from 'fs';

const SAMPLE_LIMIT = 800;

interface Row {
  player_id: number;
  prop_type: string | null;
  market_type: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

async function main() {
  const rows = await query<Row>(`
    SELECT p.player_id, p.prop_type, p.market_type, p.side,
           p.line_value, p.odds_american, p.odds_decimal
    FROM analytics.player_props_current p
    WHERE p.market_type = 'over_under'
      AND (lower(p.side) = 'over' OR lower(p.side) = 'under')
      AND p.odds_decimal IS NOT NULL AND p.odds_decimal > 1
    ORDER BY p.snapshot_at DESC
    LIMIT $1
  `, [SAMPLE_LIMIT]);

  console.log(`Sample: ${rows.length} props (limit ${SAMPLE_LIMIT})`);

  const playerIds = [...new Set(rows.map((r) => r.player_id))];
  const inputsByPlayer = new Map<number, Awaited<ReturnType<typeof getPlayerPropModelInputs>>>();
  for (const pid of playerIds) {
    try {
      inputsByPlayer.set(pid, await getPlayerPropModelInputs(String(pid)));
    } catch {
      inputsByPlayer.set(pid, null);
    }
  }

  const evAnchored: number[] = [];
  const evRaw: number[] = [];
  const capRatios: number[] = [];
  let computed = 0;

  for (const r of rows) {
    const inputs = inputsByPlayer.get(r.player_id);
    if (!inputs) continue;
    const stats = getStatsForPropType(inputs, r.prop_type ?? '');
    if (!stats) continue;

    const propRow: PropEvRowInput = {
      prop_type: r.prop_type,
      market_type: r.market_type,
      side: r.side,
      line_value: r.line_value,
      odds_american: r.odds_american,
      odds_decimal: r.odds_decimal,
    };

    const evFields = computePropEvFields(propRow, inputs, 'trackB_calibrated');
    if (evFields.evTrackB == null || evFields.marketImpliedProbability == null) continue;
    const d = Number(r.odds_decimal);
    if (!Number.isFinite(d) || d <= 1) continue;

    computed++;
    const evB = evFields.evTrackB;
    const m = evFields.marketImpliedProbability;
    const cap = maxAbsEvAllowedByAnchorBand(m, d);
    const absEv = Math.abs(evB);
    evAnchored.push(evB);
    if (evFields.evTrackBRaw != null) evRaw.push(evFields.evTrackBRaw);
    if (cap > 1e-9) {
      capRatios.push(absEv / cap);
    }
  }

  const sortAsc = (a: number, b: number) => a - b;
  const evS = [...evAnchored].sort(sortAsc);
  const evRA = [...evRaw].sort(sortAsc);
  const absEvS = evAnchored.map(Math.abs).sort(sortAsc);

  const summary = {
    rowsFetched: rows.length,
    rowsComputed: computed,
    evTrackB_anchored: {
      min: evS.length ? evS[0] : null,
      p25: percentile(evS, 25),
      p50: percentile(evS, 50),
      p75: percentile(evS, 75),
      p90: percentile(evS, 90),
      p99: percentile(evS, 99),
      max: evS.length ? evS[evS.length - 1] : null,
      meanAbs: absEvS.length
        ? absEvS.reduce((a, b) => a + b, 0) / absEvS.length
        : null,
    },
    evTrackB_raw: {
      min: evRA.length ? evRA[0] : null,
      p50: percentile(evRA, 50),
      p90: percentile(evRA, 90),
      max: evRA.length ? evRA[evRA.length - 1] : null,
      meanAbs: evRaw.length
        ? evRaw.map(Math.abs).reduce((a, b) => a + b, 0) / evRaw.length
        : null,
    },
    anchorSaturation: {
      countNearCap: capRatios.filter((r) => r >= 0.95).length,
      capRatioSample: capRatios.length,
      meanCapRatio: capRatios.length
        ? capRatios.reduce((a, b) => a + b, 0) / capRatios.length
        : null,
    },
    interpretation: [
      'EV_B = anchored_p × decimalOdds − 1. Values are intentionally small vs raw when the anchor pulls p toward the market.',
      'Typical |EV_B| ceiling is about effectiveGap × decimalOdds (often ~8–17% at -110) unless m±gap hits 0 or 1.',
      'If most rows are near the cap, raise BASE_ANCHOR_BUDGET only if backtests justify more deviation from market.',
    ],
  };

  const outPath = 'ev-b-sanity.json';
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch(console.error);
