/**
 * Local operator retest for STEP 14P.X2C.4.
 * Temporarily enables extraction in THIS PROCESS ONLY.
 * Does not change .env / production kill switch.
 *
 * Hard cap: 3 unique provider attempts. No retries. Replay is cache-only.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { loadXrayExtractionConfig } from '@/lib/parlay-xray/extraction/config';
import { resolveLegMarket } from '@/lib/parlay-xray/extraction/market-identity';
import { runXrayExtraction } from '@/lib/parlay-xray/extraction/pipeline';
import { createPostgresXrayStore } from '@/lib/parlay-xray/extraction/postgres-store';
import { fetchXrayVisionFromOpenAi, type XrayVisionProvider } from '@/lib/parlay-xray/extraction/provider';
import type { XrayVisionOutput } from '@/lib/parlay-xray/extraction/schema';
import type { ExtractedParlayLeg, XrayField, XrayPropKind } from '@/lib/parlay-xray/types';

const MAX_UNIQUE = 3;
const RETEST_USER = 'xray-retest-x2c4-operator';
const OUT_DIR = join(process.env.TEMP || '/tmp', 'parlay-xray-x2c4');

type ExpectedLeg = {
  player: string;
  market: XrayPropKind;
  side: 'over' | 'under';
  line: number;
  odds: number | null;
  sportsbook: string | null;
  matchup: string | null;
};

type CaseSpec = {
  id: 'R1' | 'R2' | 'R3';
  file: string;
  notes: string;
  expectedLegs: ExpectedLeg[];
};

/** Ground truth locked BEFORE any provider call. */
const CASES: CaseSpec[] = [
  {
    id: 'R1',
    file: 'R1-giannis-points-rebounds.png',
    notes: 'Prior A2 failure class: same-player Points + Rebounds',
    expectedLegs: [
      { player: 'Giannis Antetokounmpo', market: 'points', side: 'over', line: 27.5, odds: -113, sportsbook: 'FanDuel', matchup: 'MIL vs MIA' },
      { player: 'Giannis Antetokounmpo', market: 'rebounds', side: 'over', line: 8.5, odds: -132, sportsbook: 'FanDuel', matchup: 'MIL vs MIA' },
      { player: 'Bam Adebayo', market: 'rebounds', side: 'over', line: 5.5, odds: -110, sportsbook: 'FanDuel', matchup: 'MIA vs MIL' },
    ],
  },
  {
    id: 'R2',
    file: 'R2-giannis-rebounds-assists.png',
    notes: 'Same-player Rebounds + Assists',
    expectedLegs: [
      { player: 'Giannis Antetokounmpo', market: 'rebounds', side: 'over', line: 8.5, odds: -132, sportsbook: 'FanDuel', matchup: 'MIL vs MIA' },
      { player: 'Giannis Antetokounmpo', market: 'assists', side: 'over', line: 6.5, odds: -110, sportsbook: 'FanDuel', matchup: 'MIL vs MIA' },
      { player: 'Bam Adebayo', market: 'rebounds', side: 'over', line: 5.5, odds: -110, sportsbook: 'FanDuel', matchup: 'MIA vs MIL' },
    ],
  },
  {
    id: 'R3',
    file: 'R3-clean-points-control.png',
    notes: 'Clean 4-leg points control',
    expectedLegs: [
      { player: 'Nikola Jokic', market: 'points', side: 'over', line: 27.5, odds: -103, sportsbook: 'DraftKings', matchup: 'DEN vs OKC' },
      { player: 'Shai Gilgeous-Alexander', market: 'points', side: 'over', line: 32.5, odds: -109, sportsbook: 'DraftKings', matchup: 'OKC vs DEN' },
      { player: 'Jalen Brunson', market: 'points', side: 'over', line: 27.5, odds: -109, sportsbook: 'DraftKings', matchup: 'NYK vs CLE' },
      { player: 'Donovan Mitchell', market: 'points', side: 'over', line: 25.5, odds: -119, sportsbook: 'DraftKings', matchup: 'CLE vs NYK' },
    ],
  },
];

function loadLocalEnv(): void {
  for (const file of ['.env.local', '.env']) {
    let text = '';
    try {
      text = readFileSync(join(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const eq = line.indexOf('=');
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (process.env[key] == null || process.env[key] === '') process.env[key] = value;
    }
  }
}

function mimeOf(file: string): string {
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  if (file.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

function fieldVal<T>(field: XrayField<T> | undefined): T | null {
  return field?.value ?? null;
}

function fieldStatus<T>(field: XrayField<T> | undefined): string {
  return field?.status ?? 'unknown';
}

function normName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(expected: string, got: string | null): boolean {
  const e = normName(expected);
  const g = normName(got);
  if (!g) return false;
  if (e === g) return true;
  if (g.includes(e) || e.includes(g)) return true;
  const eLast = e.split(' ').pop();
  const gLast = g.split(' ').pop();
  if (eLast && gLast && eLast.length > 3 && eLast === gLast) return true;
  if (e.includes('antetokounmpo') && (g.includes('antetokounmpo') || g.includes('giannis'))) return true;
  if (e.includes('gilgeous') && g.includes('gilgeous')) return true;
  return false;
}

type MarketClass =
  | 'CORRECT_KNOWN'
  | 'CORRECT_NEEDS_CONFIRMATION'
  | 'APPROPRIATELY_UNKNOWN'
  | 'WRONG_KNOWN'
  | 'WRONG_NEEDS_CONFIRMATION'
  | 'HALLUCINATED'
  | 'MISSING';

function classifyMarket(expected: XrayPropKind, mappedKind: XrayPropKind | null, mappedStatus: string): MarketClass {
  if (!mappedKind || mappedStatus === 'unknown') return 'APPROPRIATELY_UNKNOWN';
  if (mappedKind === expected && mappedStatus === 'known') return 'CORRECT_KNOWN';
  if (mappedKind === expected && mappedStatus === 'needs_confirmation') return 'CORRECT_NEEDS_CONFIRMATION';
  if (mappedKind !== expected && mappedStatus === 'known') return 'WRONG_KNOWN';
  if (mappedKind !== expected && mappedStatus === 'needs_confirmation') return 'WRONG_NEEDS_CONFIRMATION';
  return 'APPROPRIATELY_UNKNOWN';
}

function matchExpectedLeg(expected: ExpectedLeg, extracted: ExtractedParlayLeg[], used: Set<number>): number {
  for (let i = 0; i < extracted.length; i += 1) {
    if (used.has(i)) continue;
    const got = extracted[i]!;
    if (!namesMatch(expected.player, fieldVal(got.playerDisplayName))) continue;
    if (fieldVal(got.propKind) === expected.market) return i;
  }
  for (let i = 0; i < extracted.length; i += 1) {
    if (used.has(i)) continue;
    if (namesMatch(expected.player, fieldVal(extracted[i]?.playerDisplayName))) return i;
  }
  return -1;
}

function scoreCase(
  spec: CaseSpec,
  extracted: ExtractedParlayLeg[],
  providerOutput: XrayVisionOutput | null
): Record<string, unknown> {
  const used = new Set<number>();
  const legs = spec.expectedLegs.map((expected) => {
    const idx = matchExpectedLeg(expected, extracted, used);
    if (idx < 0) {
      return {
        expected,
        mapped: null,
        marketClass: 'MISSING' as MarketClass,
        sideOk: false,
        lineOk: false,
        provider: null,
        guardActivated: false,
      };
    }
    used.add(idx);
    const got = extracted[idx]!;
    const mappedKind = fieldVal(got.propKind);
    const mappedStatus = fieldStatus(got.propKind);
    const providerLeg = providerOutput?.legs[idx] ?? null;
    const guard = providerLeg
      ? resolveLegMarket({
          prop_kind: providerLeg.prop_kind,
          market_evidence: providerLeg.market_evidence,
          raw_snippet: providerLeg.raw_snippet,
          field_confidence: providerLeg.field_confidence,
        })
      : null;
    const providerKind = providerLeg?.prop_kind ?? null;
    const mappedFromGuard = guard?.propKind.value ?? null;
    const guardActivated = Boolean(
      providerKind &&
        mappedFromGuard &&
        providerKind !== mappedFromGuard
    );
    return {
      expected,
      mapped: {
        player: fieldVal(got.playerDisplayName),
        playerStatus: fieldStatus(got.playerDisplayName),
        market: mappedKind,
        marketStatus: mappedStatus,
        side: fieldVal(got.side),
        sideStatus: fieldStatus(got.side),
        line: fieldVal(got.line),
        lineStatus: fieldStatus(got.line),
        odds: fieldVal(got.oddsAmerican),
        sportsbook: fieldVal(got.sportsbookText),
        matchup: fieldVal(got.matchupLabel),
        rawSnippet: got.rawSnippet,
      },
      marketClass: classifyMarket(expected.market, mappedKind, mappedStatus),
      sideOk: fieldVal(got.side) === expected.side,
      lineOk: fieldVal(got.line) === expected.line,
      provider: providerLeg
        ? {
            prop_kind: providerLeg.prop_kind,
            market_evidence: providerLeg.market_evidence,
            raw_snippet: providerLeg.raw_snippet,
          }
        : null,
      guardActivated,
    };
  });

  const unmatched = extracted
    .map((leg, i) => ({ i, leg }))
    .filter((row) => !used.has(row.i))
    .map((row) => ({
      player: fieldVal(row.leg.playerDisplayName),
      market: fieldVal(row.leg.propKind),
      marketStatus: fieldStatus(row.leg.propKind),
      marketClass: 'HALLUCINATED' as MarketClass,
    }));

  return {
    id: spec.id,
    notes: spec.notes,
    resultLegs: extracted.length,
    expectedCount: spec.expectedLegs.length,
    legs,
    unmatched,
    wrongKnown: legs.some((leg) => leg.marketClass === 'WRONG_KNOWN') || unmatched.some((leg) => leg.marketClass === 'HALLUCINATED' && Boolean(leg.market)),
    anyWrongKnownMarket: legs.some((leg) => leg.marketClass === 'WRONG_KNOWN'),
  };
}

function wrappingProvider(onOutput: (output: XrayVisionOutput) => void): XrayVisionProvider {
  return async (input) => {
    const result = await fetchXrayVisionFromOpenAi(input);
    onOutput(result.output);
    return result;
  };
}

async function main(): Promise<void> {
  if (!process.argv.includes('--run')) {
    console.error('Refusing to run without --run');
    process.exit(2);
  }

  loadLocalEnv();
  process.env.PARLAY_XRAY_EXTRACTION_ENABLED = 'true';
  process.env.PARLAY_XRAY_PRO_DAILY_LIMIT = '10';
  process.env.PARLAY_XRAY_COOLDOWN_SECONDS = '0';
  process.env.PARLAY_XRAY_VISION_DETAIL = 'low';
  if (!process.env.PARLAY_XRAY_VISION_MODEL) process.env.PARLAY_XRAY_VISION_MODEL = 'gpt-4o-mini';

  const config = loadXrayExtractionConfig();
  if (config.extractionVersion !== 'xray-extract-v2.1') {
    throw new Error(`CONFIG_DRIFT extractionVersion=${config.extractionVersion}`);
  }
  if (config.schemaVersion !== 'xray-legs-v2') {
    throw new Error(`CONFIG_DRIFT schemaVersion=${config.schemaVersion}`);
  }
  if (config.visionModel !== 'gpt-4o-mini' || config.visionDetail !== 'low') {
    throw new Error(`CONFIG_DRIFT model=${config.visionModel} detail=${config.visionDetail}`);
  }
  if (!config.openaiApiKey) throw new Error('Missing PARLAY_XRAY_OPENAI_API_KEY');
  if (!process.env.SUPABASE_DB_URL) throw new Error('Missing SUPABASE_DB_URL');

  const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
  const store = createPostgresXrayStore(pool);
  let uniquePaid = 0;
  const rows: Array<Record<string, unknown>> = [];
  let replay: Record<string, unknown> | null = null;

  try {
    for (const spec of CASES) {
      if (uniquePaid >= MAX_UNIQUE) {
        throw new Error('STOP: unique provider cap reached before corpus finished');
      }
      const path = join(OUT_DIR, spec.file);
      if (!existsSync(path)) throw new Error(`Missing fixture ${path}`);
      const bytes = readFileSync(path);
      const hash = createHash('sha256').update(bytes).digest('hex');
      let captured: XrayVisionOutput | null = null;
      const extracted = await runXrayExtraction(
        { userId: RETEST_USER, isPro: true, bytes, declaredMime: mimeOf(spec.file) },
        {
          config,
          store,
          provider: wrappingProvider((output) => {
            captured = output;
          }),
          log: (event, meta) => console.info(`[x2c4] ${event}`, meta),
        }
      );
      if (extracted.providerAttempted) uniquePaid += 1;
      if (uniquePaid > MAX_UNIQUE) {
        throw new Error('STOP: unique provider attempts exceeded 3');
      }
      if (extracted.result === 'EXTRACTION_DISABLED') {
        throw new Error('STOP: extraction disabled mid-retest');
      }
      if (extracted.extractionVersion !== 'xray-extract-v2.1') {
        throw new Error(`STOP: unexpected extraction version ${extracted.extractionVersion}`);
      }
      if (extracted.cacheHit) {
        throw new Error(`STOP: ${spec.id} was a cache hit on first unique extract; v2.1 isolation failed`);
      }
      const scored = scoreCase(spec, extracted.legs, captured);
      rows.push({
        id: spec.id,
        file: spec.file,
        sha256: hash,
        bytes: bytes.length,
        result: extracted.result,
        cacheHit: extracted.cacheHit,
        providerAttempted: extracted.providerAttempted,
        extractionVersion: extracted.extractionVersion,
        quotaUsed: extracted.quota.used,
        quotaRemaining: extracted.quota.remaining,
        scored,
      });
      console.info(
        JSON.stringify({
          progress: `${uniquePaid}/${MAX_UNIQUE}`,
          id: spec.id,
          result: extracted.result,
          paid: extracted.providerAttempted,
          wrongKnown: scored.anyWrongKnownMarket,
        })
      );
    }

    const replayBytes = readFileSync(join(OUT_DIR, CASES[0]!.file));
    const quotaBeforeReplay = await store.getQuota(RETEST_USER, new Date().toISOString().slice(0, 10));
    const replayed = await runXrayExtraction(
      { userId: RETEST_USER, isPro: true, bytes: replayBytes, declaredMime: 'image/png' },
      {
        config,
        store,
        provider: wrappingProvider(() => {
          throw new Error('STOP: replay wrapping provider invoked');
        }),
        log: (event, meta) => console.info(`[x2c4-replay] ${event}`, meta),
      }
    );
    if (replayed.providerAttempted) {
      throw new Error('STOP: dedupe replay caused a provider call');
    }
    replay = {
      sourceId: 'R1',
      result: replayed.result,
      cacheHit: replayed.cacheHit,
      providerAttempted: replayed.providerAttempted,
      quotaUsed: replayed.quota.used,
      quotaBefore: quotaBeforeReplay.userUsed,
    };
  } finally {
    const usage = await pool.query<{
      extraction_version: string;
      schema_version: string;
      model: string;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
      estimated_cost_usd: string | null;
      latency_ms: number | null;
      cache_hit: boolean;
      provider_attempted: boolean;
      success: boolean;
    }>(
      `SELECT extraction_version, schema_version, model, prompt_tokens, completion_tokens, total_tokens,
              estimated_cost_usd::text, latency_ms, cache_hit, provider_attempted, success
       FROM parlay_xray_extraction_usage
       WHERE user_id = $1
       ORDER BY created_at`,
      [RETEST_USER]
    );
    const paidUsage = usage.rows.filter((r) => r.provider_attempted && !r.cache_hit);
    const costs = paidUsage.map((r) => Number(r.estimated_cost_usd)).filter((n) => Number.isFinite(n));
    const lats = paidUsage.map((r) => r.latency_ms).filter((n): n is number => n != null);
    const summary = {
      uniquePaid,
      maxUnique: MAX_UNIQUE,
      replay,
      rows,
      paidUsage,
      costTotal: costs.reduce((a, b) => a + b, 0),
      latency: lats,
      config: {
        extractionVersion: config.extractionVersion,
        schemaVersion: config.schemaVersion,
        model: config.visionModel,
        detail: config.visionDetail,
      },
    };
    writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(summary, null, 2));
    console.info(JSON.stringify({ done: true, uniquePaid, costTotal: summary.costTotal, replay }, null, 2));
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
