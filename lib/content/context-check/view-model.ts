import {
  formatContextTypeLabel,
  formatDataAsOf,
  formatHitFraction,
  formatHitRate,
  formatMarketClaim,
  formatMinutes,
  formatSignedNumber,
  formatVerdictLabel,
  playerInitials,
} from './format';
import type {
  ContextCheckCardVariant,
  ContextCheckData,
  ContextVerdictType,
} from './types';

export interface CardStatRow {
  label: string;
  value: string;
  detail?: string;
}

export interface ContextCheckCardViewModel {
  variant: ContextCheckCardVariant;
  brandKicker: string;
  brandTitle: string;
  playerName: string;
  playerTeam?: string;
  playerInitials: string;
  headshotUrl?: string;
  marketClaim: string;
  contextTypeLabel: string;
  headlineKicker: string;
  headlineText: string;
  headlineRate: string;
  headlineFraction: string;
  sampleRows: CardStatRow[];
  lineContextRows: CardStatRow[] | null;
  roleContextRows: CardStatRow[] | null;
  verdictType: ContextVerdictType;
  verdictLabel: string;
  verdictTitle: string;
  verdictExplanation: string;
  dataAsOfLabel: string;
}

function sampleRowsForVariant(
  data: ContextCheckData,
  variant: ContextCheckCardVariant
): CardStatRow[] {
  const rows = data.samples.map((sample) => ({
    label: sample.label,
    value: formatHitFraction(sample.hits, sample.games),
    detail: formatHitRate(sample.hitRate),
  }));

  if (variant !== 'social' || rows.length <= 2) {
    return rows;
  }

  const first = rows[0];
  const season =
    rows.find((row) => row.label.toLowerCase().includes('season')) ?? rows[rows.length - 1];
  return first.label === season.label ? [first] : [first, season];
}

function lineContextRows(data: ContextCheckData): CardStatRow[] | null {
  const ctx = data.lineContext;
  if (!ctx) return null;

  const rows: CardStatRow[] = [{ label: 'Current line', value: ctx.currentLine.toFixed(1) }];

  if (ctx.last5AverageLine != null && Number.isFinite(ctx.last5AverageLine)) {
    rows.unshift({ label: 'Recent avg line', value: ctx.last5AverageLine.toFixed(1) });
  } else if (ctx.last10AverageLine != null && Number.isFinite(ctx.last10AverageLine)) {
    rows.unshift({ label: 'Recent avg line', value: ctx.last10AverageLine.toFixed(1) });
  }

  if (ctx.difference != null && Number.isFinite(ctx.difference)) {
    rows.push({ label: 'Difference', value: formatSignedNumber(ctx.difference) });
  }

  return rows;
}

function roleContextRows(data: ContextCheckData): CardStatRow[] | null {
  const ctx = data.roleContext;
  if (!ctx) return null;

  const rows: CardStatRow[] = [];
  if (ctx.recentMinutes != null && Number.isFinite(ctx.recentMinutes)) {
    rows.push({ label: 'Recent minutes', value: formatMinutes(ctx.recentMinutes) });
  }
  if (ctx.seasonMinutes != null && Number.isFinite(ctx.seasonMinutes)) {
    rows.push({ label: 'Season minutes', value: formatMinutes(ctx.seasonMinutes) });
  }
  if (ctx.minutesChange != null && Number.isFinite(ctx.minutesChange)) {
    rows.push({ label: 'Change', value: formatSignedNumber(ctx.minutesChange) });
  }
  if (ctx.starterStatus) {
    rows.push({ label: 'Role', value: ctx.starterStatus });
  }

  return rows.length > 0 ? rows : null;
}

/**
 * Map ContextCheckData into a presentation view-model.
 * Candidate scores and discovery metadata are intentionally omitted.
 */
export function toContextCheckCardViewModel(
  data: ContextCheckData,
  variant: ContextCheckCardVariant = 'web'
): ContextCheckCardViewModel {
  const team = data.player.teamAbbreviation ?? data.player.teamName;

  return {
    variant,
    brandKicker: 'Court Context',
    brandTitle: 'Context Check',
    playerName: data.player.name,
    playerTeam: team,
    playerInitials: playerInitials(data.player.name),
    headshotUrl: data.player.headshotUrl,
    marketClaim: formatMarketClaim(data.market.direction, data.market.line, data.market.type),
    contextTypeLabel: formatContextTypeLabel(data.contextType),
    headlineKicker: 'The Claim',
    headlineText: data.headline.text,
    headlineRate: formatHitRate(data.headline.hitRate),
    headlineFraction: formatHitFraction(data.headline.hits, data.headline.games),
    sampleRows: sampleRowsForVariant(data, variant),
    lineContextRows: lineContextRows(data),
    roleContextRows: roleContextRows(data),
    verdictType: data.verdict.type,
    verdictLabel: formatVerdictLabel(data.verdict.type),
    verdictTitle: data.verdict.title,
    verdictExplanation: data.verdict.explanation,
    dataAsOfLabel: formatDataAsOf(data.dataAsOf),
  };
}
