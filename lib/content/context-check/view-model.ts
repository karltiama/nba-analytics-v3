import {
  formatContextTypeLabel,
  formatDataAsOf,
  formatHitFraction,
  formatHitRate,
  formatMarketClaim,
  formatMinutes,
  formatSignedNumber,
  formatSocialVerdictLabel,
  formatVerdictLabel,
  playerInitials,
} from './format';
import type {
  ContextCheckCardVariant,
  ContextCheckData,
  ContextCheckPlayer,
  ContextVerdictType,
  PlayerVisualKind,
} from './types';

export interface CardStatRow {
  label: string;
  value: string;
  detail?: string;
}

export interface ContextCheckPrimaryContext {
  title: string;
  rows: CardStatRow[];
}

export interface ResolvedPlayerVisual {
  kind: PlayerVisualKind;
  src?: string;
}

export interface ContextCheckCardViewModel {
  variant: ContextCheckCardVariant;
  brandKicker: string;
  brandTitle: string;
  playerName: string;
  playerTeam?: string;
  playerInitials: string;
  headshotUrl?: string;
  heroImageUrl?: string;
  visual: ResolvedPlayerVisual;
  marketClaim: string;
  contextTypeLabel: string;
  headlineKicker: string;
  headlineText: string;
  headlineRate: string;
  headlineFraction: string;
  sampleRows: CardStatRow[];
  lineContextRows: CardStatRow[] | null;
  roleContextRows: CardStatRow[] | null;
  /** Social shows one primary context block; web still lists both sections. */
  primaryContext: ContextCheckPrimaryContext | null;
  verdictType: ContextVerdictType;
  verdictLabel: string;
  verdictTitle: string;
  verdictExplanation: string;
  dataAsOfLabel: string;
  footerBrand: string;
  footerTagline: string;
}

const SOCIAL_SAMPLE_LABELS = ['L5', 'L10', 'Season'] as const;

export function resolvePlayerVisual(player: ContextCheckPlayer): ResolvedPlayerVisual {
  if (player.heroImageUrl) {
    return { kind: 'hero', src: player.heroImageUrl };
  }
  if (player.headshotUrl) {
    return { kind: 'headshot', src: player.headshotUrl };
  }
  return { kind: 'fallback' };
}

function rowFromSample(label: string, hits: number, games: number, hitRate: number): CardStatRow {
  return {
    label,
    value: formatHitFraction(hits, games),
    detail: formatHitRate(hitRate),
  };
}

/**
 * Web keeps the full sample list (including L20).
 * Social compresses to L5 / L10 / Season when those labels exist.
 */
function sampleRowsForVariant(
  data: ContextCheckData,
  variant: ContextCheckCardVariant
): CardStatRow[] {
  const rows = data.samples.map((sample) =>
    rowFromSample(sample.label, sample.hits, sample.games, sample.hitRate)
  );

  if (variant !== 'social') {
    return rows;
  }

  const picked: CardStatRow[] = [];
  for (const label of SOCIAL_SAMPLE_LABELS) {
    const match = rows.find((row) => row.label.toLowerCase() === label.toLowerCase());
    if (match) picked.push(match);
  }

  if (picked.length > 0) return picked;

  const first = rows[0];
  const season =
    rows.find((row) => row.label.toLowerCase().includes('season')) ?? rows[rows.length - 1];
  if (!first) return [];
  return first.label === season?.label ? [first] : [first, season].filter(Boolean) as CardStatRow[];
}

function lineContextRows(
  data: ContextCheckData,
  variant: ContextCheckCardVariant
): CardStatRow[] | null {
  const ctx = data.lineContext;
  if (!ctx) return null;

  const recent =
    ctx.last5AverageLine != null && Number.isFinite(ctx.last5AverageLine)
      ? ctx.last5AverageLine
      : ctx.last10AverageLine != null && Number.isFinite(ctx.last10AverageLine)
        ? ctx.last10AverageLine
        : undefined;

  if (variant === 'social') {
    const rows: CardStatRow[] = [];
    if (recent != null) rows.push({ label: 'Recent avg', value: recent.toFixed(1) });
    rows.push({ label: 'Tonight', value: ctx.currentLine.toFixed(1) });
    if (ctx.difference != null && Number.isFinite(ctx.difference)) {
      rows.push({ label: 'Change', value: formatSignedNumber(ctx.difference) });
    }
    return rows;
  }

  const rows: CardStatRow[] = [{ label: 'Current line', value: ctx.currentLine.toFixed(1) }];
  if (recent != null) {
    rows.unshift({ label: 'Recent avg line', value: recent.toFixed(1) });
  }
  if (ctx.difference != null && Number.isFinite(ctx.difference)) {
    rows.push({ label: 'Difference', value: formatSignedNumber(ctx.difference) });
  }
  return rows;
}

function roleContextRows(
  data: ContextCheckData,
  variant: ContextCheckCardVariant
): CardStatRow[] | null {
  const ctx = data.roleContext;
  if (!ctx) return null;

  const rows: CardStatRow[] = [];

  if (variant === 'social') {
    if (ctx.seasonMinutes != null && Number.isFinite(ctx.seasonMinutes)) {
      rows.push({ label: 'Season MPG', value: formatMinutes(ctx.seasonMinutes) });
    }
    if (ctx.recentMinutes != null && Number.isFinite(ctx.recentMinutes)) {
      rows.push({ label: 'Recent MPG', value: formatMinutes(ctx.recentMinutes) });
    }
    if (ctx.minutesChange != null && Number.isFinite(ctx.minutesChange)) {
      rows.push({ label: 'Change', value: formatSignedNumber(ctx.minutesChange) });
    }
    return rows.length > 0 ? rows : null;
  }

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

function primaryContextForSocial(
  data: ContextCheckData,
  lineRows: CardStatRow[] | null,
  roleRows: CardStatRow[] | null
): ContextCheckPrimaryContext | null {
  const preferRole = data.contextType === 'role_change' || data.contextType === 'roster_change';
  if (preferRole && roleRows) {
    return { title: 'Role Check', rows: roleRows };
  }
  if (lineRows) {
    return { title: 'Line Check', rows: lineRows };
  }
  if (roleRows) {
    return { title: 'Role Check', rows: roleRows };
  }
  return null;
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
  const visual = resolvePlayerVisual(data.player);
  const lineRows = lineContextRows(data, variant);
  const roleRows = roleContextRows(data, variant);
  const isSocial = variant === 'social';

  return {
    variant,
    brandKicker: 'Court Context',
    brandTitle: 'Context Check',
    playerName: data.player.name,
    playerTeam: team,
    playerInitials: playerInitials(data.player.name),
    headshotUrl: data.player.headshotUrl,
    heroImageUrl: data.player.heroImageUrl,
    visual,
    marketClaim: formatMarketClaim(data.market.direction, data.market.line, data.market.type),
    contextTypeLabel: formatContextTypeLabel(data.contextType),
    headlineKicker: 'The Claim',
    headlineText: data.headline.text,
    headlineRate: formatHitRate(data.headline.hitRate),
    headlineFraction: formatHitFraction(data.headline.hits, data.headline.games),
    sampleRows: sampleRowsForVariant(data, variant),
    lineContextRows: lineRows,
    roleContextRows: roleRows,
    primaryContext: isSocial ? primaryContextForSocial(data, lineRows, roleRows) : null,
    verdictType: data.verdict.type,
    verdictLabel: isSocial
      ? formatSocialVerdictLabel(data.verdict.type)
      : formatVerdictLabel(data.verdict.type),
    verdictTitle: data.verdict.title,
    verdictExplanation: data.verdict.explanation,
    dataAsOfLabel: formatDataAsOf(data.dataAsOf),
    footerBrand: 'courtcontext.com',
    footerTagline: 'More than the trend.',
  };
}
