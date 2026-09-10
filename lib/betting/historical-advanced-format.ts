/**
 * Historical Explorer Advanced display helpers (Step 12E).
 * Format only — never recompute ORtg / TS% / Net / PIE from the box score.
 * Percentages are certified 0–1 fractions.
 */

import type { HistoricalPlayerAdvanced } from '@/lib/betting/historical-advanced';

export const ADVANCED_MISSING = '—';

export const ADVANCED_FRACTION_FIELDS = [
  'usagePercentage',
  'trueShootingPercentage',
  'effectiveFieldGoalPercentage',
  'assistPercentage',
  'reboundPercentage',
  'pie',
] as const;

export const ADVANCED_METRIC_FIELDS: Array<keyof HistoricalPlayerAdvanced> = [
  'usagePercentage',
  'trueShootingPercentage',
  'effectiveFieldGoalPercentage',
  'offensiveRating',
  'defensiveRating',
  'netRating',
  'pace',
  'possessions',
  'assistPercentage',
  'reboundPercentage',
  'turnoverRatio',
  'pie',
];

/** Concise accessible definitions. Game-level only — not season role. */
export const ADVANCED_METRIC_HELP = {
  usg: {
    abbr: 'USG%',
    label: 'Usage percentage',
    help: 'Share of offensive involvement this game, as defined by the provider.',
  },
  ts: {
    abbr: 'TS%',
    label: 'True shooting percentage',
    help: 'Scoring efficiency this game, including 2s, 3s, and free throws.',
  },
  efg: {
    abbr: 'eFG%',
    label: 'Effective field-goal percentage',
    help: 'Field-goal efficiency this game, adjusted for 3-point value.',
  },
  ortg: {
    abbr: 'ORtg',
    label: 'Offensive rating',
    help: 'Estimated offensive points per 100 possessions this game.',
  },
  drtg: {
    abbr: 'DRtg',
    label: 'Defensive rating',
    help: 'Estimated defensive points allowed per 100 possessions this game.',
  },
  net: {
    abbr: 'Net',
    label: 'Net rating',
    help: 'Provider net rating this game (offensive minus defensive, per 100 possessions).',
  },
  ast: {
    abbr: 'AST%',
    label: 'Assist percentage',
    help: 'Assist percentage this game, as defined by the provider.',
  },
  reb: {
    abbr: 'REB%',
    label: 'Rebound percentage',
    help: 'Rebound percentage this game, as defined by the provider.',
  },
  tov: {
    abbr: 'TOV Ratio',
    label: 'Turnover ratio',
    help: 'Provider turnover ratio this game. Not a percentage.',
  },
  pie: {
    abbr: 'PIE',
    label: 'Player Impact Estimate',
    help: 'Player Impact Estimate for this game.',
  },
  pace: {
    abbr: 'Pace',
    label: 'Pace',
    help: 'Provider pace estimate for this player-game sample. Can look extreme in tiny samples.',
  },
  poss: {
    abbr: 'Poss',
    label: 'Possessions',
    help: 'Provider player-game Advanced possessions this game (sample size).',
  },
} as const;

function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

/** 0.284 → 28.4%. 1.5 → 150.0%. Do not clamp. */
export function formatAdvancedPercent(value: number | null | undefined): string {
  const n = finiteOrNull(value);
  if (n == null) return ADVANCED_MISSING;
  return `${(n * 100).toFixed(1)}%`;
}

export function formatAdvancedRating(value: number | null | undefined): string {
  const n = finiteOrNull(value);
  if (n == null) return ADVANCED_MISSING;
  return n.toFixed(1);
}

/** Signed net: +8.4 / -5.2 / 0.0 */
export function formatAdvancedNet(value: number | null | undefined): string {
  const n = finiteOrNull(value);
  if (n == null) return ADVANCED_MISSING;
  if (Object.is(n, -0) || n === 0) return '0.0';
  const body = Math.abs(n).toFixed(1);
  return n > 0 ? `+${body}` : `-${body}`;
}

export function formatAdvancedPossessions(value: number | null | undefined): string {
  const n = finiteOrNull(value);
  if (n == null) return ADVANCED_MISSING;
  return String(Math.round(n));
}

export function formatAdvancedPace(value: number | null | undefined): string {
  const n = finiteOrNull(value);
  if (n == null) return ADVANCED_MISSING;
  return n.toFixed(1);
}

/** Provider ratio — never percent-formatted. */
export function formatAdvancedTurnoverRatio(value: number | null | undefined): string {
  const n = finiteOrNull(value);
  if (n == null) return ADVANCED_MISSING;
  return n.toFixed(1);
}

export function advancedMetricsUnavailable(
  advanced: HistoricalPlayerAdvanced | null | undefined
): boolean {
  if (!advanced) return true;
  return ADVANCED_METRIC_FIELDS.every((field) => finiteOrNull(advanced[field]) == null);
}

export function displayAdvancedMetrics(
  advanced: HistoricalPlayerAdvanced | null | undefined
): HistoricalPlayerAdvanced | null {
  if (advancedMetricsUnavailable(advanced)) return null;
  return advanced ?? null;
}

export type FormattedAdvancedRow = {
  usg: string;
  ts: string;
  efg: string;
  ortg: string;
  drtg: string;
  net: string;
  ast: string;
  reb: string;
  tov: string;
  pie: string;
  pace: string;
  poss: string;
};

export function formatAdvancedRow(
  advanced: HistoricalPlayerAdvanced | null | undefined
): FormattedAdvancedRow {
  const metrics = displayAdvancedMetrics(advanced);
  return {
    usg: formatAdvancedPercent(metrics?.usagePercentage),
    ts: formatAdvancedPercent(metrics?.trueShootingPercentage),
    efg: formatAdvancedPercent(metrics?.effectiveFieldGoalPercentage),
    ortg: formatAdvancedRating(metrics?.offensiveRating),
    drtg: formatAdvancedRating(metrics?.defensiveRating),
    net: formatAdvancedNet(metrics?.netRating),
    ast: formatAdvancedPercent(metrics?.assistPercentage),
    reb: formatAdvancedPercent(metrics?.reboundPercentage),
    tov: formatAdvancedTurnoverRatio(metrics?.turnoverRatio),
    pie: formatAdvancedPercent(metrics?.pie),
    pace: formatAdvancedPace(metrics?.pace),
    poss: formatAdvancedPossessions(metrics?.possessions),
  };
}
