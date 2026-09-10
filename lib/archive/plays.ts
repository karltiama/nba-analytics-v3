/**
 * Step 9D Plays characterization (10 games). Non-canonical prefix only.
 * Live docs: GET /v1/plays?game_id=
 * OpenAPI:   GET /nba/v1/plays?game_id=
 * Prefer /nba/v1/plays (matches lineups / season averages). Fall back to /v1/plays on 404.
 */

export const PLAYS_PATH_PRIMARY = '/nba/v1/plays';
export const PLAYS_PATH_DOCS_FALLBACK = '/v1/plays';

export const PLAYS_CHAR_PREFIX =
  'raw/source=balldontlie/league=nba/season=2025/entity=plays/_characterization_10game';

export const PLAYS_SAMPLE_N = 10;
export const PLAYS_MAX_PAGES_PER_GAME = 12;
export const PLAYS_MAX_HTTP = 46;
export const PLAYS_MAX_PROVIDER_MS = 10 * 60 * 1000;

export type PlaysGameRow = {
  game_id: string;
  start_time: Date | null;
  status: string | null;
  home_team_id: string;
  away_team_id: string;
  home_abbr: string;
  away_abbr: string;
  home_score: number | null;
  away_score: number | null;
  postseason: boolean | null;
  period: number | null;
  period_detail: string | null;
  log_n: number;
  has_props: boolean;
  injury_out_n: number;
  max_min: number | null;
};

export type PlaysSampleGame = {
  gameId: string;
  date: string | null;
  matchup: string;
  phase: string;
  reasonSelected: string;
  traits: string[];
  postseason: boolean | null;
  homeScore: number | null;
  awayScore: number | null;
  margin: number | null;
  period: number | null;
  hasProps: boolean;
  injuryOutN: number;
  maxMin: number | null;
  homeTeamId: string;
  awayTeamId: string;
  homeAbbr: string;
  awayAbbr: string;
  startTime: string | null;
};

function etDate(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function isPostseason(g: PlaysGameRow): boolean {
  if (g.postseason === true) return true;
  if (g.postseason === false) return false;
  const d = etDate(g.start_time);
  return d != null && d >= '2026-04-18';
}

function isOt(g: PlaysGameRow): boolean {
  if (g.period != null && g.period >= 5) return true;
  if ((g.period_detail ?? '').toUpperCase().includes('OT')) return true;
  if (g.max_min != null && g.max_min > 48) return true;
  return false;
}

function margin(g: PlaysGameRow): number | null {
  if (g.home_score == null || g.away_score == null) return null;
  return Math.abs(g.home_score - g.away_score);
}

function totalPts(g: PlaysGameRow): number {
  return (g.home_score ?? 0) + (g.away_score ?? 0);
}

function takeFirst(rows: PlaysGameRow[], used: Set<string>): PlaysGameRow | null {
  const g = rows.find((r) => !used.has(r.game_id));
  if (!g) return null;
  used.add(g.game_id);
  return g;
}

function toSample(g: PlaysGameRow, phase: string, reason: string, traits: string[]): PlaysSampleGame {
  return {
    gameId: g.game_id,
    date: etDate(g.start_time),
    matchup: `${g.away_abbr} @ ${g.home_abbr}`,
    phase,
    reasonSelected: reason,
    traits,
    postseason: g.postseason,
    homeScore: g.home_score,
    awayScore: g.away_score,
    margin: margin(g),
    period: g.period,
    hasProps: g.has_props,
    injuryOutN: g.injury_out_n,
    maxMin: g.max_min,
    homeTeamId: g.home_team_id,
    awayTeamId: g.away_team_id,
    homeAbbr: g.home_abbr,
    awayAbbr: g.away_abbr,
    startTime: g.start_time ? g.start_time.toISOString() : null,
  };
}

/**
 * Deterministic 10-game freeze from local rows. No provider discovery.
 * Games may have extra traits; IDs stay distinct.
 */
export function selectPlaysSample(games: PlaysGameRow[], inventoryIds: Set<string>): PlaysSampleGame[] {
  const complete = games.filter(
    (g) => g.log_n >= 12 && inventoryIds.has(g.game_id) && g.home_score != null && g.away_score != null
  );
  const used = new Set<string>();
  const rs = complete.filter((g) => !isPostseason(g));
  const post = complete.filter((g) => isPostseason(g));
  const out: PlaysSampleGame[] = [];

  const push = (g: PlaysGameRow | null, phase: string, reason: string, traits: string[]) => {
    if (!g) throw new Error(`Plays sample: could not fill slot ${phase}`);
    out.push(toSample(g, phase, reason, traits));
  };

  const normalRs = rs
    .filter((g) => !isOt(g) && (margin(g) ?? 0) >= 10 && (g.log_n ?? 0) >= 18)
    .sort((a, b) => String(a.start_time ?? '').localeCompare(String(b.start_time ?? '')) || a.game_id.localeCompare(b.game_id));
  push(takeFirst(normalRs, used), 'regular_season_normal', 'Typical regulation RS game (margin>=10, not OT)', [
    'normal_rs',
  ]);
  push(takeFirst(normalRs, used), 'regular_season_normal', 'Second typical regulation RS game', ['normal_rs']);

  const ot = complete
    .filter((g) => isOt(g))
    .sort((a, b) => (b.period ?? 0) - (a.period ?? 0) || (b.max_min ?? 0) - (a.max_min ?? 0) || a.game_id.localeCompare(b.game_id));
  const otPick = takeFirst(ot, used);
  push(
    otPick,
    'overtime',
    `OT sample period=${otPick?.period ?? 'n/a'} max_min=${otPick?.max_min ?? 'n/a'}`,
    ['overtime']
  );

  const close = complete
    .filter((g) => (margin(g) ?? 99) <= 5)
    .sort((a, b) => (margin(a) ?? 99) - (margin(b) ?? 99) || a.game_id.localeCompare(b.game_id));
  push(takeFirst(close, used), 'close', 'Final margin <=5', ['close']);
  push(takeFirst(close, used), 'close', 'Second close game, margin <=5', ['close']);

  const high = [...rs].sort((a, b) => totalPts(b) - totalPts(a) || a.game_id.localeCompare(b.game_id));
  const highPick = takeFirst(high, used);
  push(
    highPick,
    'high_scoring',
    `High combined score ${highPick?.home_score}-${highPick?.away_score}`,
    ['high_event']
  );

  const injury = complete
    .filter((g) => g.injury_out_n > 0)
    .sort((a, b) => b.injury_out_n - a.injury_out_n || a.game_id.localeCompare(b.game_id));
  const injPick = takeFirst(injury, used);
  push(
    injPick,
    'injury_replacement',
    `Local Out snapshots near tip=${injPick?.injury_out_n}; overlap with lineup archive`,
    ['injury', 'lineup']
  );

  const props = complete.filter((g) => g.has_props).sort((a, b) => a.game_id.localeCompare(b.game_id));
  const propPick = takeFirst(props, used);
  push(propPick, 'prop_research', 'Overlaps research.prop_decision_lines', ['props']);

  const earlyPo = post
    .filter((g) => {
      const d = etDate(g.start_time);
      return d != null && d >= '2026-04-18' && d <= '2026-04-30';
    })
    .sort((a, b) => String(a.start_time ?? '').localeCompare(String(b.start_time ?? '')) || a.game_id.localeCompare(b.game_id));
  const earlyPool = earlyPo.length ? earlyPo : post;
  push(takeFirst(earlyPool, used), 'early_playoffs', 'Early postseason window', ['playoffs_early']);

  const laterPo = post
    .filter((g) => {
      const d = etDate(g.start_time);
      return d != null && d >= '2026-05-15';
    })
    .sort((a, b) => String(b.start_time ?? '').localeCompare(String(a.start_time ?? '')) || a.game_id.localeCompare(b.game_id));
  const laterPool = laterPo.length ? laterPo : [...post].reverse();
  push(takeFirst(laterPool, used), 'later_postseason', 'Later postseason game', ['playoffs_later']);

  if (out.length !== PLAYS_SAMPLE_N) {
    throw new Error(`Plays sample size ${out.length} != ${PLAYS_SAMPLE_N}`);
  }
  return out;
}

export function playsCharKey(gameId: string): string {
  return `${PLAYS_CHAR_PREFIX}/game_id=${gameId}.json`;
}

export const PLAYS_2025_ENTITY = 'plays';
export const PLAYS_2025_EXPECTED_TARGET = 1322;
export const PLAYS_2025_MAX_CRAWL_MS = 6 * 60 * 60 * 1000;
export const PLAYS_2025_STARTER_ANOMALY_IDS = ['18447931', '18447988'] as const;
export const PLAYS_2025_AVAILABILITY_LIMITATION =
  'IN/OUT is inferred from the current five-man state, not a labeled provider field. Possession boundaries, participant roles, shot geometry, WOWY, and active-roster status are not certified.';

export type PlaysArchiveJson = Record<string, unknown>;

export function plays2025CanonicalPrefix(): string {
  const raw = (process.env.NBA_RAW_PREFIX ?? 'raw').replace(/^\/+|\/+$/g, '') || 'raw';
  return `${raw}/source=balldontlie/league=nba/season=2025/entity=${PLAYS_2025_ENTITY}`;
}

export function plays2025GameObjectKey(prefix: string, gameId: string): string {
  return `${prefix}/game_id=${gameId}.json`;
}

function sidPlay(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export function extractPlayRows(body: unknown): PlaysArchiveJson[] {
  if (!body || typeof body !== 'object') return [];
  const obj = body as PlaysArchiveJson;
  if (Array.isArray(obj.data)) return obj.data as PlaysArchiveJson[];
  if (!Array.isArray(obj.pages)) return [];
  const rows: PlaysArchiveJson[] = [];
  for (const p of obj.pages as unknown[]) {
    if (!p || typeof p !== 'object') continue;
    const page = p as PlaysArchiveJson;
    const inner =
      page.body && typeof page.body === 'object' && !Array.isArray(page.body)
        ? (page.body as PlaysArchiveJson)
        : page;
    if (Array.isArray(inner.data)) rows.push(...(inner.data as PlaysArchiveJson[]));
  }
  return rows;
}

/** Canonical/characterization objects must preserve raw page envelopes. */
export function validatePlaysArchiveBody(gameId: string, body: unknown): { ok: boolean; reason: string } {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'not_object' };
  const obj = body as PlaysArchiveJson;
  const labeled = sidPlay(obj.game_id);
  if (labeled && labeled !== String(gameId)) return { ok: false, reason: 'game_id_mismatch' };
  if (!Array.isArray(obj.pages) && !Array.isArray(obj.data)) {
    return { ok: false, reason: 'missing_pages_or_data' };
  }
  if (obj.truncated === true) return { ok: false, reason: 'truncated' };
  if (Array.isArray(obj.pages)) {
    for (const p of obj.pages as unknown[]) {
      if (!p || typeof p !== 'object') continue;
      const page = p as PlaysArchiveJson;
      if (page.status != null && Number(page.status) !== 200) {
        return { ok: false, reason: `http_${String(page.status)}` };
      }
    }
  }
  const rows = extractPlayRows(body);
  for (const r of rows) {
    const rowGame = sidPlay(r.game_id);
    if (rowGame && rowGame !== String(gameId)) return { ok: false, reason: 'row_game_id_mismatch' };
  }
  return { ok: true, reason: 'ok' };
}

export function classifyRotationReliability(success: number, eligible: number): {
  classification: 'EXCELLENT' | 'GOOD' | 'MIXED' | 'POOR';
  pct: number | null;
} {
  const pct = eligible > 0 ? Math.round((10000 * success) / eligible) / 100 : null;
  if (pct == null) return { classification: 'POOR', pct };
  if (pct >= 99) return { classification: 'EXCELLENT', pct };
  if (pct >= 95) return { classification: 'GOOD', pct };
  if (pct >= 90) return { classification: 'MIXED', pct };
  return { classification: 'POOR', pct };
}
