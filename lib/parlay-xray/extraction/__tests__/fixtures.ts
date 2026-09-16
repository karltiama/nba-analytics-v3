import type { XrayExtractionConfig } from '../config';
import type { XrayVisionLeg, XrayVisionOutput } from '../schema';

/** 1×1 PNG */
export const MIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export function pngVariant(tag: string): Buffer {
  return Buffer.concat([MIN_PNG, Buffer.from(tag)]);
}

export function testConfig(overrides: Partial<XrayExtractionConfig> = {}): XrayExtractionConfig {
  return {
    enabled: true,
    freeDailyLimit: 3,
    proDailyLimit: 10,
    globalDailyLimit: 100,
    maxConcurrentPerUser: 1,
    dedupeTtlMs: 24 * 60 * 60 * 1000,
    cooldownMs: 0,
    inflightTtlMs: 120_000,
    extractionVersion: 'xray-extract-v2.1',
    schemaVersion: 'xray-legs-v2',
    visionModel: 'gpt-4o-mini',
    visionDetail: 'low',
    maxUploadBytes: 10 * 1024 * 1024,
    maxLongEdge: 4096,
    maxOutputTokens: 1400,
    store: 'memory',
    openaiApiKey: 'test-key',
    ...overrides,
  };
}

export function sampleVisionLeg(overrides: Partial<XrayVisionLeg> = {}): XrayVisionLeg {
  return {
    player_name: 'Luka Doncic',
    player_name_confidence: 'high',
    team_abbr: 'DAL',
    opponent_abbr: 'DEN',
    matchup_label: 'DAL @ DEN',
    prop_kind: 'assists',
    side: 'over',
    line: 7.5,
    odds_american: -115,
    sportsbook: 'DraftKings',
    game_date: null,
    field_confidence: 'high',
    raw_snippet: 'L. Doncic O 7.5 AST',
    player_evidence: 'Luka Doncic',
    market_evidence: 'AST',
    side_evidence: 'O',
    line_evidence: '7.5',
    odds_evidence: '-115',
    ...overrides,
  };
}

export function sampleVision(overrides: Partial<XrayVisionOutput> = {}): XrayVisionOutput {
  return {
    document_type: 'BET_SLIP',
    wager_evidence: 'parlay Over 7.5 AST -115',
    image_quality: 'good',
    sportsbook: 'DraftKings',
    legs: [sampleVisionLeg()],
    ...overrides,
  };
}

export function boxScoreVision(): XrayVisionOutput {
  return {
    document_type: 'NOT_BET_SLIP',
    wager_evidence: 'box score PTS REB AST totals',
    image_quality: 'good',
    sportsbook: null,
    legs: [
      sampleVisionLeg({
        player_name: 'Nikola Jokic',
        player_evidence: 'Jokic',
        market_evidence: 'PTS',
        side_evidence: null,
        line_evidence: '29',
        odds_evidence: null,
        prop_kind: 'points',
        side: 'over',
        line: 29,
        odds_american: null,
        raw_snippet: 'Jokic 29 PTS',
      }),
      sampleVisionLeg({
        player_name: 'Nikola Jokic',
        player_evidence: 'Jokic',
        market_evidence: 'REB',
        side_evidence: null,
        line_evidence: '6',
        odds_evidence: null,
        prop_kind: 'rebounds',
        side: 'over',
        line: 6,
        odds_american: null,
        raw_snippet: '6 REB',
      }),
      sampleVisionLeg({
        player_name: 'Nikola Jokic',
        player_evidence: 'Jokic',
        market_evidence: 'AST',
        side_evidence: null,
        line_evidence: '8',
        odds_evidence: null,
        prop_kind: 'assists',
        side: 'over',
        line: 8,
        odds_american: null,
        raw_snippet: '8 AST',
      }),
      sampleVisionLeg({
        player_name: 'Jamal Murray',
        player_evidence: 'Murray',
        market_evidence: 'PTS',
        side_evidence: null,
        line_evidence: '21',
        odds_evidence: null,
        prop_kind: 'points',
        side: 'over',
        line: 21,
        odds_american: null,
        raw_snippet: 'Murray 21 PTS',
      }),
    ],
  };
}
