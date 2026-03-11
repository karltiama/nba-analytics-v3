'use client';

import Link from 'next/link';
import { Clock, TrendingUp, ChevronRight, Gauge, ShieldAlert } from 'lucide-react';

interface TeamInfo {
  id: string;
  name: string;
  abbreviation: string;
  logo?: string;
  record: string;
}

interface OddsInfo {
  moneyline: number;
  spread: number;
  spreadOdds: number;
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
  overUnder: number;
  overOdds: number;
  underOdds: number;
  homeImpliedProb: number;
  awayImpliedProb: number;
  isFavorite: 'home' | 'away';
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
  /** Game status: Final, Scheduled, Live, etc. */
  status?: string;
  /** Final score when status === 'Final' */
  homeScore?: number | null;
  awayScore?: number | null;
}

interface GameCardProps {
  game: Game;
  /** Optional: if not provided, card links to /betting/games/[gameId] */
  onViewDetails?: (gameId: string) => void;
}

function formatOdds(odds: number): string {
  if (odds === 0) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatSpread(spread: number): string {
  if (spread === 0) return '—';
  if (spread > 0) return `+${spread}`;
  return `${spread}`;
}

function TeamLogo({ team }: { team: TeamInfo }) {
  return (
    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center border border-white/10">
      <span className="text-xs font-bold text-white/80">{team.abbreviation}</span>
    </div>
  );
}

const PACE_COLORS: Record<string, string> = {
  FAST: '#39ff14',
  AVG: '#00d4ff',
  SLOW: '#ff6b35',
};

function getStatusBadge(status: string | undefined): { label: string; className: string } | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === 'final') return { label: 'FINAL', className: 'bg-white/20 text-white rounded-full font-semibold' };
  if (s === 'scheduled') return { label: 'Scheduled', className: 'bg-[#00d4ff]/20 text-[#00d4ff] rounded-full font-medium' };
  if (s === 'live' || s.includes('live')) return { label: 'Live', className: 'bg-[#39ff14]/20 text-[#39ff14] rounded-full font-semibold' };
  return { label: status, className: 'bg-white/10 text-muted-foreground rounded-full font-medium' };
}

export function GameCard({ game, onViewDetails }: GameCardProps) {
  const gameHref = `/betting/games/${game.id}`;
  const borderClass = game.isClose
    ? 'border-l-[#ff6b35]'
    : 'border-l-[#39ff14]';

  const hasOdds = game.homeOdds.moneyline !== 0 || game.awayOdds.moneyline !== 0;
  const awayIsFav = game.isFavorite === 'away';
  const homeIsFav = game.isFavorite === 'home';
  const isFinal = game.status === 'Final' && game.homeScore != null && game.awayScore != null;
  const statusBadge = getStatusBadge(game.status);

  return (
    <div className={`glass-card rounded-xl border-l-4 ${borderClass} card-hover overflow-hidden`}>
      {/* Header */}
      <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-[#00d4ff]" />
          <span className="text-xs font-medium text-muted-foreground">{game.startTime}</span>
        </div>
        {statusBadge ? (
          <span className={`text-[10px] px-2 py-0.5 ${statusBadge.className}`}>
            {statusBadge.label}
          </span>
        ) : game.isClose ? (
          <span className="text-[10px] px-2 py-0.5 bg-[#ff6b35]/20 text-[#ff6b35] rounded-full font-semibold">
            CLOSE
          </span>
        ) : null}
      </div>

      {/* Final score (past games) */}
      {isFinal && (
        <div className="px-4 pt-3 pb-1">
          <div className="text-center py-2 rounded-lg bg-white/[0.04] border border-white/5">
            <div className="text-2xl font-bold text-white tabular-nums">
              {game.awayScore} – {game.homeScore}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {game.awayTeam.abbreviation} – {game.homeTeam.abbreviation}
            </div>
          </div>
        </div>
      )}

      {/* Teams */}
      <div className={`px-4 space-y-2 ${isFinal ? 'pt-2 pb-2' : 'pt-3 pb-2'}`}>
        {/* Away */}
        <div className="flex items-center gap-3">
          <TeamLogo team={game.awayTeam} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white text-sm truncate">{game.awayTeam.name}</div>
            <div className="text-[11px] text-muted-foreground">{game.awayTeam.record}</div>
          </div>
          {awayIsFav && (
            <span className="text-[9px] px-1.5 py-0.5 bg-[#39ff14]/15 text-[#39ff14] rounded font-bold shrink-0">
              FAV
            </span>
          )}
        </div>

        {/* VS */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] text-muted-foreground/60 font-medium">VS</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Home */}
        <div className="flex items-center gap-3">
          <TeamLogo team={game.homeTeam} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white text-sm truncate">{game.homeTeam.name}</div>
            <div className="text-[11px] text-muted-foreground">{game.homeTeam.record}</div>
          </div>
          {homeIsFav && (
            <span className="text-[9px] px-1.5 py-0.5 bg-[#39ff14]/15 text-[#39ff14] rounded font-bold shrink-0">
              FAV
            </span>
          )}
        </div>
      </div>

      {/* 3-Column Odds Row */}
      <div className="mx-4 mb-3 grid grid-cols-3 rounded-lg border border-white/5 overflow-hidden bg-white/[0.02]">
        {/* Spread */}
        <div className="px-2 py-2 text-center border-r border-white/5">
          <div className="text-[10px] text-muted-foreground mb-1 font-medium">SPREAD</div>
          <div className={`text-xs font-mono font-semibold ${awayIsFav ? 'text-[#39ff14]' : 'text-white'}`}>
            {game.awayTeam.abbreviation} {formatSpread(game.awayOdds.spread)}
          </div>
          <div className={`text-xs font-mono font-semibold ${homeIsFav ? 'text-[#39ff14]' : 'text-white'}`}>
            {game.homeTeam.abbreviation} {formatSpread(game.homeOdds.spread)}
          </div>
        </div>

        {/* Total */}
        <div className="px-2 py-2 text-center border-r border-white/5">
          <div className="text-[10px] text-muted-foreground mb-1 font-medium">TOTAL</div>
          <div className="text-xs font-mono font-semibold text-[#00d4ff]">
            {game.overUnder ? `O/U ${game.overUnder}` : '—'}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">
            {game.overUnder ? `O ${formatOdds(game.overOdds)} / U ${formatOdds(game.underOdds)}` : ''}
          </div>
        </div>

        {/* Moneyline */}
        <div className="px-2 py-2 text-center">
          <div className="text-[10px] text-muted-foreground mb-1 font-medium">ML</div>
          <div className={`text-xs font-mono font-semibold ${awayIsFav ? 'text-[#39ff14]' : 'text-white'}`}>
            {game.awayTeam.abbreviation} {formatOdds(game.awayOdds.moneyline)}
          </div>
          <div className={`text-xs font-mono font-semibold ${homeIsFav ? 'text-[#39ff14]' : 'text-white'}`}>
            {game.homeTeam.abbreviation} {formatOdds(game.homeOdds.moneyline)}
          </div>
        </div>
      </div>

      {/* Signals Row: Pace + Weakness */}
      {(game.paceSignal || game.weakness) && (
        <div className="mx-4 mb-3 flex items-stretch gap-2">
          {game.paceSignal && (
            <div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2">
              <Gauge className="w-3.5 h-3.5 mb-1" style={{ color: PACE_COLORS[game.paceSignal.label] ?? '#00d4ff' }} />
              <span
                className="text-[10px] font-bold leading-none"
                style={{ color: PACE_COLORS[game.paceSignal.label] ?? '#00d4ff' }}
              >
                {game.paceSignal.label} PACE
              </span>
              <div className="text-[10px] text-muted-foreground font-mono leading-none mt-1">
                Proj: {game.paceSignal.projected.toFixed(1)}
              </div>
            </div>
          )}
          {game.weakness && (
            <div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2">
              <ShieldAlert className="w-3.5 h-3.5 text-[#ff4757] mb-1" />
              <span className="text-[10px] font-bold text-[#ff4757] leading-none">
                {game.weakness.team} {game.weakness.label}
              </span>
              <div className="text-[10px] text-muted-foreground font-mono leading-none mt-1">
                Rank: {game.weakness.rank}th
              </div>
            </div>
          )}
        </div>
      )}

      {/* Implied Probabilities — only show when real odds exist */}
      {hasOdds ? (
        <div className="px-4 py-2.5 border-t border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="text-[10px] text-muted-foreground">{game.awayTeam.abbreviation}</div>
              <div className="text-xs font-semibold text-white">{game.awayImpliedProb}%</div>
            </div>
            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#00d4ff] to-[#39ff14] rounded-full transition-all duration-500"
                style={{ width: `${game.homeImpliedProb}%` }}
              />
            </div>
            <div className="text-center">
              <div className="text-[10px] text-muted-foreground">{game.homeTeam.abbreviation}</div>
              <div className="text-xs font-semibold text-white">{game.homeImpliedProb}%</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-4 py-2 border-t border-white/5 bg-white/[0.02]">
          <div className="text-[10px] text-center text-muted-foreground/60">No odds available</div>
        </div>
      )}

      {/* Action Button */}
      <Link
        href={gameHref}
        onClick={() => onViewDetails?.(game.id)}
        className="w-full px-4 py-2 flex items-center justify-center gap-2 bg-[#00d4ff]/10 hover:bg-[#00d4ff]/20 transition-colors group"
      >
        <TrendingUp className="w-3.5 h-3.5 text-[#00d4ff]" />
        <span className="text-xs font-medium text-[#00d4ff]">View Game Details</span>
        <ChevronRight className="w-3.5 h-3.5 text-[#00d4ff] group-hover:translate-x-0.5 transition-transform" />
      </Link>
    </div>
  );
}
