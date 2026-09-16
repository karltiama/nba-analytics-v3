import type { WowyPairSummary, WowySplitMode, WowyStatKey } from './types';

export type WowyInsightTone = 'up' | 'down' | 'neutral' | 'caution';

export interface WowyInsight {
  id: string;
  title: string;
  body: string;
  tone: WowyInsightTone;
}

const TEAMMATE_CHART_STATS: Array<{ key: WowyStatKey; label: string }> = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'minutes', label: 'MIN' },
  { key: 'fga', label: 'FGA' },
  { key: 'tpm', label: '3PM' },
];

const SUBJECT_CHART_STATS: Array<{ key: WowyStatKey; label: string }> = [
  { key: 'pts', label: 'PTS' },
  { key: 'oppPts', label: 'Opp PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'fga', label: 'FGA' },
  { key: 'tpm', label: '3PM' },
];

export function wowyChartStats(mode: WowySplitMode): Array<{ key: WowyStatKey; label: string }> {
  return mode === 'subject' ? SUBJECT_CHART_STATS : TEAMMATE_CHART_STATS;
}

/** @deprecated Prefer wowyChartStats(mode). Teammate-split default for older imports. */
export const WOWY_CHART_STATS = TEAMMATE_CHART_STATS;

function fmt(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function signed(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
}

function lastName(fullName: string): string {
  return fullName.split(' ').filter(Boolean).slice(-1)[0] ?? fullName;
}

function splitName(summary: WowyPairSummary): string {
  return summary.mode === 'subject' ? summary.subject.fullName : (summary.teammate?.fullName ?? summary.subject.fullName);
}

export function wowyDiffPolarity(
  key: WowyStatKey,
  absDiff: number | null
): 'favorable' | 'unfavorable' | 'neutral' {
  if (absDiff == null || !Number.isFinite(absDiff) || absDiff === 0) return 'neutral';
  if (key === 'oppPts') return absDiff > 0 ? 'unfavorable' : 'favorable';
  return absDiff > 0 ? 'favorable' : 'unfavorable';
}

export function wowyDiffTone(key: WowyStatKey, absDiff: number | null): WowyInsightTone {
  const polarity = wowyDiffPolarity(key, absDiff);
  if (polarity === 'favorable') return 'up';
  if (polarity === 'unfavorable') return 'down';
  return 'neutral';
}

/** Largest |with − without| per-game diffs, excluding nulls. */
export function rankedPerGameDiffs(summary: WowyPairSummary): Array<{
  key: WowyStatKey;
  label: string;
  withValue: number | null;
  withoutValue: number | null;
  absDiff: number;
}> {
  return wowyChartStats(summary.mode)
    .map((stat) => {
      const withValue = summary.with.perGame[stat.key];
      const withoutValue = summary.without.perGame[stat.key];
      const absDiff = withValue != null && withoutValue != null ? withValue - withoutValue : null;
      return {
        key: stat.key,
        label: stat.label,
        withValue,
        withoutValue,
        absDiff: absDiff ?? 0,
      };
    })
    .sort((a, b) => Math.abs(b.absDiff) - Math.abs(a.absDiff));
}

/**
 * Descriptive sidebar copy. Never claims the teammate caused the split,
 * and never labels DNP as injury.
 */
export function buildWowyInsights(summary: WowyPairSummary): WowyInsight[] {
  const subject = summary.subject.fullName;
  const partner = splitName(summary);
  const team = summary.team?.fullName ?? summary.team?.abbreviation ?? 'the team';
  const insights: WowyInsight[] = [];

  insights.push({
    id: 'sample',
    title: 'Sample',
    body:
      summary.mode === 'subject'
        ? `When ${partner} appeared: ${summary.with.gameCount} games. When ${partner} had a verified DNP: ${summary.without.gameCount} games. ${summary.support.label}`
        : `When ${partner} played: ${summary.with.gameCount} games. When ${partner} had a verified DNP: ${summary.without.gameCount} games. ${summary.support.label}`,
    tone: summary.support.tier === 'adequate' ? 'neutral' : 'caution',
  });

  if (summary.support.tier === 'insufficient') {
    insights.push({
      id: 'hold',
      title: 'Hold the split',
      body: 'There are not enough with and verified-without games yet to treat the raw differences as a comparison.',
      tone: 'caution',
    });
    return insights;
  }

  const ranked = rankedPerGameDiffs(summary).filter((row) => row.absDiff !== 0);
  for (const row of ranked.slice(0, 3)) {
    const who = lastName(partner);
    const tone = wowyDiffTone(row.key, row.absDiff);
    if (row.key === 'oppPts' && summary.mode === 'subject') {
      const higherWith = row.absDiff > 0;
      insights.push({
        id: `stat-${row.key}`,
        title: `Opp PTS ${higherWith ? 'higher' : 'lower'} when ${who} appeared`,
        body: `In these games, ${team} allowed ${fmt(row.withValue)} opponent points when ${subject} appeared and ${fmt(row.withoutValue)} when ${subject} had a verified DNP (${signed(row.absDiff)} per game). Higher opponent scoring is unfavorable; this is not a causal effect.`,
        tone,
      });
      continue;
    }
    const direction = row.absDiff > 0 ? 'higher' : 'lower';
    if (summary.mode === 'subject') {
      insights.push({
        id: `stat-${row.key}`,
        title: `${row.label} ${row.absDiff > 0 ? 'when' : 'without'} ${who}`,
        body: `In these games, ${team} averaged ${fmt(row.withValue)} ${row.label} when ${subject} appeared and ${fmt(row.withoutValue)} when ${subject} had a verified DNP (${signed(row.absDiff)} per game, ${direction} when the player appeared).`,
        tone,
      });
    } else {
      insights.push({
        id: `stat-${row.key}`,
        title: `${row.label} ${row.absDiff > 0 ? 'when' : 'without'} ${who}`,
        body: `In these games, ${subject} averaged ${fmt(row.withValue)} ${row.label} when ${partner} played and ${fmt(row.withoutValue)} when ${partner} had a verified DNP (${signed(row.absDiff)} per game, ${direction} when the teammate played).`,
        tone,
      });
    }
  }

  insights.push({
    id: 'caveat',
    title: 'Not a causal effect',
    body: 'Opponents, other absences, role changes, and coaching decisions can contribute. This is game-level participation, not shared-court possessions, and a verified DNP is not labeled as injury.',
    tone: 'caution',
  });

  return insights;
}
