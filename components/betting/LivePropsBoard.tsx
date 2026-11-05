'use client';

import { useEffect, useMemo, useState } from 'react';
import { Radio } from 'lucide-react';
import {
  blowoutRisk,
  gameElapsedMinutes,
  gameMinutesLeft,
  LIVE_STATUS_COPY,
  progressRatio,
  sortLiveProps,
  type LivePropRow,
  type LivePropSort,
  type LivePropStatus,
} from '@/lib/betting/live-props';
import type { LivePropsResponse } from '@/lib/betting/live-props-response';
import { freshnessAgeLabel } from '@/lib/scoreboard/game-pulse';
import { formatMovementOdds } from '@/lib/betting/props-explorer-movement';
import { playerResearchHref } from '@/lib/betting/research-journey';
import Link from 'next/link';

/** Matches the scoreboard's live box polling (about once a minute). */
const LIVE_REFRESH_MS = 60_000;

export type LiveGameHeader = NonNullable<LivePropsResponse['game']>;

/** Fetches the live board, re-reading every minute while the game is in progress and the tab is visible. */
export function useLiveProps(gameId: string): { data: LivePropsResponse | null; error: boolean } {
  const [data, setData] = useState<LivePropsResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      let phase: string | null = null;
      try {
        const res = await fetch(`/api/betting/games/${gameId}/live-props`, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as LivePropsResponse;
        phase = body.game?.phase ?? null;
        if (!cancelled) {
          setData(body);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
      // Pregame games are re-read too, so the board appears at tip without a reload.
      if (!cancelled && phase !== 'final' && phase !== 'other') {
        timer = setTimeout(tick, LIVE_REFRESH_MS);
      }
    }

    function tick() {
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(tick, LIVE_REFRESH_MS);
        return;
      }
      void load();
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gameId]);

  return { data, error };
}

const STATUS_STYLE: Record<LivePropStatus, { pill: string; bar: string }> = {
  hit: { pill: 'bg-[#dcfce7] text-[#166534] border-[#86efac]', bar: 'bg-[#16a34a]' },
  on_pace: { pill: 'bg-[#e6f6f1] text-[#075B5C] border-[#55ddb1]', bar: 'bg-[#2bb58a]' },
  behind: { pill: 'bg-[#fff7ed] text-[#9a3412] border-[#fdba74]', bar: 'bg-[#f59e0b]' },
  too_early: { pill: 'bg-[#F8FBFA] text-[#4a6366] border-[#DCE9EA]', bar: 'bg-[#94a3b8]' },
  not_in: { pill: 'bg-[#F8FBFA] text-[#4a6366] border-[#DCE9EA]', bar: 'bg-[#cbd5e1]' },
  missed: { pill: 'bg-[#fef2f2] text-[#991b1b] border-[#fca5a5]', bar: 'bg-[#dc2626]' },
};

const FILTERS: Array<{ id: string; label: string; types: string[] | null }> = [
  { id: 'all', label: 'All', types: null },
  { id: 'points', label: 'PTS', types: ['points'] },
  { id: 'rebounds', label: 'REB', types: ['rebounds'] },
  { id: 'assists', label: 'AST', types: ['assists'] },
  { id: 'threes', label: '3PM', types: ['threes'] },
  { id: 'combos', label: 'Combos', types: ['points_rebounds_assists', 'points_rebounds', 'points_assists', 'rebounds_assists'] },
];

const SORTS: Array<{ id: LivePropSort; label: string }> = [
  { id: 'closest', label: 'Closest to hitting' },
  { id: 'behind', label: 'Furthest behind' },
  { id: 'player', label: 'Player' },
];

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const PREGAME_PRICE_TITLE =
  'Median price at this line across the books whose main line it was, from the last pull before tip. Over % removes the vig. These are not live odds.';

/** "Pregame O −120 / U +100 · 52% over", or null when no book priced both sides of the line. */
export function pregamePriceLabel(row: Pick<LivePropRow, 'overOdds' | 'underOdds' | 'overProb'>): string | null {
  if (row.overOdds == null || row.underOdds == null) return null;
  const pct = row.overProb != null ? ` · ${Math.round(row.overProb * 100)}% over` : '';
  return `Pregame O ${formatMovementOdds(row.overOdds)} / U ${formatMovementOdds(row.underOdds)}${pct}`;
}

function teamAbbr(game: LiveGameHeader, teamId: string | null): string | null {
  if (teamId == null) return null;
  if (teamId === game.home.teamId) return game.home.abbr;
  if (teamId === game.visitor.teamId) return game.visitor.abbr;
  return null;
}

function detailLine(row: LivePropRow): string {
  const parts: string[] = [];
  if (row.status === 'hit') parts.push('Cleared');
  else if (row.needed != null && row.status !== 'not_in') parts.push(`Needs ${row.needed} more`);
  if (row.projected != null) parts.push(`pace ${fmt(Math.round(row.projected * 10) / 10)}`);
  if (row.minutesPlayed != null && row.minutesPlayed > 0) {
    const played = Math.round(row.minutesPlayed);
    parts.push(row.typicalMinutes != null ? `${played} of ~${Math.round(row.typicalMinutes)} min` : `${played} min`);
  }
  return parts.join(' · ');
}

function LivePropCard({ row, game }: { row: LivePropRow; game: LiveGameHeader }) {
  const style = STATUS_STYLE[row.status];
  const pct = Math.min(100, Math.round(progressRatio(row) * 100));
  const paceMark =
    row.projected != null && row.line > 0 ? Math.min(100, Math.round((row.projected / row.line) * 100)) : null;
  const abbr = teamAbbr(game, row.teamId);
  return (
    <li className="rounded-xl border border-[#DCE9EA] bg-white px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={playerResearchHref({ playerId: row.playerId, gameId: game.gameId })}
            className="block truncate text-sm font-semibold text-[#063f46] hover:text-[#075B5C] hover:underline"
          >
            {row.playerName}
          </Link>
          <p className="type-metadata truncate">
            {abbr ? `${abbr} · ` : ''}
            {row.propLabel}
          </p>
        </div>
        <span className={`type-badge shrink-0 rounded-full border px-2 py-0.5 ${style.pill}`}>{LIVE_STATUS_COPY[row.status]}</span>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className="tabular-nums text-[#063f46]">
          <span className="text-lg font-bold">{row.current ?? '—'}</span>
          <span className="type-secondary"> / {fmt(row.line)} {row.propShort}</span>
        </p>
        {pregamePriceLabel(row) ? (
          <p
            className="type-metadata shrink-0 text-right tabular-nums"
            title={PREGAME_PRICE_TITLE}
            data-pregame-price
          >
            {pregamePriceLabel(row)}
          </p>
        ) : null}
      </div>
      <div
        className="relative mt-1.5 h-2 rounded-full bg-[#EEF4F3]"
        role="img"
        aria-label={`${row.current ?? 0} of ${fmt(row.line)}${row.projected != null ? `, on pace for ${fmt(Math.round(row.projected * 10) / 10)}` : ''}`}
      >
        <div className={`h-2 rounded-full ${style.bar}`} style={{ width: `${pct}%` }} />
        {paceMark != null && row.status !== 'hit' ? (
          <div
            className="absolute top-[-3px] h-[14px] w-[2px] rounded bg-[#063f46]/60"
            style={{ left: `calc(${paceMark}% - 1px)` }}
            title="Pace at the final buzzer"
          />
        ) : null}
      </div>
      <p className="type-metadata mt-1.5">{detailLine(row) || ' '}</p>
    </li>
  );
}

/**
 * Follow-live board for the game page: every player prop's pregame consensus line against his live
 * box score. Renders nothing before tip or when the scoreboard has no row for the game.
 */
export function LivePropsBoard({ data, error }: { data: LivePropsResponse | null; error: boolean }) {
  const [sort, setSort] = useState<LivePropSort>('closest');
  const [filter, setFilter] = useState('all');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const game = data?.game ?? null;
  const rows = useMemo(() => {
    const types = FILTERS.find((f) => f.id === filter)?.types ?? null;
    const all = data?.rows ?? [];
    return sortLiveProps(types ? all.filter((r) => types.includes(r.propType)) : all, sort);
  }, [data, filter, sort]);

  if (!game || game.phase !== 'live') return null;

  const margin =
    game.home.score != null && game.visitor.score != null ? game.home.score - game.visitor.score : null;
  const left = gameMinutesLeft(game.period, gameElapsedMinutes(game.period, game.clockLabel));
  const risk = blowoutRisk(margin, game.period, left);
  const freshness = freshnessAgeLabel(game.boxObservedAt, nowMs);
  const counts = (data?.rows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-2xl overflow-hidden border border-[#DCE9EA] shadow-sm">
      <div className="px-3 py-2.5 border-b border-[#DCE9EA] bg-[#F8FBFA]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="type-section-heading flex items-center gap-1.5 text-[#063f46]">
            <Radio className="h-4 w-4 text-[#dc2626]" aria-hidden />
            Live props
          </h2>
          <p className="type-metadata tabular-nums">
            <span className="font-semibold text-[#063f46]">
              {game.visitor.abbr} {game.visitor.score ?? '—'} – {game.home.score ?? '—'} {game.home.abbr}
            </span>
            {' · '}
            {game.clockLabel ?? 'Halftime'}
            {freshness ? ` · ${freshness}` : ''}
          </p>
        </div>
        <p className="type-metadata mt-0.5">
          {counts.hit ?? 0} hit · {counts.on_pace ?? 0} on pace · {counts.behind ?? 0} behind. Lines are the pregame
          consensus main line across books, with its pregame price. There are no in-game odds.
        </p>
      </div>

      {risk ? (
        <p
          className={`type-secondary border-b px-3 py-2 ${
            risk.level === 'high' ? 'border-[#fca5a5] bg-[#fef2f2] text-[#991b1b]' : 'border-[#fdba74] bg-[#fff7ed] text-[#9a3412]'
          }`}
        >
          Blowout risk: {risk.text}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[#DCE9EA]">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Prop type">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`type-interactive rounded-lg border px-2.5 py-1 transition-colors ${
                filter === f.id
                  ? 'border-[#063f46] bg-[#063f46] text-white'
                  : 'border-[#DCE9EA] bg-white text-[#4a6366] hover:text-[#063f46]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="type-metadata flex items-center gap-1.5">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as LivePropSort)}
            className="type-interactive rounded-lg border border-[#DCE9EA] bg-white px-2 py-1 text-[#063f46]"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="p-3">
        {rows.length === 0 ? (
          <p className="type-secondary py-6 text-center">
            {error ? 'Live props are temporarily unavailable.' : 'No pregame lines for points, rebounds, assists or threes in this game.'}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <LivePropCard key={`${r.playerId}-${r.propType}`} row={r} game={game} />
            ))}
          </ul>
        )}
        <p className="type-metadata mt-3">
          Pace assumes his current per-minute rate over his usual minutes (last 10 games), capped by the game clock. The
          live box score refreshes about once a minute and has no steals, blocks or fouls.
        </p>
      </div>
    </div>
  );
}
