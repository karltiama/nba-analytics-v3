import { resolvePropsMarketContext } from '@/lib/betting/props-market-context';

export type ResearchJourneyParams = {
  date?: string | null;
  gameId?: string | number | null;
  playerId?: string | number | null;
  propType?: string | null;
  side?: string | null;
  sportsbook?: string | null;
  lineValue?: string | number | null;
};

function ymd(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}

function id(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

export function gameDetailHref(gameId: string | number): string {
  return `/betting/games/${encodeURIComponent(String(gameId))}`;
}

/** Canonical Props Explorer URL. Serving uses game_id + date (ET). */
export function propsExplorerHref(input: {
  date?: string | null;
  gameId?: string | number | null;
}): string {
  const params = new URLSearchParams();
  const date = ymd(input.date);
  const gameId = id(input.gameId);
  if (date) params.set('date', date);
  if (gameId) params.set('game_id', gameId);
  const qs = params.toString();
  return qs ? `/betting/props-explorer?${qs}` : '/betting/props-explorer';
}

/** Player research page with enough return context for Explorer/game. */
export function playerResearchHref(input: ResearchJourneyParams): string {
  const playerId = id(input.playerId);
  if (!playerId) return '/betting';
  const params = new URLSearchParams();
  params.set('from', 'explorer');
  const date = ymd(input.date);
  const gameId = id(input.gameId);
  if (date) params.set('date', date);
  if (gameId) params.set('game_id', gameId);
  const propType = (input.propType ?? '').trim();
  if (propType) params.set('prop_type', propType);
  const side = (input.side ?? '').trim();
  if (side) params.set('side', side);
  const sportsbook = (input.sportsbook ?? '').trim();
  if (sportsbook) params.set('sportsbook', sportsbook);
  if (input.lineValue != null && String(input.lineValue) !== '') {
    params.set('line', String(input.lineValue));
  }
  return `/betting/players/${encodeURIComponent(playerId)}?${params.toString()}`;
}

export type PlayerReturnContext = {
  from: 'explorer' | null;
  date: string | null;
  gameId: string | null;
  propType: string | null;
  side: string | null;
  sportsbook: string | null;
  lineValue: string | null;
};

export function parsePlayerReturnContext(
  sp: Record<string, string | string[] | undefined> | URLSearchParams
): PlayerReturnContext {
  const get = (key: string): string | null => {
    if (sp instanceof URLSearchParams) {
      const v = sp.get(key)?.trim();
      return v ? v : null;
    }
    const raw = sp[key];
    const v = Array.isArray(raw) ? raw[0] : raw;
    const t = (v ?? '').trim();
    return t ? t : null;
  };
  return {
    from: get('from') === 'explorer' ? 'explorer' : null,
    date: ymd(get('date')),
    gameId: get('game_id'),
    propType: get('prop_type'),
    side: get('side'),
    sportsbook: get('sportsbook'),
    lineValue: get('line'),
  };
}

export function explorerReturnHref(ctx: PlayerReturnContext): string {
  return propsExplorerHref({ date: ctx.date, gameId: ctx.gameId });
}

export function slateHref(date?: string | null): string {
  const d = ymd(date);
  return d ? `/betting?date=${d}` : '/betting';
}

export function explorerGamesApiHref(input: { dateEt: string; todayEt: string }): string {
  const params = new URLSearchParams();
  params.set('date', input.dateEt);
  params.set('scope', 'explorer');
  if (resolvePropsMarketContext({ dateEt: input.dateEt, todayEt: input.todayEt }) === 'historical') {
    params.set('picker', 'calendar');
  }
  return `/api/betting/games?${params.toString()}`;
}
