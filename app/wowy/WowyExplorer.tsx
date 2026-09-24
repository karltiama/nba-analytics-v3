'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
import { formatNbaSeasonLabel } from '@/lib/season';
import {
  formatWowyTeammatePickerLabel,
  resolveWowyExplorerSelection,
  wowySummaryMatchesSelection,
} from '@/lib/wowy/explorer-selection';
import type {
  WowyClassifiedGame,
  WowyPairSummary,
  WowyPlayerIdentity,
  WowySeasonType,
  WowyTeamStintOption,
  WowyTeammateOption,
} from '@/lib/wowy/types';
import {
  PLAYER_SEARCH_RESULT_OPENED,
  PLAYER_SEARCH_USED,
  playerSearchResultOpenedProperties,
  playerSearchUsedProperties,
} from '@/lib/product-analytics/discovery-events';
import { trackEvent } from '@/lib/product-analytics/track-event';
import {
  WOWY_FILTER_CHANGED,
  wowyResultSplitFilterProperties,
  wowySeasonFilterProperties,
  wowySeasonTypeFilterProperties,
  wowyStatViewFilterProperties,
  wowyTeamStintFilterProperties,
  wowyTeammateFilterProperties,
} from '@/lib/product-analytics/wowy-events';
import { WowyResults } from './WowyResults';

const SEASONS = ['2025', '2024', '2023'] as const;

type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unavailable';

function contextKey(playerId: string, season: string, teamId: string, seasonType: string): string {
  return `${playerId}|${season}|${teamId}|${seasonType}`;
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
  const [requestedTeammateId, setRequestedTeammateId] = useState<string | null>(
    initialTeammateId.trim() || null
  );
  const [season, setSeason] = useState(
    SEASONS.includes(initialSeason as (typeof SEASONS)[number]) ? initialSeason : '2025'
  );
  const [teamId, setTeamId] = useState(initialTeamId);
  const [seasonType, setSeasonType] = useState<WowySeasonType | 'all'>(initialSeasonType);
  const [teams, setTeams] = useState<WowyTeamStintOption[]>([]);
  const [teammates, setTeammates] = useState<WowyTeammateOption[]>([]);
  const [teammatesLoadedFor, setTeammatesLoadedFor] = useState('');
  const [summary, setSummary] = useState<WowyPairSummary | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<'with' | 'without'>('with');
  const [view, setView] = useState<'perGame' | 'perMinute'>('perGame');
  const latestPlayerQuery = useRef('');
  const lastPlayerSearchTracked = useRef<string | null>(null);

  const contextLoaded =
    !!subject &&
    !!teamId &&
    teammatesLoadedFor === contextKey(subject.playerId, season, teamId, seasonType);

  const selection = resolveWowyExplorerSelection({
    requestedTeammateId,
    teammateIds: teammates.map((t) => t.playerId),
    contextLoaded,
  });

  useEffect(() => {
    if (selection.clearRequested) setRequestedTeammateId(null);
  }, [selection.clearRequested]);

  useEffect(() => {
    const q = playerQuery.trim();
    latestPlayerQuery.current = q;
    if (q.length < 2) {
      setPlayerHits([]);
      lastPlayerSearchTracked.current = null;
      return;
    }
    const handle = window.setTimeout(() => {
      void fetch(`/api/wowy/players?q=${encodeURIComponent(q)}`)
        .then(async (res) => {
          const data = await res.json();
          const hits = data.players ?? [];
          setPlayerHits(hits);
          if (latestPlayerQuery.current !== q || lastPlayerSearchTracked.current === q) return;
          lastPlayerSearchTracked.current = q;
          trackEvent(PLAYER_SEARCH_USED, playerSearchUsedProperties('wowy', hits.length));
        })
        .catch(() => setPlayerHits([]));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [playerQuery]);

  const loadContext = useCallback(async (playerId: string, nextSeason: string, nextTeamId: string, nextSeasonType: WowySeasonType | 'all') => {
    const res = await fetch(
      `/api/wowy/context?playerId=${encodeURIComponent(playerId)}&season=${encodeURIComponent(nextSeason)}${
        nextTeamId ? `&teamId=${encodeURIComponent(nextTeamId)}` : ''
      }&seasonType=${encodeURIComponent(nextSeasonType)}`
    );
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
        `/api/wowy/context?playerId=${encodeURIComponent(playerId)}&season=${encodeURIComponent(nextSeason)}&teamId=${encodeURIComponent(resolvedTeam)}&seasonType=${encodeURIComponent(nextSeasonType)}`
      );
      const againData = await again.json();
      setTeammates(againData.teammates ?? []);
      setTeammatesLoadedFor(contextKey(playerId, nextSeason, resolvedTeam, nextSeasonType));
    } else {
      setTeammates(data.teammates ?? []);
      if (resolvedTeam) {
        setTeammatesLoadedFor(contextKey(playerId, nextSeason, resolvedTeam, nextSeasonType));
      } else {
        setTeammatesLoadedFor('');
      }
    }
  }, []);

  useEffect(() => {
    if (!initialSubjectId) return;
    void loadContext(initialSubjectId, season, initialTeamId, seasonType);
    // Hydrate once from the URL; later season/team changes are user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSubjectId, loadContext]);

  const selectedTeam = teams.find((t) => t.teamId === teamId) ?? null;

  useEffect(() => {
    if (!subject || !teamId) {
      setTeammates([]);
      setTeammatesLoadedFor('');
      return;
    }
    const key = contextKey(subject.playerId, season, teamId, seasonType);
    void fetch(
      `/api/wowy/context?playerId=${encodeURIComponent(subject.playerId)}&season=${encodeURIComponent(season)}&teamId=${encodeURIComponent(teamId)}&seasonType=${encodeURIComponent(seasonType)}`
    )
      .then((res) => res.json())
      .then((data) => {
        setTeammates(data.teammates ?? []);
        setTeammatesLoadedFor(key);
      })
      .catch(() => {
        setTeammates([]);
        setTeammatesLoadedFor('');
      });
  }, [subject, season, teamId, seasonType]);

  const runPair = useCallback(async () => {
    if (!subject || !teamId) {
      setSummary(null);
      setState('idle');
      return;
    }
    if (!selection.readyToFetchPair) {
      setState('loading');
      return;
    }
    setState('loading');
    setError(null);
    const params = new URLSearchParams({
      subjectPlayerId: subject.playerId,
      season,
      teamId,
      seasonType,
    });
    if (selection.teammateIdForPair) params.set('teammatePlayerId', selection.teammateIdForPair);
    try {
      const res = await fetch(`/api/wowy/pair?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setSummary(null);
        setError(data.error ?? 'Unable to load comparison');
        setState(res.status === 422 ? 'unavailable' : 'error');
        return;
      }
      const next = data.summary as WowyPairSummary;
      if (!wowySummaryMatchesSelection(next, selection.teammateIdForPair)) {
        setSummary(null);
        setState('loading');
        return;
      }
      setSummary(next);
      setState(next.with.gameCount + next.without.gameCount === 0 ? 'empty' : 'ready');
      const nextUrl = new URLSearchParams({
        subject: subject.playerId,
        season,
        teamId,
        seasonType,
      });
      if (selection.teammateIdForPair) nextUrl.set('teammate', selection.teammateIdForPair);
      const preview = new URLSearchParams(window.location.search).get('preview');
      if (preview) nextUrl.set('preview', preview);
      window.history.replaceState(null, '', `${pathname}?${nextUrl.toString()}`);
    } catch (e) {
      setSummary(null);
      setError(e instanceof Error ? e.message : 'Failed to load comparison');
      setState('error');
    }
  }, [pathname, season, seasonType, selection.readyToFetchPair, selection.teammateIdForPair, subject, teamId]);

  useEffect(() => {
    void runPair();
  }, [runPair]);

  const drillGames: WowyClassifiedGame[] = useMemo(() => {
    if (!summary) return [];
    return summary.classifiedGames.filter((g) => g.bucket === drill);
  }, [drill, summary]);

  const visibleResults =
    state === 'ready' &&
    summary &&
    wowySummaryMatchesSelection(summary, selection.teammateIdForPair);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <header className="flex flex-col lg:flex-row lg:items-end gap-6">
        <div className="flex-1 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cc-secondary">
            <Link href="/betting" className="text-[#075B5C] hover:underline">
              Analytics
            </Link>
            <span className="mx-1.5">/</span>
            Game-level WOWY
          </p>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
            <span className="text-[#55ddb1]">WOWY</span>{' '}
            <span className="text-[#063f46]">Impact</span>
          </h1>
          <p className="type-body max-w-2xl text-cc-secondary">
            See how a team scored in games a player appeared versus games with a verified did-not-play roster row. Add a
            teammate to see that player&apos;s own box split instead. This is game-level participation, not shared-court possessions.
            A selected teammate is not implied to be injured.
          </p>
        </div>
        {subject ? (
          <div className="flex items-center gap-4 bg-white border border-[#DCE9EA] rounded-2xl px-4 py-3 min-w-[240px]">
            <PlayerHeadshot
              nbaPlayerId={subject.nbaPlayerId}
              name={subject.fullName}
              className="relative w-16 h-20 rounded-xl overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0"
            />
            <div>
              <p className="text-base font-bold text-[#063f46]">{subject.fullName}</p>
              <p className="type-secondary">
                {subject.position ?? 'Player'}
                {selectedTeam ? ` · ${selectedTeam.abbreviation}` : ''}
              </p>
            </div>
          </div>
        ) : (
          <blockquote className="type-body border-l-4 border-[#55ddb1] pl-4 text-cc-secondary lg:max-w-xs">
            More than ratings. A game-level look at how a team&apos;s box moved with or without a player, or how a
            player&apos;s box moved with or without a teammate.
          </blockquote>
        )}
      </header>

      <section className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <label className="block space-y-1.5 relative">
            <span className="type-interactive">Player</span>
            <input
              value={subject ? subject.fullName : playerQuery}
              onChange={(e) => {
                setSubject(null);
                setRequestedTeammateId(null);
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
                      className="type-table-data w-full px-3 py-2 text-left text-[#063f46] hover:bg-[#f7f9f7]"
                      onClick={() => {
                        trackEvent(
                          PLAYER_SEARCH_RESULT_OPENED,
                          playerSearchResultOpenedProperties('wowy')
                        );
                        setSubject(hit);
                        setPlayerQuery('');
                        setPlayerHits([]);
                        setRequestedTeammateId(null);
                        void loadContext(hit.playerId, season, '', seasonType);
                      }}
                    >
                      {hit.fullName}
                      {hit.position ? <span className="type-metadata"> · {hit.position}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>

          <label className="block space-y-1.5">
            <span className="type-interactive">Season</span>
            <select
              value={season}
              onChange={(e) => {
                const next = e.target.value;
                setSeason(next);
                setRequestedTeammateId(null);
                setTeamId('');
                setTeammatesLoadedFor('');
                const seasonEvent = wowySeasonFilterProperties(next);
                if (seasonEvent) trackEvent(WOWY_FILTER_CHANGED, seasonEvent);
                if (subject) void loadContext(subject.playerId, next, '', seasonType);
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
            <span className="type-interactive">Team stint</span>
            <select
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setRequestedTeammateId(null);
                setTeammatesLoadedFor('');
                trackEvent(WOWY_FILTER_CHANGED, wowyTeamStintFilterProperties());
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
              <p className="type-metadata">
                Game-log coverage {selectedTeam.firstGameDate} to {selectedTeam.lastGameDate}. Not a verified trade
                date.
              </p>
            ) : null}
          </label>

          <label className="block space-y-1.5">
            <span className="type-interactive">Season type</span>
            <select
              value={seasonType}
              onChange={(e) => {
                const next = e.target.value;
                setSeasonType(next as WowySeasonType | 'all');
                setTeammatesLoadedFor('');
                const seasonTypeEvent = wowySeasonTypeFilterProperties(next);
                if (seasonTypeEvent) trackEvent(WOWY_FILTER_CHANGED, seasonTypeEvent);
              }}
              className="w-full rounded-lg border border-[#DCE9EA] bg-white px-3 py-2 text-sm text-[#063f46]"
            >
              <option value="regular">Regular season</option>
              <option value="playoffs">Playoffs</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="type-interactive">Teammate (optional)</span>
            <select
              value={selection.visibleTeammateId ?? ''}
              onChange={(e) => {
                const nextId = e.target.value || null;
                setRequestedTeammateId(nextId);
                if (!nextId) setView('perGame');
                trackEvent(WOWY_FILTER_CHANGED, wowyTeammateFilterProperties(Boolean(nextId)));
              }}
              disabled={!subject || !teamId || !contextLoaded}
              className="w-full rounded-lg border border-[#DCE9EA] bg-white px-3 py-2 text-sm text-[#063f46] disabled:bg-[#f7f9f7]"
            >
              <option value="">
                {subject ? `${subject.fullName} — team with/without` : 'This player (team with/without)'}
              </option>
              {teammates.map((t) => (
                <option key={t.playerId} value={t.playerId}>
                  {formatWowyTeammatePickerLabel(t)}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-1.5">
            <span className="type-interactive">Stat view</span>
            <div className="flex rounded-lg border border-[#DCE9EA] overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  if (view === 'perGame') return;
                  setView('perGame');
                  trackEvent(WOWY_FILTER_CHANGED, wowyStatViewFilterProperties('perGame'));
                }}
                className={`type-interactive flex-1 px-3 py-2 ${
                  view === 'perGame' || !selection.visibleTeammateId ? 'bg-[#063f46] text-white' : 'bg-white text-[#4a6366]'
                }`}
              >
                Per game
              </button>
              <button
                type="button"
                onClick={() => {
                  if (view === 'perMinute') return;
                  setView('perMinute');
                  trackEvent(WOWY_FILTER_CHANGED, wowyStatViewFilterProperties('perMinute'));
                }}
                disabled={!selection.visibleTeammateId}
                className={`type-interactive flex-1 px-3 py-2 disabled:opacity-40 ${
                  view === 'perMinute' && selection.visibleTeammateId ? 'bg-[#063f46] text-white' : 'bg-white text-[#4a6366]'
                }`}
              >
                Per minute
              </button>
            </div>
          </div>
        </div>
      </section>

      {state === 'loading' && (
        <div className="type-secondary rounded-2xl border border-[#DCE9EA] bg-white p-8">Loading comparison…</div>
      )}
      {state === 'error' && (
        <div className="type-body rounded-2xl border border-[#DCE9EA] bg-white p-6 text-red-800">
          {error ?? 'Something went wrong.'}
        </div>
      )}
      {state === 'unavailable' && (
        <div className="bg-white border border-[#DCE9EA] rounded-2xl p-6 space-y-2">
          <h2 className="type-section-heading text-[#063f46]">Unavailable data</h2>
          <p className="type-body text-cc-secondary">{error ?? 'This pair cannot be classified with current identity or coverage.'}</p>
        </div>
      )}
      {state === 'idle' && !subject && (
        <div className="type-body rounded-2xl border border-[#DCE9EA] bg-white p-6 text-cc-secondary">
          Select a player and team stint to load team with/without that player. A teammate is optional.
        </div>
      )}
      {state === 'empty' && summary && wowySummaryMatchesSelection(summary, selection.teammateIdForPair) && (
        <div className="bg-white border border-[#DCE9EA] rounded-2xl p-6 space-y-2">
          <h2 className="type-section-heading text-[#063f46]">No eligible with/without games</h2>
          <p className="type-body text-cc-secondary">
            {summary.excludedCount} game(s) were classified but none met both-played or verified-DNP rules for this
            filter. Games without a verified teammate participation row are excluded rather than counted as WITHOUT (
            {summary.unknownMembershipCount} unknown membership).
          </p>
        </div>
      )}

      {visibleResults && summary && (
        <WowyResults
          summary={summary}
          drill={drill}
          onDrill={(next) => {
            if (next === drill) return;
            setDrill(next);
            trackEvent(WOWY_FILTER_CHANGED, wowyResultSplitFilterProperties(next));
          }}
          drillGames={drillGames}
          subjectNbaId={subject?.nbaPlayerId}
          teammateNbaId={
            teammates.find((t) => t.playerId === selection.visibleTeammateId)?.nbaPlayerId ?? null
          }
          view={view}
          onView={(next) => {
            if (next === view) return;
            setView(next);
            trackEvent(WOWY_FILTER_CHANGED, wowyStatViewFilterProperties(next));
          }}
        />
      )}

      <Methodology />
    </main>
  );
}

function Methodology() {
  return (
    <section className="space-y-3 rounded-2xl border border-[#DCE9EA] bg-white p-4 sm:p-6">
      <h2 className="type-section-heading text-[#063f46]">Coverage and methodology</h2>
      <ul className="type-body list-disc space-y-1.5 pl-5 text-cc-secondary">
        <li>
          <strong className="text-[#063f46]">Player only:</strong> team counting stats in games the subject appeared versus
          games with a verified DNP roster row in historical player game logs. Missing logs stay unknown, not without.
        </li>
        <li>
          <strong className="text-[#063f46]">With a teammate:</strong> subject appeared and teammate appeared, same team
          that night, completed Final game.
        </li>
        <li>
          <strong className="text-[#063f46]">Without a teammate:</strong> subject appeared and the teammate has a verified
          did-not-play roster row. DNP is not labeled as injury.
        </li>
        <li>
          Games without a verified teammate participation row are excluded rather than counted as WITHOUT. Absence is
          never inferred from a hole in the log.
        </li>
        <li>
          Team stints stay separate. Night-of box membership is used. Roster observation dates are not verified trade
          timestamps.
        </li>
        <li>Box logs for this split exist for 2023–2025 Final games. 2026-27 has no completed WOWY box tape yet.</li>
        <li>
          Per-minute rates (teammate split only) are total stat ÷ total minutes &gt; 0. The player-themselves view is
          team per-game counting stats, not per minute.
        </li>
        <li>
          This page does not change production projections and does not feed frozen PTS C / REB C models.
        </li>
      </ul>
    </section>
  );
}
