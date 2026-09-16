/**
 * Local operator benchmark for STEP 14P.X2C.
 * Temporarily enables extraction in THIS PROCESS ONLY.
 * Does not change .env / production kill switch.
 *
 * Hard cap: 12 unique provider attempts. Replay is cache-only.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { loadXrayExtractionConfig } from '@/lib/parlay-xray/extraction/config';
import { runXrayExtraction } from '@/lib/parlay-xray/extraction/pipeline';
import { createPostgresXrayStore } from '@/lib/parlay-xray/extraction/postgres-store';
import { fetchXrayVisionFromOpenAi } from '@/lib/parlay-xray/extraction/provider';
import type { ExtractedParlayLeg, XrayField, XrayPropKind } from '@/lib/parlay-xray/types';

const MAX_UNIQUE = 12;
const BENCH_USER = 'xray-bench-x2c-operator';
const OUT_DIR = join(process.env.TEMP || '/tmp', 'parlay-xray-x2c');

type ExpectedLeg = {
  player: string;
  market: XrayPropKind;
  side: 'over' | 'under';
  line: number;
  odds: number | null;
  sportsbook: string | null;
  matchup: string | null;
  oddsUnknown?: boolean;
  sportsbookUnknown?: boolean;
  matchupUnknown?: boolean;
};

type CaseSpec = {
  id: string;
  file: string;
  difficulty: string;
  expectedResult: string;
  expectedLegs: ExpectedLeg[];
  notes: string;
};

const CASES: CaseSpec[] = [
  {
    id: 'A1',
    file: 'A1-clean-4.png',
    difficulty: 'CLEAN_SYNTHETIC',
    expectedResult: 'SUCCESS',
    notes: 'High-contrast DK 4-leg',
    expectedLegs: [
      { player: 'Nikola Jokic', market: 'points', side: 'over', line: 27.5, odds: -103, sportsbook: 'DraftKings', matchup: 'DEN vs OKC' },
      { player: 'Shai Gilgeous-Alexander', market: 'points', side: 'over', line: 32.5, odds: -109, sportsbook: 'DraftKings', matchup: 'OKC vs DEN' },
      { player: 'Jalen Brunson', market: 'points', side: 'over', line: 27.5, odds: -109, sportsbook: 'DraftKings', matchup: 'NYK vs CLE' },
      { player: 'Donovan Mitchell', market: 'points', side: 'over', line: 25.5, odds: -119, sportsbook: 'DraftKings', matchup: 'CLE vs NYK' },
    ],
  },
  {
    id: 'A2',
    file: 'A2-clean-3.png',
    difficulty: 'CLEAN_SYNTHETIC',
    expectedResult: 'SUCCESS',
    notes: 'FanDuel 3-leg including same-player two props',
    expectedLegs: [
      { player: 'Giannis Antetokounmpo', market: 'points', side: 'over', line: 27.5, odds: -113, sportsbook: 'FanDuel', matchup: 'MIL vs MIA' },
      { player: 'Giannis Antetokounmpo', market: 'rebounds', side: 'over', line: 8.5, odds: -132, sportsbook: 'FanDuel', matchup: 'MIL vs MIA' },
      { player: 'Bam Adebayo', market: 'rebounds', side: 'over', line: 5.5, odds: -110, sportsbook: 'FanDuel', matchup: 'MIA vs MIL' },
    ],
  },
  {
    id: 'A3',
    file: 'A3-clean-5.png',
    difficulty: 'CLEAN_SYNTHETIC',
    expectedResult: 'SUCCESS',
    notes: '5-leg including Under and threes',
    expectedLegs: [
      { player: 'Nikola Jokic', market: 'assists', side: 'over', line: 10.5, odds: -103, sportsbook: 'DraftKings', matchup: 'DEN vs OKC' },
      { player: 'Shai Gilgeous-Alexander', market: 'assists', side: 'over', line: 6.5, odds: -143, sportsbook: 'DraftKings', matchup: 'OKC vs DEN' },
      { player: 'Jalen Brunson', market: 'threes', side: 'over', line: 2.5, odds: 102, sportsbook: 'DraftKings', matchup: 'NYK vs CLE' },
      { player: 'Donovan Mitchell', market: 'threes', side: 'over', line: 2.5, odds: -179, sportsbook: 'DraftKings', matchup: 'CLE vs NYK' },
      { player: 'Coby White', market: 'points', side: 'under', line: 13.5, odds: -115, sportsbook: 'DraftKings', matchup: 'CHI vs WAS' },
    ],
  },
  {
    id: 'B1',
    file: 'B1-compressed.jpg',
    difficulty: 'COMPRESSED',
    expectedResult: 'SUCCESS',
    notes: 'JPEG quality 18 of the A1 4-leg',
    expectedLegs: [
      { player: 'Nikola Jokic', market: 'points', side: 'over', line: 27.5, odds: -103, sportsbook: 'DraftKings', matchup: 'DEN vs OKC' },
      { player: 'Shai Gilgeous-Alexander', market: 'points', side: 'over', line: 32.5, odds: -109, sportsbook: 'DraftKings', matchup: 'OKC vs DEN' },
      { player: 'Jalen Brunson', market: 'points', side: 'over', line: 27.5, odds: -109, sportsbook: 'DraftKings', matchup: 'NYK vs CLE' },
      { player: 'Donovan Mitchell', market: 'points', side: 'over', line: 25.5, odds: -119, sportsbook: 'DraftKings', matchup: 'CLE vs NYK' },
    ],
  },
  {
    id: 'B2',
    file: 'B2-resized.jpg',
    difficulty: 'COMPRESSED',
    expectedResult: 'SUCCESS',
    notes: '480px JPEG of the A2 3-leg',
    expectedLegs: [
      { player: 'Giannis Antetokounmpo', market: 'points', side: 'over', line: 27.5, odds: -113, sportsbook: 'FanDuel', matchup: 'MIL vs MIA' },
      { player: 'Giannis Antetokounmpo', market: 'rebounds', side: 'over', line: 8.5, odds: -132, sportsbook: 'FanDuel', matchup: 'MIL vs MIA' },
      { player: 'Bam Adebayo', market: 'rebounds', side: 'over', line: 5.5, odds: -110, sportsbook: 'FanDuel', matchup: 'MIA vs MIL' },
    ],
  },
  {
    id: 'C1',
    file: 'C1-dark-small-text.png',
    difficulty: 'DARK_LOW_CONTRAST',
    expectedResult: 'SUCCESS',
    notes: 'Dark DK 4-leg, smaller secondary type',
    expectedLegs: [
      { player: 'Nikola Jokic', market: 'points', side: 'over', line: 27.5, odds: -103, sportsbook: 'DraftKings', matchup: 'DEN vs OKC' },
      { player: 'Shai Gilgeous-Alexander', market: 'points', side: 'over', line: 32.5, odds: -109, sportsbook: 'DraftKings', matchup: 'OKC vs DEN' },
      { player: 'Jalen Brunson', market: 'points', side: 'over', line: 27.5, odds: -109, sportsbook: 'DraftKings', matchup: 'NYK vs CLE' },
      { player: 'Donovan Mitchell', market: 'points', side: 'over', line: 25.5, odds: -119, sportsbook: 'DraftKings', matchup: 'CLE vs NYK' },
    ],
  },
  {
    id: 'C2',
    file: 'C2-low-contrast.png',
    difficulty: 'DARK_LOW_CONTRAST',
    expectedResult: 'SUCCESS',
    notes: 'Gray-on-gray 3-leg; sportsbook header is generic NBA PARLAY',
    expectedLegs: [
      { player: 'Evan Mobley', market: 'points', side: 'over', line: 17.5, odds: -126, sportsbook: null, matchup: 'CLE vs NYK', sportsbookUnknown: true },
      { player: 'Evan Mobley', market: 'assists', side: 'over', line: 2.5, odds: 109, sportsbook: null, matchup: 'CLE vs NYK', sportsbookUnknown: true },
      { player: 'Jalen Brunson', market: 'assists', side: 'over', line: 7.5, odds: 113, sportsbook: null, matchup: 'NYK vs CLE', sportsbookUnknown: true },
    ],
  },
  {
    id: 'D1',
    file: 'D1-cropped-partial.png',
    difficulty: 'CROPPED',
    expectedResult: 'PARTIAL',
    notes: 'Fourth leg cropped. Expect 3 complete legs; do not invent Mitchell line.',
    expectedLegs: [
      { player: 'Nikola Jokic', market: 'points', side: 'over', line: 27.5, odds: -103, sportsbook: 'DraftKings', matchup: 'DEN vs OKC' },
      { player: 'Shai Gilgeous-Alexander', market: 'points', side: 'over', line: 32.5, odds: -109, sportsbook: 'DraftKings', matchup: 'OKC vs DEN' },
      { player: 'Jalen Brunson', market: 'points', side: 'over', line: 27.5, odds: -109, sportsbook: 'DraftKings', matchup: 'NYK vs CLE' },
    ],
  },
  {
    id: 'D2',
    file: 'D2-missing-fields.png',
    difficulty: 'CROPPED',
    expectedResult: 'PARTIAL',
    notes: 'No sportsbook header; last odds blank; no matchups.',
    expectedLegs: [
      { player: 'Nikola Jokic', market: 'rebounds', side: 'over', line: 13.5, odds: 106, sportsbook: null, matchup: null, sportsbookUnknown: true, matchupUnknown: true },
      { player: 'Shai Gilgeous-Alexander', market: 'rebounds', side: 'over', line: 4.5, odds: 103, sportsbook: null, matchup: null, sportsbookUnknown: true, matchupUnknown: true },
      { player: 'Giannis Antetokounmpo', market: 'assists', side: 'over', line: 4.5, odds: null, sportsbook: null, matchup: null, oddsUnknown: true, sportsbookUnknown: true, matchupUnknown: true },
    ],
  },
  {
    id: 'E1',
    file: 'E1-same-game-promo.png',
    difficulty: 'COMPLEX',
    expectedResult: 'SUCCESS',
    notes: 'SGP promo banner must not become a leg',
    expectedLegs: [
      { player: 'Nikola Jokic', market: 'points', side: 'over', line: 27.5, odds: -103, sportsbook: 'DraftKings', matchup: 'DEN vs OKC' },
      { player: 'Nikola Jokic', market: 'assists', side: 'over', line: 10.5, odds: -103, sportsbook: 'DraftKings', matchup: 'DEN vs OKC' },
      { player: 'Shai Gilgeous-Alexander', market: 'points', side: 'over', line: 32.5, odds: -109, sportsbook: 'DraftKings', matchup: 'OKC vs DEN' },
    ],
  },
  {
    id: 'E2',
    file: 'E2-mixed-sections.png',
    difficulty: 'COMPLEX',
    expectedResult: 'SUCCESS',
    notes: 'BOOSTED BETS header is not a leg',
    expectedLegs: [
      { player: 'Devin Booker', market: 'threes', side: 'over', line: 2.5, odds: 142, sportsbook: 'FanDuel', matchup: 'PHX vs SAS' },
      { player: 'Chet Holmgren', market: 'rebounds', side: 'over', line: 5.5, odds: -110, sportsbook: 'FanDuel', matchup: 'OKC vs DEN' },
      { player: 'Jalen Brunson', market: 'points', side: 'over', line: 27.5, odds: -109, sportsbook: 'FanDuel', matchup: 'NYK vs CLE' },
    ],
  },
  {
    id: 'F1',
    file: 'F1-box-score-nonslip.png',
    difficulty: 'NON_SLIP',
    expectedResult: 'NO_LEGS_FOUND',
    notes: 'Box score control; any betting leg is a hallucination',
    expectedLegs: [],
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

function pngSize(bytes: Buffer): { w: number; h: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  }
  return null;
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
  if (e.includes('gilgeous') && g.includes('gilgeous')) return true;
  if (e.includes('antetokounmpo') && (g.includes('antetokounmpo') || g.includes('giannis'))) return true;
  return false;
}

function fieldVal<T>(field: XrayField<T> | undefined): T | null {
  return field?.value ?? null;
}

function fieldStatus<T>(field: XrayField<T> | undefined): string {
  return field?.status ?? 'unknown';
}

function oddsClose(a: number, b: number): boolean {
  return a === b || (a === 100 && b === -100) || (a === -100 && b === 100);
}

function matchupClose(expected: string, got: string | null): boolean {
  if (!got) return false;
  const e = got.toUpperCase();
  const parts = expected.toUpperCase().split(/\s+(?:VS|@|V)\s+/);
  if (parts.length === 2) {
    return e.includes(parts[0]!) && e.includes(parts[1]!);
  }
  return normName(expected) === normName(got);
}

function sportsbookMatch(expected: string, got: string | null): boolean {
  const g = (got ?? '').toLowerCase();
  const e = expected.toLowerCase();
  if (!g) return false;
  if (e.includes('draftkings')) return g.includes('draftkings') || g.includes('dk');
  if (e.includes('fanduel')) return g.includes('fanduel') || g.includes('fd');
  return g.includes(e) || e.includes(g);
}

type FieldJudgement = 'CORRECT' | 'UNKNOWN_APPROPRIATE' | 'NEEDS_CONFIRMATION_APPROPRIATE' | 'WRONG' | 'HALLUCINATED';

function judgeKnown(expectedPresent: boolean, expectedValueOk: boolean, status: string, valuePresent: boolean): FieldJudgement {
  if (!expectedPresent) {
    if (!valuePresent || status === 'unknown') return 'UNKNOWN_APPROPRIATE';
    if (status === 'needs_confirmation') return 'NEEDS_CONFIRMATION_APPROPRIATE';
    return 'HALLUCINATED';
  }
  if (expectedValueOk && status === 'known') return 'CORRECT';
  if (expectedValueOk && status === 'needs_confirmation') return 'NEEDS_CONFIRMATION_APPROPRIATE';
  if (!valuePresent || status === 'unknown') return 'UNKNOWN_APPROPRIATE';
  return 'WRONG';
}

/**
 * Scoring vocabulary (X2C.1 cleanup):
 * - returnedLegCount: legs the mapper kept (what the provider/app actually emitted)
 * - matchedExpectedLegCount: returned legs matched to an expected ground-truth leg
 * - unmatchedReturnedLegCount: returned legs that did not match any expected leg
 * - hallucinatedLegCount: unmatched returned legs, plus invented canonical ids
 *
 * `detected` previously meant matchedExpectedLegCount, which made F1 look like
 * Detected=0 / Hallucinations=4 while four invented legs were returned.
 * A3 name-mismatch and D1 extra-leg cases have the same split: returned ≠ matched.
 */
function scoreCase(spec: CaseSpec, extracted: ExtractedParlayLeg[]): {
  returnedLegCount: number;
  matchedExpectedLegCount: number;
  unmatchedReturnedLegCount: number;
  detected: number;
  coreExact: number;
  fullExact: number;
  unknownAppropriate: number;
  needsAppropriate: number;
  wrong: number;
  hallucinations: number;
  extraLegs: number;
} {
  const used = new Set<number>();
  let coreExact = 0;
  let fullExact = 0;
  let unknownAppropriate = 0;
  let needsAppropriate = 0;
  let wrong = 0;
  let hallucinations = 0;

  const tally = (j: FieldJudgement) => {
    if (j === 'CORRECT') return;
    if (j === 'UNKNOWN_APPROPRIATE') unknownAppropriate += 1;
    else if (j === 'NEEDS_CONFIRMATION_APPROPRIATE') needsAppropriate += 1;
    else if (j === 'HALLUCINATED') hallucinations += 1;
    else wrong += 1;
  };

  for (const exp of spec.expectedLegs) {
    let bestIdx = -1;
    for (let i = 0; i < extracted.length; i += 1) {
      if (used.has(i)) continue;
      if (namesMatch(exp.player, fieldVal(extracted[i]?.playerDisplayName))) {
        bestIdx = i;
        break;
      }
    }
    if (bestIdx < 0) {
      wrong += 1;
      continue;
    }
    used.add(bestIdx);
    const got = extracted[bestIdx]!;
    const playerOk = namesMatch(exp.player, fieldVal(got.playerDisplayName));
    const marketOk = fieldVal(got.propKind) === exp.market;
    const sideOk = fieldVal(got.side) === exp.side;
    const lineOk = fieldVal(got.line) === exp.line;
    const core = playerOk && marketOk && sideOk && lineOk;
    if (core) coreExact += 1;

    const oddsExpected = !exp.oddsUnknown && exp.odds != null;
    const oddsGot = fieldVal(got.oddsAmerican);
    const oddsOk = oddsExpected && oddsGot != null && oddsClose(exp.odds!, oddsGot);
    const bookExpected = !exp.sportsbookUnknown && Boolean(exp.sportsbook);
    const bookGot = fieldVal(got.sportsbookText);
    const bookOk = bookExpected && sportsbookMatch(exp.sportsbook!, bookGot);
    const matchExpected = !exp.matchupUnknown && Boolean(exp.matchup);
    const matchGot = fieldVal(got.matchupLabel) || [fieldVal(got.teamAbbr), fieldVal(got.opponentAbbr)].filter(Boolean).join(' vs ');
    const matchOk = matchExpected && matchupClose(exp.matchup!, matchGot || null);

    if (core && (!oddsExpected || oddsOk) && (!bookExpected || bookOk) && (!matchExpected || matchOk)) {
      fullExact += 1;
    }

    tally(judgeKnown(true, playerOk, fieldStatus(got.playerDisplayName), Boolean(fieldVal(got.playerDisplayName))));
    tally(judgeKnown(true, marketOk, fieldStatus(got.propKind), Boolean(fieldVal(got.propKind))));
    tally(judgeKnown(true, sideOk, fieldStatus(got.side), Boolean(fieldVal(got.side))));
    tally(judgeKnown(true, lineOk, fieldStatus(got.line), fieldVal(got.line) != null));
    tally(judgeKnown(oddsExpected, Boolean(oddsOk), fieldStatus(got.oddsAmerican), oddsGot != null));
    tally(judgeKnown(bookExpected, Boolean(bookOk), fieldStatus(got.sportsbookText), Boolean(bookGot)));
    tally(judgeKnown(matchExpected, Boolean(matchOk), fieldVal(got.matchupLabel) || fieldVal(got.teamAbbr) ? 'known' : 'unknown', Boolean(matchGot)));

    if (fieldVal(got.playerId) || fieldVal(got.nbaPlayerId)) {
      hallucinations += 1;
    }
  }

  const unmatchedReturnedLegCount = extracted.length - used.size;
  hallucinations += unmatchedReturnedLegCount;

  return {
    returnedLegCount: extracted.length,
    matchedExpectedLegCount: used.size,
    unmatchedReturnedLegCount,
    detected: used.size,
    coreExact,
    fullExact,
    unknownAppropriate,
    needsAppropriate,
    wrong,
    hallucinations,
    extraLegs: unmatchedReturnedLegCount,
  };
}

function usable(result: string): boolean {
  return result === 'SUCCESS' || result === 'PARTIAL' || result === 'NEEDS_CONFIRMATION' || result === 'NO_LEGS_FOUND';
}

async function main(): Promise<void> {
  if (!process.argv.includes('--run')) {
    console.error('Refusing to run without --run');
    process.exit(2);
  }

  loadLocalEnv();
  process.env.PARLAY_XRAY_EXTRACTION_ENABLED = 'true';
  process.env.PARLAY_XRAY_PRO_DAILY_LIMIT = '20';
  process.env.PARLAY_XRAY_COOLDOWN_SECONDS = '0';
  process.env.PARLAY_XRAY_VISION_DETAIL = 'low';
  if (!process.env.PARLAY_XRAY_VISION_MODEL) process.env.PARLAY_XRAY_VISION_MODEL = 'gpt-4o-mini';

  const config = loadXrayExtractionConfig();
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
  const quotaBefore = await store.getQuota(BENCH_USER, new Date().toISOString().slice(0, 10));

  let uniquePaid = 0;
  const rows: Array<Record<string, unknown>> = [];
  let replay: Record<string, unknown> | null = null;
  let firstSuccessId: string | null = null;
  let firstSuccessFile: string | null = null;

  try {
    for (const spec of CASES) {
      if (uniquePaid >= MAX_UNIQUE) {
        throw new Error('STOP: unique provider cap reached before corpus finished');
      }
      const path = join(OUT_DIR, spec.file);
      if (!existsSync(path)) throw new Error(`Missing fixture ${path}`);
      const bytes = readFileSync(path);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const dim = pngSize(bytes);

      const extracted = await runXrayExtraction(
        { userId: BENCH_USER, isPro: true, bytes, declaredMime: mimeOf(spec.file) },
        { config, store, provider: fetchXrayVisionFromOpenAi, log: (event, meta) => console.info(`[x2c] ${event}`, meta) }
      );

      if (extracted.providerAttempted) uniquePaid += 1;
      if (uniquePaid > MAX_UNIQUE) {
        throw new Error('STOP: unique provider attempts exceeded 12');
      }
      if (extracted.result === 'EXTRACTION_DISABLED') {
        throw new Error('STOP: extraction disabled mid-benchmark');
      }

      const scored = scoreCase(spec, extracted.legs);
      const row = {
        id: spec.id,
        difficulty: spec.difficulty,
        expectedLegs: spec.expectedLegs.length,
        returnedLegCount: scored.returnedLegCount,
        matchedExpectedLegCount: scored.matchedExpectedLegCount,
        unmatchedReturnedLegCount: scored.unmatchedReturnedLegCount,
        hallucinatedLegCount: scored.hallucinations,
        detected: scored.detected,
        extractedCount: extracted.legs.length,
        coreExact: scored.coreExact,
        fullExact: scored.fullExact,
        unknownAppropriate: scored.unknownAppropriate,
        needsAppropriate: scored.needsAppropriate,
        wrong: scored.wrong,
        hallucinations: scored.hallucinations,
        extraLegs: scored.extraLegs,
        result: extracted.result,
        expectedResult: spec.expectedResult,
        cacheHit: extracted.cacheHit,
        providerAttempted: extracted.providerAttempted,
        quotaUsed: extracted.quota.used,
        bytes: bytes.length,
        width: dim?.w ?? null,
        height: dim?.h ?? null,
        sha256: hash,
        notes: spec.notes,
        legsPreview: extracted.legs.map((leg) => ({
          player: fieldVal(leg.playerDisplayName),
          playerStatus: fieldStatus(leg.playerDisplayName),
          market: fieldVal(leg.propKind),
          side: fieldVal(leg.side),
          line: fieldVal(leg.line),
          odds: fieldVal(leg.oddsAmerican),
          sportsbook: fieldVal(leg.sportsbookText),
          matchup: fieldVal(leg.matchupLabel),
          playerId: fieldVal(leg.playerId),
          nbaPlayerId: fieldVal(leg.nbaPlayerId),
        })),
      };
      rows.push(row);
      console.info(JSON.stringify({ progress: `${uniquePaid}/${MAX_UNIQUE}`, id: spec.id, result: extracted.result, paid: extracted.providerAttempted }));

      if (!firstSuccessId && extracted.providerAttempted && usable(extracted.result) && spec.expectedLegs.length > 0 && extracted.legs.length > 0) {
        firstSuccessId = spec.id;
        firstSuccessFile = spec.file;
      }
    }

    if (!firstSuccessFile) throw new Error('No successful unique extraction available for dedupe replay');
    const replayBytes = readFileSync(join(OUT_DIR, firstSuccessFile));
    const quotaBeforeReplay = await store.getQuota(BENCH_USER, new Date().toISOString().slice(0, 10));
    const replayed = await runXrayExtraction(
      { userId: BENCH_USER, isPro: true, bytes: replayBytes, declaredMime: mimeOf(firstSuccessFile) },
      { config, store, provider: fetchXrayVisionFromOpenAi, log: (event, meta) => console.info(`[x2c-replay] ${event}`, meta) }
    );
    if (replayed.providerAttempted) {
      throw new Error('STOP: dedupe replay caused a provider call');
    }
    replay = {
      sourceId: firstSuccessId,
      result: replayed.result,
      cacheHit: replayed.cacheHit,
      providerAttempted: replayed.providerAttempted,
      quotaUsed: replayed.quota.used,
      quotaBefore: quotaBeforeReplay.userUsed,
    };
  } finally {
    const quotaAfter = await store.getQuota(BENCH_USER, new Date().toISOString().slice(0, 10));
    const usage = await pool.query<{
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
      estimated_cost_usd: string | null;
      latency_ms: number | null;
      cache_hit: boolean;
      provider_attempted: boolean;
      success: boolean;
      original_width: number | null;
      original_height: number | null;
      original_bytes: number | null;
    }>(
      `SELECT prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd::text, latency_ms,
              cache_hit, provider_attempted, success, original_width, original_height, original_bytes
       FROM parlay_xray_extraction_usage
       WHERE user_id = $1
       ORDER BY created_at`,
      [BENCH_USER]
    );

    const paidUsage = usage.rows.filter((r) => r.provider_attempted && !r.cache_hit);
    const costs = paidUsage.map((r) => Number(r.estimated_cost_usd)).filter((n) => Number.isFinite(n));
    const lats = paidUsage.map((r) => r.latency_ms).filter((n): n is number => n != null);
    const summary = {
      uniquePaid,
      maxUnique: MAX_UNIQUE,
      quotaBefore,
      quotaAfter,
      replay,
      rows,
      paidUsage,
      cost: stats(costs),
      latency: stats(lats),
      config: { model: config.visionModel, detail: config.visionDetail, proLimit: config.proDailyLimit, cooldownMs: config.cooldownMs },
    };
    writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(summary, null, 2));
    console.info(JSON.stringify({ done: true, uniquePaid, cost: summary.cost, latency: summary.latency, replay }, null, 2));
    await pool.end();
  }
}

function stats(values: number[]): { n: number; min: number | null; max: number | null; mean: number | null; median: number | null; p90: number | null } {
  if (values.length === 0) return { n: 0, min: null, max: null, mean: null, median: null, p90: null };
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const median = s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  const p90 = s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)]!;
  return {
    n: s.length,
    min: s[0]!,
    max: s[s.length - 1]!,
    mean: Number(mean.toFixed(6)),
    median: Number(median.toFixed(6)),
    p90: Number(p90.toFixed(6)),
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
