'use client';

import Link from 'next/link';
import { Clock, TrendingUp, ChevronRight, ListFilter } from 'lucide-react';
import { gameDetailHref, propsExplorerHref } from '@/lib/betting/research-journey';
import { scoreboardMatchupHref } from '@/lib/pregame-matchup/href';
import { twoWayMarketDisplay } from '@/lib/betting/market-probability';
import { TeamLogo } from '@/components/nba/TeamLogo';
import { MarketProbability } from '@/components/betting/MarketProbability';
import type { PresentedGame } from '@/lib/scoreboard/present';
import type { StatLeader } from '@/lib/scoreboard/game-pulse';

interface TeamInfo {
  id: string;
  name: string;
  abbreviation: string;
  logo?: string;
  /** null/empty when no active-season record */
  record: string | null;
}

interface OddsInfo {
  moneyline: number | null;
  spread: number | null;
  spreadOdds: number | null;
}

export interface Game {
  id: string;
  /** Game date YYYY-MM-DD (ET), for details page B2B detection */
  gameDate?: string;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  startTime: string;
  homeOdds: OddsInfo;
  awayOdds: OddsInfo;
  overUnder: number | null;
  overOdds: number | null;
  underOdds: number | null;
  homeImpliedProb: number | null;
  awayImpliedProb: number | null;
  /** Sportsbook moneyline favorite (not a Court Context pick). */
  isFavorite: 'home' | 'away' | null;
  isClose: boolean;
  paceSignal?: {
    label: string;
    projected: number;
  };
  weakness?: {
    label: string;
    team: string;
    rank: number;
  };
  /** Optional rest / B2B blurb for the card. Display-only. */
  matchupContext?: string;
  /** Normalized product status */
  status?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  hasOdds?: boolean;
  /** Scoreboard cards only: "DraftKings · BDL synced 3m ago" for the one sportsbook quote shown. */
  marketCaption?: string | null;
  season?: string;
  /** Display-only scoreboard overlay. Absent on a normal regular-season card. */
  scoreboard?: PresentedGame;
  /**
   * Schedule-only opening-night card. The tip time is a fact from the schedule.
   * `tipPassed` means that instant is already here, so the card must not look pregame or live.
   */
  schedulePreview?: {
    tipPassed: boolean;
  };
  /**
   * Scoreboard cards only: true when this game id exists in analytics.games, so the matchup and
   * props pages can load it. Scoreboard-only games (all preseason today) leave it unset.
   */
  researchAvailable?: boolean;
}

interface GameCardProps {
  game: Game;
  /** Optional: if not provided, card links to /betting/games/[gameId] */
  onViewDetails?: (gameId: string) => void;
  /** ET YYYY-MM-DD used for Props Explorer deep links when game.gameDate is missing */
  researchDate?: string;
  /** Marketing sample cards must not deep-link to fake game ids. */
  samplePreview?: boolean;
  /**
   * Today's Games uses scoreboard: the same card, with market slots before tip and live/final
   * basketball facts after. Default remains market so other views are unchanged.
   */
  presentation?: 'market' | 'scoreboard';
}

function formatOdds(odds: number | null | undefined): string {
  if (odds == null) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatSpread(spread: number | null | undefined): string {
  if (spread == null) return '—';
  if (spread > 0) return `+${spread}`;
  return `${spread}`;
}

function getStatusBadge(status: string | undefined): { label: string; className: string } | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === 'final') return { label: 'FINAL', className: 'bg-[#063F46]/10 text-[#063F46] rounded-full font-semibold' };
  if (s === 'scheduled') return { label: 'Scheduled', className: 'bg-[#F3F8F8] text-cc-secondary rounded-full' };
  if (s === 'in progress') {
    return { label: 'In Progress', className: 'bg-[#56D6A3]/25 text-[#075B5C] rounded-full font-semibold' };
  }
  if (s === 'live' || s === 'halftime' || s === 'overtime') {
    const label = s === 'live' ? 'Live' : s === 'halftime' ? 'Halftime' : 'Overtime';
    return { label, className: 'bg-[#56D6A3]/25 text-[#075B5C] rounded-full font-semibold' };
  }
  if (s === 'postponed') {
    return { label: 'Postponed', className: 'bg-amber-50 text-amber-700 rounded-full font-medium' };
  }
  if (s === 'canceled' || s === 'cancelled') {
    return { label: 'Canceled', className: 'bg-[#F3F8F8] text-cc-secondary rounded-full' };
  }
  if (s === 'unknown') {
    return { label: 'Status unavailable', className: 'bg-[#F3F8F8] text-cc-secondary rounded-full' };
  }
  return { label: status, className: 'bg-[#F3F8F8] text-cc-secondary rounded-full' };
}

function FavBadge() {
  return (
    <span
      className="type-badge shrink-0 rounded bg-[#56D6A3]/30 px-1.5 py-0.5 text-[#075B5C]"
      title="Sportsbook moneyline favorite"
      aria-label="Market favorite"
    >
      FAV
    </span>
  );
}

/** Display-only city / nickname split so both fit without truncating the full name. */
function splitTeamDisplayName(name: string): { city: string; nickname: string } {
  const trimmed = name.trim();
  if (trimmed.endsWith('Trail Blazers')) {
    return {
      city: trimmed.slice(0, -'Trail Blazers'.length).trim() || trimmed,
      nickname: 'Trail Blazers',
    };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { city: '', nickname: trimmed };
  return { city: parts.slice(0, -1).join(' '), nickname: parts[parts.length - 1] };
}

function TeamMatchupSide({
  team,
  isFav,
  showRecord,
  stacked = false,
}: {
  team: TeamInfo;
  isFav: boolean;
  showRecord: boolean;
  /** Logo above the name so a centered score fits between the teams. */
  stacked?: boolean;
}) {
  const { city, nickname } = splitTeamDisplayName(team.name);
  if (stacked) {
    return (
      <div className="flex flex-col items-center gap-1 min-w-0 flex-1 text-center" title={team.name}>
        <TeamLogo team={team.abbreviation} size="md" decorative />
        <div className="min-w-0 max-w-full leading-none">
          <div className="type-card-data truncate text-[#063F46]">{nickname || team.name}</div>
          {showRecord ? <div className="type-secondary mt-0.5 truncate">{team.record ?? '—'}</div> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <TeamLogo
        team={team.abbreviation}
        size="md"
        decorative
      />
      <div className="min-w-0 leading-none">
        {city ? (
          <div className="type-secondary truncate">{city}</div>
        ) : null}
        <div className={`type-card-data truncate text-[#063F46] ${city ? 'mt-0.5' : ''}`}>
          {nickname || team.name}
        </div>
        {showRecord ? (
          <div className="mt-0.5 flex items-center gap-1">
            <span className="type-secondary">{team.record ?? '—'}</span>
            {isFav ? <FavBadge /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const PRIMARY_ACTION =
  'sm:flex-[1.22] min-w-0 px-3 py-3 flex items-center justify-center gap-1.5 rounded-xl bg-[#075B5C] hover:bg-[#064D4E] transition-colors group whitespace-nowrap';
const SECONDARY_ACTION =
  'sm:flex-1 min-w-0 px-3 py-3 flex items-center justify-center gap-1.5 rounded-xl bg-[#F3F8F8] border border-[#DCE9EA] text-[#063F46] hover:bg-[#EAF3F3] transition-colors whitespace-nowrap';
const UNAVAILABLE = 'Not available for this game yet';

/** Same shape as the footer link, shown when the destination cannot load this game. */
function UnavailableAction({ primary, label }: { primary: boolean; label: string }) {
  const base = primary ? PRIMARY_ACTION : SECONDARY_ACTION;
  return (
    <span
      className={`${base.replace(/hover:\S+/g, '')} opacity-50 cursor-not-allowed`}
      aria-disabled="true"
      title={UNAVAILABLE}
      data-action-unavailable
    >
      {primary ? <TrendingUp className="w-3.5 h-3.5 text-white shrink-0" /> : <ListFilter className="w-3.5 h-3.5 shrink-0" />}
      <span className={`type-interactive${primary ? ' text-white' : ''}`}>{label}</span>
    </span>
  );
}

/** One column of the three-column panel holding a live or final stat leader. */
function LeaderTile({
  label,
  unit,
  leader,
  teamAbbr,
  last = false,
}: {
  label: string;
  unit: string;
  leader: StatLeader | null;
  teamAbbr: (teamId: string) => string;
  last?: boolean;
}) {
  const names = leader?.players.map((player) => player.name) ?? [];
  const who = names.length === 0 ? '—' : names.length === 1 ? names[0] : `${names.length} tied`;
  const team = leader && leader.players.length === 1 ? teamAbbr(leader.players[0].teamId) : null;
  return (
    <div className={`px-2 py-3 text-center min-w-0${last ? '' : ' border-r border-[#DCE9EA]'}`} data-leader={leader?.stat ?? 'none'}>
      <div className="type-secondary mb-1.5">{label}</div>
      <div className="type-card-data truncate text-[#063F46]" title={names.join(', ') || undefined}>
        {who}
      </div>
      <div className="type-card-data truncate tabular-nums text-[#063F46]">
        {leader ? (
          <>
            {leader.value} <span className="type-secondary">{team ? `${unit} · ${team}` : unit}</span>
          </>
        ) : (
          '\u00a0'
        )}
      </div>
    </div>
  );
}

const CONTEXT_HEADING: Record<'pregame' | 'live' | 'final', [string, string]> = {
  pregame: ['Matchup ', 'Context'],
  live: ['Game ', 'Pulse'],
  final: ['Game ', 'Recap'],
};

export function GameCard({
  game,
  onViewDetails,
  researchDate,
  samplePreview = false,
  presentation = 'market',
}: GameCardProps) {
  const dateForProps =
    (game.gameDate && /^\d{4}-\d{2}-\d{2}/.test(String(game.gameDate))
      ? String(game.gameDate).slice(0, 10)
      : null) ?? researchDate ?? undefined;
  const gameHref = samplePreview ? '/dashboard' : gameDetailHref(game.id);
  const propsHref = samplePreview ? '/betting/props-explorer' : propsExplorerHref({ gameId: game.id, date: dateForProps });

  const hasOdds =
    game.hasOdds ??
    (game.homeOdds.moneyline != null ||
      game.awayOdds.moneyline != null ||
      game.homeOdds.spread != null ||
      game.awayOdds.spread != null ||
      game.overUnder != null);
  const marketDisplay = twoWayMarketDisplay(game.awayOdds.moneyline, game.homeOdds.moneyline);
  const board = game.scoreboard;
  const schedulePreview = game.schedulePreview ?? null;
  const scoreboardPresentation = presentation === 'scoreboard';
  const phase = schedulePreview ? null : scoreboardPresentation ? (board?.phase ?? 'other') : null;
  const inPlay = phase === 'live' || phase === 'final';
  const contextKind: 'pregame' | 'live' | 'final' = phase === 'live' ? 'live' : phase === 'final' ? 'final' : 'pregame';
  const awayIsFav = !inPlay && (marketDisplay?.favorite ?? game.isFavorite) === 'away';
  const homeIsFav = !inPlay && (marketDisplay?.favorite ?? game.isFavorite) === 'home';
  const isCloseMarket = marketDisplay?.isClose ?? game.isClose;
  const isFinal = board
    ? board.isFinal && game.homeScore != null && game.awayScore != null
    : game.status === 'Final' && game.homeScore != null && game.awayScore != null;
  const showScoreline =
    !schedulePreview &&
    (isFinal || (board?.showScores === true && game.homeScore != null && game.awayScore != null));
  const statusBadge = getStatusBadge(game.status);
  const favoredValue = (isFav: boolean) => (isFav ? 'text-[#20B95A]' : 'text-[#063F46]');

  const winnerId = phase === 'final' && board?.pulse?.kind === 'won' ? board.pulse.teamId : null;
  const scoreTone = (teamId: string) => (winnerId != null && winnerId !== teamId ? 'text-cc-secondary' : undefined);
  const teamAbbr = (teamId: string) =>
    teamId === game.homeTeam.id ? game.homeTeam.abbreviation : teamId === game.awayTeam.id ? game.awayTeam.abbreviation : '';
  const leaders = board?.leaders?.kind === 'leaders' ? board.leaders : null;
  const playerStatus = board?.leaders?.kind === 'status' ? board.leaders.text : null;
  const freshness = phase === 'live' && board && !board.stale ? (board.freshnessAge ?? board.freshnessLabel) : null;
  const showPreviewMarkets = Boolean(schedulePreview && !schedulePreview.tipPassed && hasOdds);
  const marketCaption = scoreboardPresentation && !inPlay && hasOdds ? (game.marketCaption ?? null) : null;
  const inPlayContext = scoreboardPresentation && inPlay ? board?.context ?? null : null;
  const contextText = !scoreboardPresentation || !inPlay ? game.matchupContext : inPlayContext?.kind === 'insight' ? inPlayContext.text : undefined;
  const contextFallback =
    scoreboardPresentation && inPlay
      ? (inPlayContext && inPlayContext.kind !== 'insight' ? inPlayContext.text : 'More game context will appear as stats develop.')
      : 'No verified matchup context for this game yet.';
  const research = schedulePreview
    ? false
    : scoreboardPresentation
      ? game.researchAvailable === true && !samplePreview
      : true;
  const pregameMatchupHref =
    schedulePreview
      ? null
      : scoreboardPresentation && !samplePreview && !research && phase === 'pregame'
        ? scoreboardMatchupHref(game.id, researchDate ?? dateForProps)
        : null;

  return (
    <div
      className={`bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden${scoreboardPresentation ? ' h-full' : ''}`}
      data-game-id={game.id}
      data-presentation={presentation}
      data-betting={schedulePreview ? (showPreviewMarkets ? 'visible' : 'hidden') : inPlay ? 'hidden' : 'visible'}
      data-final={board ? (board.isFinal ? 'true' : 'false') : undefined}
      data-season-type={board?.seasonType ?? undefined}
      data-stale={board ? (board.stale ? 'true' : 'false') : undefined}
      data-phase={phase ?? undefined}
      data-schedule-preview={schedulePreview ? (schedulePreview.tipPassed ? 'tip-passed' : 'upcoming') : undefined}
    >
      <div className="px-5 sm:px-6 py-2 flex items-center justify-between border-b border-[#DCE9EA] gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {schedulePreview ? (
            <>
              <Clock className="w-4 h-4 text-[#075B5C] shrink-0" />
              <div className="min-w-0">
                <div className="type-metadata truncate">{game.startTime}</div>
              </div>
            </>
          ) : phase === 'live' ? (
            <>
              <span
                className="type-badge inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2 py-0.5 bg-[#56D6A3]/25 text-[#075B5C] rounded-full font-semibold"
                data-lifecycle-label
              >
                {board && !board.stale ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#20B95A] motion-safe:animate-pulse" aria-hidden />
                ) : null}
                LIVE
              </span>
              <div className="type-metadata truncate tabular-nums" data-status-text>
                {board?.lifecycle === 'halftime' ? 'Halftime' : (board?.periodClock ?? '')}
              </div>
            </>
          ) : phase === 'final' ? (
            <>
              <span
                className="type-badge whitespace-nowrap px-2 py-0.5 bg-[#063F46]/10 text-[#063F46] rounded-full font-semibold"
                data-lifecycle-label
              >
                FINAL
              </span>
              {board?.periodClock ? (
                <div className="type-metadata truncate" data-status-text>
                  {board.periodClock}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <Clock className="w-4 h-4 text-[#075B5C] shrink-0" />
              <div className="min-w-0">
                <div className="type-metadata truncate" data-pregame-status={scoreboardPresentation && board?.lifecycle === 'scheduled' ? board.statusLabel : undefined}>
                  {game.startTime}
                  {scoreboardPresentation && board?.lifecycle === 'scheduled' && board.statusLabel
                    ? ` · ${board.statusLabel}`
                    : ''}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {schedulePreview ? (
            <span
              className="type-badge whitespace-nowrap px-2 py-0.5 bg-[#F3F8F8] text-cc-secondary rounded-full"
              data-lifecycle-label
            >
              {schedulePreview.tipPassed ? 'Live score unavailable' : 'Schedule preview'}
            </span>
          ) : phase === 'other' && board ? (
            <span
              className={`type-badge whitespace-nowrap px-2 py-0.5 ${getStatusBadge(board.statusLabel)?.className ?? ''}`}
              data-lifecycle-label
            >
              {board.statusLabel}
            </span>
          ) : scoreboardPresentation ? (
            <span className="type-secondary inline-flex items-center gap-0.5 whitespace-nowrap" data-season-label>
              {board ? `NBA · ${board.seasonLabel}` : 'NBA'}
              <ChevronRight className="w-4 h-4" />
            </span>
          ) : statusBadge ? (
            <span className={`type-badge whitespace-nowrap px-2 py-0.5 ${statusBadge.className}`} data-lifecycle-label>
              {statusBadge.label}
            </span>
          ) : isCloseMarket ? (
            <span className="type-badge rounded-full bg-amber-50 px-2 py-0.5 text-amber-700" title="Market implied probabilities within 10 points">
              CLOSE
            </span>
          ) : (
            <span className="type-secondary inline-flex items-center gap-0.5">
              NBA
              <ChevronRight className="w-4 h-4" />
            </span>
          )}
        </div>
      </div>

      {showScoreline && !scoreboardPresentation && (
        <div className="px-5 sm:px-6 pt-4">
          <div className="text-center py-3 rounded-xl bg-[#F8FBFA] border border-[#DCE9EA]">
            <div className="text-2xl font-bold text-[#063F46] tabular-nums">
              {game.awayScore} – {game.homeScore}
            </div>
            <div className="type-metadata mt-0.5">
              {game.awayTeam.abbreviation} – {game.homeTeam.abbreviation}
              {board?.periodClock ? ` · ${board.periodClock}` : ''}
            </div>
          </div>
        </div>
      )}

      <div className="px-5 sm:px-6 pt-3 pb-2">
        <div className="flex items-center gap-2 sm:gap-3">
          <TeamMatchupSide
            team={game.awayTeam}
            isFav={awayIsFav}
            showRecord={!schedulePreview}
            stacked={scoreboardPresentation && showScoreline}
          />
          {scoreboardPresentation && showScoreline ? (
            <span
              className="shrink-0 text-2xl font-bold text-[#063F46] tabular-nums whitespace-nowrap"
              data-scoreline
              aria-label={`${game.awayTeam.abbreviation} ${game.awayScore}, ${game.homeTeam.abbreviation} ${game.homeScore}`}
            >
              <span className={scoreTone(game.awayTeam.id)}>{game.awayScore}</span>
              <span className="font-normal text-cc-secondary"> – </span>
              <span className={scoreTone(game.homeTeam.id)}>{game.homeScore}</span>
            </span>
          ) : (
            <span className="type-secondary shrink-0">
              VS
            </span>
          )}
          <TeamMatchupSide
            team={game.homeTeam}
            isFav={homeIsFav}
            showRecord={!schedulePreview}
            stacked={scoreboardPresentation && showScoreline}
          />
        </div>
      </div>

      {schedulePreview && !showPreviewMarkets ? (
        <div
          className="mx-5 sm:mx-6 mb-5 rounded-xl border border-[#DCE9EA] bg-[#F8FBFA] px-3 py-3 text-center"
          data-schedule-preview-notice
        >
          <p className="type-metadata">Schedule preview</p>
          <p className="type-secondary mt-1">
            {schedulePreview.tipPassed
              ? 'This game has tipped off. A live score is not available.'
              : 'Tip time only. Live scores, betting lines, and player stats are not shown.'}
          </p>
        </div>
      ) : inPlay ? (
        <div
          className="mx-5 sm:mx-6 mb-5 grid grid-cols-3 rounded-xl border border-[#DCE9EA] overflow-hidden bg-[#F8FBFA]"
          data-leaders-panel
        >
          <LeaderTile label="Points" unit="PTS" leader={leaders?.pts ?? null} teamAbbr={teamAbbr} />
          <LeaderTile label="Rebounds" unit="REB" leader={leaders?.reb ?? null} teamAbbr={teamAbbr} />
          <LeaderTile label="Assists" unit="AST" leader={leaders?.ast ?? null} teamAbbr={teamAbbr} last />
        </div>
      ) : (
      <div className="mx-5 sm:mx-6 mb-5 grid grid-cols-3 rounded-xl border border-[#DCE9EA] overflow-hidden bg-[#F8FBFA]">
        <div className="px-2 py-3 text-center border-r border-[#DCE9EA]">
          <div className="type-secondary mb-1.5">Market spread</div>
          <div className={`type-card-data ${favoredValue(awayIsFav)}`}>
            {game.awayTeam.abbreviation} {formatSpread(game.awayOdds.spread)}
          </div>
          <div className={`type-card-data ${favoredValue(homeIsFav)}`}>
            {game.homeTeam.abbreviation} {formatSpread(game.homeOdds.spread)}
          </div>
        </div>
        <div className="px-2 py-3 text-center border-r border-[#DCE9EA]">
          <div className="type-secondary mb-1.5">Market total</div>
          <div className="type-card-data text-[#168DD8]">
            {game.overUnder != null ? `O/U ${game.overUnder}` : '—'}
          </div>
          <div className="type-secondary mt-0.5" data-total-price>
            <span className="block whitespace-nowrap sm:hidden">O {formatOdds(game.overOdds)}</span>
            <span className="block whitespace-nowrap sm:hidden">U {formatOdds(game.underOdds)}</span>
            <span className="hidden whitespace-nowrap sm:block">
              {`O ${formatOdds(game.overOdds)} / U ${formatOdds(game.underOdds)}`}
            </span>
          </div>
        </div>
        <div className="px-2 py-3 text-center">
          <div className="type-secondary mb-1.5">Market ML</div>
          <div className={`type-card-data ${favoredValue(awayIsFav)}`}>
            {game.awayTeam.abbreviation} {formatOdds(game.awayOdds.moneyline)}
          </div>
          <div className={`type-card-data ${favoredValue(homeIsFav)}`}>
            {game.homeTeam.abbreviation} {formatOdds(game.homeOdds.moneyline)}
          </div>
        </div>
      </div>
      )}

      {schedulePreview || (!contextText && !scoreboardPresentation) ? null : (
        <div
          className="mx-5 sm:mx-6 mb-3 rounded-xl bg-[#F8FBFA] border border-[#DCE9EA] px-3 py-2"
          data-context-panel={scoreboardPresentation ? contextKind : undefined}
        >
          <div className="type-metadata text-center">
            <span>{CONTEXT_HEADING[contextKind][0]}</span>
            <span className="text-[#55ddb1]">{CONTEXT_HEADING[contextKind][1]}</span>
          </div>
          {contextText ? (
            <p
              className="type-body mt-1 text-pretty text-[#063F46]"
              data-game-pulse={inPlayContext?.kind === 'insight' ? inPlayContext.insight.id : undefined}
            >
              {contextText}
            </p>
          ) : (
            <p
              className="type-secondary mt-1 text-center"
              data-context-unavailable
              data-game-pulse={inPlay && scoreboardPresentation ? (inPlayContext?.kind ?? 'none') : undefined}
            >
              {contextFallback}
            </p>
          )}
        </div>
      )}

      {!inPlay && hasOdds && marketDisplay ? (
        <div className="px-5 sm:px-6 pb-5">
          <MarketProbability
            awayAbbr={game.awayTeam.abbreviation}
            homeAbbr={game.homeTeam.abbreviation}
            awayPct={marketDisplay.awayPct}
            homePct={marketDisplay.homePct}
          />
        </div>
      ) : null}

      {!game.paceSignal || scoreboardPresentation ? null : (
        <div className="mx-5 sm:mx-6 mb-5 rounded-xl border border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
          <p className="type-metadata text-center">Pace context</p>
          <p className="type-secondary mt-0.5 text-center tabular-nums">
            {game.paceSignal.projected.toFixed(1)} projected pace
            {game.paceSignal.label === 'FAST'
              ? ' · Above typical NBA pace'
              : game.paceSignal.label === 'SLOW'
                ? ' · Below typical NBA pace'
                : ' · Near typical NBA pace'}
          </p>
        </div>
      )}

      {board?.staleLabel ? (
        <p className="type-badge mx-5 sm:mx-6 mb-3 text-amber-700" data-stale-warning>
          {board.staleLabel}
        </p>
      ) : null}

      {scoreboardPresentation && (playerStatus || freshness || marketCaption) ? (
        <p className="type-metadata mx-5 sm:mx-6 mb-3 text-center">
          {playerStatus ? <span data-player-status>{playerStatus}</span> : null}
          {playerStatus && freshness ? ' · ' : null}
          {freshness ? <span data-freshness>{freshness}</span> : null}
          {marketCaption ? <span data-market-source>{marketCaption}</span> : null}
        </p>
      ) : null}

      <div className="px-5 sm:px-6 pb-5 flex flex-col sm:flex-row gap-2.5">
        {!scoreboardPresentation ? (
          <>
        <Link
          href={gameHref}
          onClick={() => onViewDetails?.(game.id)}
          className={PRIMARY_ACTION}
        >
          <TrendingUp className="w-3.5 h-3.5 text-white shrink-0" />
          <span className="type-interactive text-white">View matchup</span>
          <ChevronRight className="w-3.5 h-3.5 text-white shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </Link>
        <Link
          href={propsHref}
          className={SECONDARY_ACTION}
        >
          <ListFilter className="w-3.5 h-3.5 shrink-0" />
          <span className="type-interactive">View props</span>
        </Link>
          </>
        ) : (
          <>
            {research ? (
              <Link href={gameHref} onClick={() => onViewDetails?.(game.id)} className={PRIMARY_ACTION}>
                <TrendingUp className="w-3.5 h-3.5 text-white shrink-0" />
                <span className="type-interactive text-white">
                  {phase === 'live' ? 'Follow live' : phase === 'final' ? 'Game recap' : 'View matchup'}
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-white shrink-0 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            ) : pregameMatchupHref ? (
              <Link href={pregameMatchupHref} className={PRIMARY_ACTION} data-scoreboard-matchup>
                <TrendingUp className="w-3.5 h-3.5 text-white shrink-0" />
                <span className="type-interactive text-white">View matchup</span>
                <ChevronRight className="w-3.5 h-3.5 text-white shrink-0 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            ) : (
              <UnavailableAction primary label={phase === 'live' ? 'Follow live' : phase === 'final' ? 'Game recap' : 'View matchup'} />
            )}
            {research && !inPlay ? (
              <Link href={propsHref} className={SECONDARY_ACTION}>
                <ListFilter className="w-3.5 h-3.5 shrink-0" />
                <span className="type-interactive">View props</span>
              </Link>
            ) : (
              <UnavailableAction primary={false} label={inPlay ? 'Box score' : 'View props'} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
