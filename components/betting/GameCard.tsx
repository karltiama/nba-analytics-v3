'use client';

import Link from 'next/link';
import { Clock, TrendingUp, ChevronRight, ListFilter } from 'lucide-react';
import { gameDetailHref, propsExplorerHref } from '@/lib/betting/research-journey';
import { TeamLogo } from '@/components/nba/TeamLogo';

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
  season?: string;
}

interface GameCardProps {
  game: Game;
  /** Optional: if not provided, card links to /betting/games/[gameId] */
  onViewDetails?: (gameId: string) => void;
  /** ET YYYY-MM-DD used for Props Explorer deep links when game.gameDate is missing */
  researchDate?: string;
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
  if (s === 'scheduled') return { label: 'Scheduled', className: 'bg-[#F3F8F8] text-[#72869A] rounded-full font-medium' };
  if (s === 'in progress' || s === 'live') {
    return { label: 'In Progress', className: 'bg-[#56D6A3]/25 text-[#075B5C] rounded-full font-semibold' };
  }
  if (s === 'postponed') {
    return { label: 'Postponed', className: 'bg-amber-50 text-amber-700 rounded-full font-medium' };
  }
  if (s === 'canceled' || s === 'cancelled') {
    return { label: 'Canceled', className: 'bg-[#F3F8F8] text-[#72869A] rounded-full font-medium' };
  }
  if (s === 'unknown') {
    return { label: 'Status unavailable', className: 'bg-[#F3F8F8] text-[#72869A] rounded-full font-medium' };
  }
  return { label: status, className: 'bg-[#F3F8F8] text-[#72869A] rounded-full font-medium' };
}

function FavBadge() {
  return (
    <span className="text-[9px] px-1 py-px rounded font-bold shrink-0 bg-[#56D6A3]/30 text-[#075B5C]">
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
}: {
  team: TeamInfo;
  isFav: boolean;
}) {
  const { city, nickname } = splitTeamDisplayName(team.name);
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <TeamLogo
        team={team.abbreviation}
        size="md"
        decorative
      />
      <div className="min-w-0 leading-none">
        {city ? (
          <div className="text-[11px] text-[#72869A]">
            {city}
          </div>
        ) : null}
        <div className={`font-bold text-[#063F46] text-[13px] sm:text-sm ${city ? 'mt-0.5' : ''}`}>
          {nickname || team.name}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[11px] text-[#72869A]">{team.record ?? '—'}</span>
          {isFav ? <FavBadge /> : null}
        </div>
      </div>
    </div>
  );
}

export function GameCard({ game, onViewDetails, researchDate }: GameCardProps) {
  const dateForProps =
    (game.gameDate && /^\d{4}-\d{2}-\d{2}/.test(String(game.gameDate))
      ? String(game.gameDate).slice(0, 10)
      : null) ?? researchDate ?? undefined;
  const gameHref = gameDetailHref(game.id);
  const propsHref = propsExplorerHref({ gameId: game.id, date: dateForProps });

  const hasOdds =
    game.hasOdds ??
    (game.homeOdds.moneyline != null ||
      game.awayOdds.moneyline != null ||
      game.homeOdds.spread != null ||
      game.awayOdds.spread != null ||
      game.overUnder != null);
  const awayIsFav = game.isFavorite === 'away';
  const homeIsFav = game.isFavorite === 'home';
  const isFinal = game.status === 'Final' && game.homeScore != null && game.awayScore != null;
  const statusBadge = getStatusBadge(game.status);
  const favoredValue = (isFav: boolean) => (isFav ? 'text-[#20B95A]' : 'text-[#063F46]');

  return (
    <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 sm:px-6 py-2 flex items-center justify-between border-b border-[#DCE9EA]">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#075B5C]" />
          <span className="text-sm font-medium text-[#72869A]">{game.startTime}</span>
        </div>
        {statusBadge ? (
          <span className={`text-[10px] px-2 py-0.5 ${statusBadge.className}`}>{statusBadge.label}</span>
        ) : game.isClose ? (
          <span className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full font-semibold">
            CLOSE
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-sm font-medium text-[#72869A]">
            NBA
            <ChevronRight className="w-4 h-4" />
          </span>
        )}
      </div>

      {isFinal && (
        <div className="px-5 sm:px-6 pt-4">
          <div className="text-center py-3 rounded-xl bg-[#F8FBFA] border border-[#DCE9EA]">
            <div className="text-2xl font-bold text-[#063F46] tabular-nums">
              {game.awayScore} – {game.homeScore}
            </div>
            <div className="text-[10px] text-[#72869A] mt-0.5">
              {game.awayTeam.abbreviation} – {game.homeTeam.abbreviation}
            </div>
          </div>
        </div>
      )}

      <div className="px-5 sm:px-6 py-2">
        <div className="flex items-center gap-2 sm:gap-3">
          <TeamMatchupSide team={game.awayTeam} isFav={awayIsFav} />
          <span className="shrink-0 text-xs font-medium tracking-wide text-[#72869A]/80">
            VS
          </span>
          <TeamMatchupSide team={game.homeTeam} isFav={homeIsFav} />
        </div>
      </div>

      {hasOdds ? (
        <div className="mx-5 sm:mx-6 mb-5 grid grid-cols-3 rounded-xl border border-[#DCE9EA] overflow-hidden bg-[#F8FBFA]">
          <div className="px-2 py-3 text-center border-r border-[#DCE9EA]">
            <div className="text-[11px] uppercase tracking-wide text-[#72869A] mb-1.5 font-medium">
              SPREAD
            </div>
            <div className={`text-sm sm:text-base font-semibold ${favoredValue(awayIsFav)}`}>
              {game.awayTeam.abbreviation} {formatSpread(game.awayOdds.spread)}
            </div>
            <div className={`text-sm sm:text-base font-semibold ${favoredValue(homeIsFav)}`}>
              {game.homeTeam.abbreviation} {formatSpread(game.homeOdds.spread)}
            </div>
          </div>
          <div className="px-2 py-3 text-center border-r border-[#DCE9EA]">
            <div className="text-[11px] uppercase tracking-wide text-[#72869A] mb-1.5 font-medium">
              TOTAL
            </div>
            <div className="text-sm sm:text-base font-semibold text-[#168DD8]">
              {game.overUnder != null ? `O/U ${game.overUnder}` : '—'}
            </div>
            <div className="text-[11px] text-[#72869A] mt-0.5">
              {game.overUnder != null
                ? `O ${formatOdds(game.overOdds)} / U ${formatOdds(game.underOdds)}`
                : ''}
            </div>
          </div>
          <div className="px-2 py-3 text-center">
            <div className="text-[11px] uppercase tracking-wide text-[#72869A] mb-1.5 font-medium">
              ML
            </div>
            <div className={`text-sm sm:text-base font-semibold ${favoredValue(awayIsFav)}`}>
              {game.awayTeam.abbreviation} {formatOdds(game.awayOdds.moneyline)}
            </div>
            <div className={`text-sm sm:text-base font-semibold ${favoredValue(homeIsFav)}`}>
              {game.homeTeam.abbreviation} {formatOdds(game.homeOdds.moneyline)}
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-5 sm:mx-6 mb-5 rounded-xl border border-[#DCE9EA] bg-[#F8FBFA] px-3 py-3 text-center">
          <div className="text-[11px] text-[#72869A]">No odds yet</div>
        </div>
      )}

      {game.matchupContext ? (
        <div className="mx-5 sm:mx-6 mb-3 rounded-xl bg-[#F8FBFA] border border-[#DCE9EA] px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide font-medium text-center">
            <span className="text-[#72869A]">Matchup </span>
            <span className="text-[#55ddb1]">Context</span>
          </div>
          <p className="text-[12px] text-[#063F46] leading-snug mt-1 text-pretty">{game.matchupContext}</p>
        </div>
      ) : null}

      {hasOdds && game.homeImpliedProb != null && game.awayImpliedProb != null ? (
        <div className="px-5 sm:px-6 pb-5">
          <div className="flex items-center gap-2.5">
            <div className="text-left shrink-0">
              <div className="text-xs font-medium text-[#72869A] leading-none">{game.awayTeam.abbreviation}</div>
              <div className="text-sm font-bold text-[#063F46] tabular-nums mt-0.5">{game.awayImpliedProb}%</div>
            </div>
            <div className="flex-1 flex h-2 bg-[#E8F0F1] rounded-full overflow-hidden min-w-0">
              <div
                className="h-full rounded-l-full bg-[#168DD8] min-w-0"
                style={{ flex: game.awayImpliedProb }}
              />
              <div
                className="h-full rounded-r-full bg-[#20B95A] min-w-0"
                style={{ flex: game.homeImpliedProb }}
              />
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-medium text-[#72869A] leading-none">{game.homeTeam.abbreviation}</div>
              <div className="text-sm font-bold text-[#063F46] tabular-nums mt-0.5">{game.homeImpliedProb}%</div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="px-5 sm:px-6 pb-5 flex flex-col sm:flex-row gap-2.5">
        <Link
          href={gameHref}
          onClick={() => onViewDetails?.(game.id)}
          className="sm:flex-[1.22] min-w-0 px-3 py-3 flex items-center justify-center gap-1.5 rounded-xl bg-[#075B5C] hover:bg-[#064D4E] transition-colors group whitespace-nowrap"
        >
          <TrendingUp className="w-3.5 h-3.5 text-white shrink-0" />
          <span className="text-sm font-semibold text-white">View matchup</span>
          <ChevronRight className="w-3.5 h-3.5 text-white shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </Link>
        <Link
          href={propsHref}
          className="sm:flex-1 min-w-0 px-3 py-3 flex items-center justify-center gap-1.5 rounded-xl bg-[#F3F8F8] border border-[#DCE9EA] text-[#063F46] hover:bg-[#EAF3F3] transition-colors whitespace-nowrap"
        >
          <ListFilter className="w-3.5 h-3.5 shrink-0" />
          <span className="text-sm font-semibold">View props</span>
        </Link>
      </div>
    </div>
  );
}
