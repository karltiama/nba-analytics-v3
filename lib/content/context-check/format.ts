import type {
  ContextCheckDirection,
  ContextCheckType,
  ContextMarketType,
  ContextVerdictType,
} from './types';

const MARKET_LABELS: Record<ContextMarketType, string> = {
  points: 'Points',
  rebounds: 'Rebounds',
  assists: 'Assists',
  threes: 'Threes',
  pra: 'PRA',
};

const DIRECTION_LABELS: Record<ContextCheckDirection, string> = {
  over: 'Over',
  under: 'Under',
};

const CONTEXT_TYPE_LABELS: Record<ContextCheckType, string> = {
  recent_form: 'Recent Form',
  line_context: 'Line Context',
  role_change: 'Role Change',
  roster_change: 'Roster Change',
};

const VERDICT_LABELS: Record<ContextVerdictType, string> = {
  supports: 'Supports',
  mixed: 'Mixed',
  pushes_back: 'Pushes Back',
  insufficient: 'Insufficient',
};

export function formatMarketLabel(type: ContextMarketType): string {
  return MARKET_LABELS[type];
}

export function formatDirectionLabel(direction: ContextCheckDirection): string {
  return DIRECTION_LABELS[direction];
}

export function formatMarketClaim(
  direction: ContextCheckDirection,
  line: number,
  type: ContextMarketType
): string {
  return `${formatDirectionLabel(direction)} ${formatLine(line)} ${formatMarketLabel(type)}`;
}

export function formatLine(line: number): string {
  if (!Number.isFinite(line)) return '—';
  return Number.isInteger(line) ? String(line) : line.toFixed(1);
}

/**
 * Render a 0–1 hit rate as a whole-number percent, e.g. 0.8 → "80%".
 * Non-finite values render as an em dash so color is never the only signal.
 */
export function formatHitRate(hitRate: number): string {
  if (!Number.isFinite(hitRate)) return '—';
  return `${Math.round(hitRate * 100)}%`;
}

export function formatHitFraction(hits: number, games: number): string {
  if (!Number.isFinite(hits) || !Number.isFinite(games)) return '—';
  return `${hits}/${games}`;
}

export function formatVerdictLabel(type: ContextVerdictType): string {
  return VERDICT_LABELS[type];
}

export function formatContextTypeLabel(type: ContextCheckType): string {
  return CONTEXT_TYPE_LABELS[type];
}

export function formatSignedNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
}

export function formatMinutes(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(1);
}

export function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function formatDataAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
