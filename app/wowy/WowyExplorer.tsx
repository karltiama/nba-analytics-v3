'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
import { UnauthorizedPanel } from '@/components/betting/UnauthorizedPanel';
import { gameDetailHref } from '@/lib/betting/research-journey';
import { formatNbaSeasonLabel } from '@/lib/season';
import type {
  WowyClassifiedGame,
  WowyPairSummary,
  WowyPlayerIdentity,
  WowySeasonType,
  WowyTeamStintOption,
  WowyTeammateOption,
} from '@/lib/wowy/types';
import { WOWY_STAT_KEYS } from '@/lib/wowy/types';

const SEASONS = ['2025', '2024', '2023'] as const;

const STAT_LABEL: Record<(typeof WOWY_STAT_KEYS)[number], string> = {
  minutes: 'MIN',
  pts: 'PTS',
  reb: 'REB',
  ast: 'AST',
  tpm: '3PM',
  fga: 'FGA',
  tpa: '3PA',
  fta: 'FTA',
};

type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unauthorized' | 'unavailable';

function fmt(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function pct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const signed = value >= 0 ? '+' : '';
  return `${signed}${(value * 100).toFixed(0)}%`;
}

function rateFmt(
  group: WowyPairSummary['with'],
  key: (typeof WOWY_STAT_KEYS)[number]
): string {
  if (key === 'minutes') return '—';
  return fmt(group.perMinute[key], 3);
}

function signed(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
}

export function WowyExplorer({
  initialSubjectId,
  initialTeammateId,
  initialSeason,
  initialTeamId,
  initialSeasonType,
}: {
  initialSubjectId: string;
  initialTeammateId: string;
  initialSeason: string;
  initialTeamId: string;
  initialSeasonType: WowySeasonType | 'all';
}) {
  const pathname = usePathname() || '/wowy';

  const [playerQuery, setPlayerQuery] = useState('');
  const [playerHits, setPlayerHits] = useState<WowyPlayerIdentity[]>([]);
  const [subject, setSubject] = useState<WowyPlayerIdentity | null>(null);
  const [teammate, setTeammate] = useState<WowyTeammateOption | null>(null);
  const [season, setSeason] = useState(SEASONS.includes(initialSeason as (typeof SEASONS)[number]) ? initialSeason : '2025');
  const [teamId, setTeamId] = useState(initialTeamId);
  const [seasonType, setSeasonType] = useState<WowySeasonType | 'all'>(initialSeasonType);
  const [teams, setTeams] = useState<WowyTeamStintOption[]>([]);
  const [teammates, setTeammates] = useState<WowyTeammateOption[]>([]);
  const [summary, setSummary] = useState<WowyPairSummary | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<'with' | 'without'>('with');

  useEffect(() => {
    const q = playerQuery.trim();
    if (q.length < 2) {
      setPlayerHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void fetch(`/api/wowy/players?q=${encodeURIComponent(q)}`)
        .then(async (res) => {
          if (res.status === 401) return;
          const data = await res.json();
          setPlayerHits(data.players ?? []);
        })
        .catch(() => setPlayerHits([]));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [playerQuery]);

  const loadContext = useCallback(
    async (playerId: string, nextSeason: string, nextTeamId: string) => {
      const res = await fetch(
        `/api/wowy/context?playerId=${encodeURIComponent(playerId)}&season=${encodeURIComponent(nextSeason)}${
          nextTeamId ? `&teamId=${encodeURIComponent(nextTeamId)}` : ''
        }`
      );
      if (res.status === 401) {
        setState('unauthorized');
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to load player context');
        setState(res.status === 422 ? 'unavailable' : 'error');
        return;
      }
      setSubject(data.player);
      setTeams(data.teams ?? []);
      const resolvedTeam =
        nextTeamId && (data.teams ?? []).some((t: WowyTeamStintOption) => t.teamId === nextTeamId)
          ? nextTeamId
          : data.teams?.[0]?.teamId ?? '';
      setTeamId(resolvedTeam);
      if (resolvedTeam && resolvedTeam !== nextTeamId) {
        const again = await fetch(
          `/api/wowy/context?playerId=${encodeURIComponent(playerId)}&season=${encodeURIComponent(nextSeason)}&teamId=${encodeURIComponent(resolvedTeam)}`
        );
        const againData = await again.json();
        setTeammates(againData.teammates ?? []);
      } else {
        setTeammates(data.teammates ?? []);
      }
    },
    []
  );

  useEffect(() => {
    if (!initialSubjectId) return;
    void loadContext(initialSubjectId, season, initialTeamId);
    // Hydrate once from the URL; later season/team changes are user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSubjectId, loadContext]);

  const selectedTeam = teams.find((t) => t.teamId === teamId) ?? null;

  useEffect(() => {
    if (!subject || !teamId) {
      setTeammates([]);
      return;
    }
    void fetch(
      `/api/wowy/context?playerId=${encodeURIComponent(subject.playerId)}&season=${encodeURIComponent(season)}&teamId=${encodeURIComponent(teamId)}`
    )
      .then((res) => res.json())
      .then((data) => setTeammates(data.teammates ?? []))
      .catch(() => setTeammates([]));
  }, [subject, season, teamId]);

  useEffect(() => {
    if (!initialTeammateId || teammates.length === 0) return;
    const match = teammates.find((t) => t.playerId === initialTeammateId);
    if (match) setTeammate(match);
  }, [initialTeammateId, teammates]);

  const runPair = useCallback(async () => {
    if (!subject || !teammate || !teamId) {
      setSummary(null);
      setState('idle');
      return;
    }
    setState('loading');
    setError(null);
    const params = new URLSearchParams({
      subjectPlayerId: subject.playerId,
      teammatePlayerId: teammate.playerId,
      season,
      teamId,
      seasonType,
    });
    try {
      const res = await fetch(`/api/wowy/pair?${params.toString()}`);
      if (res.status === 401) {
        setState('unauthorized');
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setSummary(null);
        setError(data.error ?? 'Unable to load comparison');
        setState(res.status === 422 ? 'unavailable' : 'error');
        return;
      }
      const next = data.summary as WowyPairSummary;
      setSummary(next);
      setState(next.with.gameCount + next.without.gameCount === 0 ? 'empty' : 'ready');
      const nextUrl = `${pathname}?subject=${encodeURIComponent(subject.playerId)}&teammate=${encodeURIComponent(teammate.playerId)}&season=${encodeURIComponent(season)}&teamId=${encodeURIComponent(teamId)}&seasonType=${encodeURIComponent(seasonType)}`;
      window.history.replaceState(null, '', nextUrl);
    } catch (e) {
      setSummary(null);
      setError(e instanceof Error ? e.message : 'Failed to load comparison');
      setState('error');
    }
  }, [pathname, season, seasonType, subject, teamId, teammate]);

  useEffect(() => {
    void runPair();
  }, [runPair]);

  const drillGames: WowyClassifiedGame[] = useMemo(() => {
    if (!summary) return [];
    return summary.classifiedGames.filter((g) => g.bucket === drill);
  }, [drill, summary]);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <header className="space-y-2">
        <p className="text-xs text-[#4a6366]">
          <Link href="/betting" className="text-[#075B5C] hover:underline">
            Dashboard
          </Link>
          <span className="mx-1.5 text-[#DCE9EA]">/</span>
          Game-level WOWY
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold text-[#063f46] tracking-tight">Game-level WOWY</h1>
        <p className="text-sm text-[#4a6366] max-w-3xl">
          Compare how a player performed in games a teammate played versus games that teammate had a verified
          did-not-play roster row. This is game-level participation, not shared-court possessions. Both players
          appearing in a game does not mean they shared the floor. Historical exploration is separate from current
          availability — a selected teammate is not implied to be injured.
        </p>
      </header>

      <section className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <label className="block space-y-1.5 relative">
            <span className="text-xs font-semibold text-[#4a6366]">Player</span>
            <input
              value={subject ? subject.fullName : playerQuery}
              onChange={(e) => {
                setSubject(null);
                setTeammate(null);
                setSummary(null);
                setPlayerQuery(e.target.value);
              }}
              placeholder="Search a player"
              className="w-full rounded-lg border border-[#DCE9EA] bg-white px-3 py-2 text-sm text-[#063f46]"
            />
            {!subject && playerHits.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full rounded-lg border border-[#DCE9EA] bg-white shadow-lg max-h-64 overflow-auto">
                {playerHits.map((hit) => (
                  <li key={hit.playerId}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[#f7f9f7]"
                      onClick={() => {
                        setSubject(hit);
                        setPlayerQuery('');
                        setPlayerHits([]);
                        setTeammate(null);
                        void loadContext(hit.playerId, season, '');
                      }}
                    >
                      {hit.fullName}
                      {hit.position ? <span className="text-[#8aa0a3]"> · {hit.position}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[#4a6366]">Season</span>
            <select
              value={season}
              onChange={(e) => {
                const next = e.target.value;
                setSeason(next);
                setTeammate(null);
                setTeamId('');
                if (subject) void loadContext(subject.playerId, next, '');
              }}
              className="w-full rounded-lg border border-[#DCE9EA] bg-white px-3 py-2 text-sm text-[#063f46]"
            >
              {SEASONS.map((s) => (
                <option key={s} value={s}>
                  {formatNbaSeasonLabel(s)}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[#4a6366]">Team stint</span>
            <select
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setTeammate(null);
              }}
              disabled={!subject || teams.length === 0}
              className="w-full rounded-lg border border-[#DCE9EA] bg-white px-3 py-2 text-sm text-[#063f46] disabled:bg-[#f7f9f7]"
            >
              {teams.length === 0 ? <option value="">Select a player first</option> : null}
              {teams.map((team) => (
                <option key={team.teamId} value={team.teamId}>
                  {team.abbreviation} · {team.gameCount} Final games
                </option>
              ))}
            </select>
            {selectedTeam ? (
              <p className="text-[11px] text-[#8aa0a3]">
                Game-log coverage {selectedTeam.firstGameDate} to {selectedTeam.lastGameDate}. Not a verified trade
                date.
              </p>
            ) : null}
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[#4a6366]">Season type</span>
            <select
              value={seasonType}
              onChange={(e) => setSeasonType(e.target.value as WowySeasonType | 'all')}
              className="w-full rounded-lg border border-[#DCE9EA] bg-white px-3 py-2 text-sm text-[#063f46]"
            >
              <option value="regular">Regular season</option>
              <option value="playoffs">Playoffs</option>
            </select>
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-[#4a6366]">Historically valid teammate</span>
          <select
            value={teammate?.playerId ?? ''}
            onChange={(e) => {
              const next = teammates.find((t) => t.playerId === e.target.value) ?? null;
              setTeammate(next);
            }}
            disabled={!subject || !teamId || teammates.length === 0}
            className="w-full rounded-lg border border-[#DCE9EA] bg-white px-3 py-2 text-sm text-[#063f46] disabled:bg-[#f7f9f7]"
          >
            <option value="">{teammates.length ? 'Choose a teammate' : 'No same-team game-log overlap yet'}</option>
            {teammates.map((t) => (
              <option key={t.playerId} value={t.playerId}>
                {t.fullName} · {t.togetherPlayedGames} together / {t.verifiedDnpGames} verified DNP
              </option>
            ))}
          </select>
        </label>
      </section>

      {state === 'unauthorized' && <UnauthorizedPanel onRetry={() => void runPair()} />}
      {state === 'loading' && (
        <div className="bg-white border border-[#DCE9EA] rounded-2xl p-8 text-sm text-[#4a6366]">Loading comparison…</div>
      )}
      {state === 'error' && (
        <div className="bg-white border border-[#DCE9EA] rounded-2xl p-6 text-sm text-red-800">
          {error ?? 'Something went wrong.'}
        </div>
      )}
      {state === 'unavailable' && (
        <div className="bg-white border border-[#DCE9EA] rounded-2xl p-6 space-y-2">
          <h2 className="text-sm font-semibold text-[#063f46]">Unavailable data</h2>
          <p className="text-sm text-[#4a6366]">{error ?? 'This pair cannot be classified with current identity or coverage.'}</p>
        </div>
      )}
      {state === 'idle' && !subject && (
        <div className="bg-white border border-[#DCE9EA] rounded-2xl p-6 text-sm text-[#4a6366]">
          Select a player, team stint, and historically overlapping teammate to load a game-level comparison.
        </div>
      )}
      {state === 'empty' && summary && (
        <div className="bg-white border border-[#DCE9EA] rounded-2xl p-6 space-y-2">
          <h2 className="text-sm font-semibold text-[#063f46]">No eligible with/without games</h2>
          <p className="text-sm text-[#4a6366]">
            {summary.excludedCount} game(s) were classified but none met both-played or verified-DNP rules for this
            filter. Unknown cases stay out of the split ({summary.unknownMembershipCount} unknown membership).
          </p>
        </div>
      )}

      {state === 'ready' && summary && (
        <Results
          summary={summary}
          drill={drill}
          onDrill={setDrill}
          drillGames={drillGames}
        />
      )}

      <Methodology />
    </main>
  );
}

function Results({
  summary,
  drill,
  onDrill,
  drillGames,
}: {
  summary: WowyPairSummary;
  drill: 'with' | 'without';
  onDrill: (value: 'with' | 'without') => void;
  drillGames: WowyClassifiedGame[];
}) {
  const low = summary.support.tier !== 'adequate';
  const blocked = summary.support.tier === 'insufficient';

  return (
    <section className="space-y-6">
      <div
        className={`rounded-2xl border p-4 sm:p-5 ${
          blocked ? 'border-amber-300 bg-amber-50' : low ? 'border-amber-200 bg-amber-50/60' : 'border-[#DCE9EA] bg-white'
        }`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-[#4a6366]">Sample size</p>
        <p className="mt-1 text-lg font-semibold text-[#063f46]">
          With {summary.teammate.fullName}: {summary.with.gameCount} games · Without (verified DNP):{' '}
          {summary.without.gameCount} games
        </p>
        <p className="mt-1 text-sm text-[#4a6366]">{summary.support.label}</p>
        <p className="mt-2 text-xs text-[#8aa0a3]">
          Date coverage with: {summary.with.dateCoverage.first ?? '—'} → {summary.with.dateCoverage.last ?? '—'} ·
          without: {summary.without.dateCoverage.first ?? '—'} → {summary.without.dateCoverage.last ?? '—'} · unknown
          membership excluded: {summary.unknownMembershipCount}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GroupCard
          title={`With ${summary.teammate.fullName}`}
          blurb={`In these games, ${summary.subject.fullName} averaged…`}
          group={summary.with}
        />
        <GroupCard
          title={`Without ${summary.teammate.fullName}`}
          blurb={`In these games, ${summary.subject.fullName} averaged…`}
          group={summary.without}
          dnpNote="Verified did-not-play roster rows (minutes = 00). Not labeled as injury."
        />
      </div>

      {!blocked && (
        <div className="bg-white border border-[#DCE9EA] rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-6 py-3 border-b border-[#DCE9EA]">
            <h2 className="text-sm font-semibold text-[#063f46]">Descriptive difference (with − without)</h2>
            <p className="text-xs text-[#4a6366] mt-1">
              Raw differences only. Not a causal effect of the teammate missing, and not a projection multiplier.
              Opponents, other absences, role changes, and coaching decisions can contribute.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-[#4a6366] bg-[#f7f9f7]">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Stat</th>
                  <th className="text-right font-medium px-4 py-2">With / game</th>
                  <th className="text-right font-medium px-4 py-2">Without / game</th>
                  <th className="text-right font-medium px-4 py-2">Abs. diff</th>
                  <th className="text-right font-medium px-4 py-2">% diff</th>
                  <th className="text-right font-medium px-4 py-2">Per minute (with)</th>
                  <th className="text-right font-medium px-4 py-2">Per minute (without)</th>
                </tr>
              </thead>
              <tbody>
                {WOWY_STAT_KEYS.map((key) => (
                  <tr key={key} className="border-t border-[#DCE9EA]">
                    <td className="px-4 py-2 font-medium text-[#063f46]">{STAT_LABEL[key]}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(summary.with.perGame[key])}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(summary.without.perGame[key])}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{signed(summary.diff.absolutePerGame[key])}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{pct(summary.diff.percentPerGame[key])}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{rateFmt(summary.with, key)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{rateFmt(summary.without, key)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(!summary.with.perMinuteEligible || !summary.without.perMinuteEligible) && (
            <p className="px-4 sm:px-6 py-3 text-xs text-[#8aa0a3] border-t border-[#DCE9EA]">
              Per-minute rates are omitted when total valid minutes are 0. Counting totals / per-game averages are still
              shown.
            </p>
          )}
        </div>
      )}

      <div className="bg-white border border-[#DCE9EA] rounded-2xl">
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-b border-[#DCE9EA]">
          <h2 className="text-sm font-semibold text-[#063f46] mr-auto">Game-log drill-down</h2>
          <button
            type="button"
            onClick={() => onDrill('with')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              drill === 'with' ? 'bg-[#063f46] text-white' : 'bg-[#f7f9f7] text-[#4a6366]'
            }`}
          >
            With ({summary.with.gameCount})
          </button>
          <button
            type="button"
            onClick={() => onDrill('without')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              drill === 'without' ? 'bg-[#063f46] text-white' : 'bg-[#f7f9f7] text-[#4a6366]'
            }`}
          >
            Without ({summary.without.gameCount})
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-[#4a6366] bg-[#f7f9f7]">
              <tr>
                <th className="text-left font-medium px-4 py-2">Date</th>
                <th className="text-left font-medium px-4 py-2">Opp</th>
                <th className="text-right font-medium px-4 py-2">MIN</th>
                <th className="text-right font-medium px-4 py-2">PTS</th>
                <th className="text-right font-medium px-4 py-2">REB</th>
                <th className="text-right font-medium px-4 py-2">AST</th>
                <th className="text-right font-medium px-4 py-2">3PM</th>
                <th className="text-right font-medium px-4 py-2">FGA</th>
                <th className="text-left font-medium px-4 py-2">Game ID</th>
              </tr>
            </thead>
            <tbody>
              {drillGames.map((g) => (
                <tr key={g.gameId} className="border-t border-[#DCE9EA]">
                  <td className="px-4 py-2 tabular-nums">{g.basketballDateEt}</td>
                  <td className="px-4 py-2">{g.opponentAbbr ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.minutes, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.pts, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.reb, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.ast, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.tpm, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.fga, 0)}</td>
                  <td className="px-4 py-2">
                    <Link href={gameDetailHref(g.gameId)} className="text-[#075B5C] hover:underline font-mono text-xs">
                      {g.gameId}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function GroupCard({
  title,
  blurb,
  group,
  dnpNote,
}: {
  title: string;
  blurb: string;
  group: WowyPairSummary['with'];
  dnpNote?: string;
}) {
  return (
    <div className="bg-white border border-[#DCE9EA] rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex items-start gap-3">
        <PlayerHeadshot name={title} className="relative w-12 h-14 rounded-xl overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0" />
        <div>
          <h2 className="text-base font-semibold text-[#063f46]">{title}</h2>
          <p className="text-xs text-[#4a6366]">{blurb}</p>
          {dnpNote ? <p className="text-[11px] text-[#8aa0a3] mt-1">{dnpNote}</p> : null}
        </div>
      </div>
      <p className="text-sm text-[#063f46]">
        <span className="font-semibold tabular-nums">{group.gameCount}</span> games ·{' '}
        <span className="tabular-nums">{fmt(group.totalMinutes, 0)}</span> total minutes
      </p>
      <dl className="grid grid-cols-4 gap-2 text-center">
        {(['pts', 'reb', 'ast', 'minutes'] as const).map((key) => (
          <div key={key} className="rounded-lg bg-[#f7f9f7] px-2 py-2">
            <dt className="text-[10px] uppercase tracking-wide text-[#8aa0a3]">{STAT_LABEL[key]}</dt>
            <dd className="text-lg font-semibold tabular-nums text-[#063f46]">{fmt(group.perGame[key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Methodology() {
  return (
    <section className="bg-white border border-[#DCE9EA] rounded-2xl p-4 sm:p-6 space-y-3 text-sm text-[#4a6366]">
      <h2 className="text-base font-semibold text-[#063f46]">Coverage and methodology</h2>
      <ul className="list-disc pl-5 space-y-1.5">
        <li>
          <strong className="text-[#063f46]">With:</strong> subject played and teammate played, same team_id, Final
          game.
        </li>
        <li>
          <strong className="text-[#063f46]">Without:</strong> subject played and teammate has minutes = &quot;00&quot;
          (verified DNP roster row). DNP is not labeled as injury.
        </li>
        <li>
          A missing teammate row is <em>unknown</em>, not without. Absence is never inferred from a hole in the log.
        </li>
        <li>
          Team stints stay separate. Game-log team_id is night-of box membership. Roster stint dates are observations,
          not verified trade timestamps; inferred_pgl stints are game-derived.
        </li>
        <li>Box logs for this split exist for 2023–2025 Final games. 2026-27 has no completed WOWY box tape yet.</li>
        <li>
          Per-minute rates are total stat ÷ total minutes &gt; 0. Zero-minute played appearances keep counting stats.
        </li>
        <li>
          This page does not change production projections and does not feed frozen PTS C / REB C models.
        </li>
      </ul>
    </section>
  );
}
