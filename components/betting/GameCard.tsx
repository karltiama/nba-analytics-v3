'use client';

import { Clock, TrendingUp, ChevronRight } from 'lucide-react';

interface TeamInfo {
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
}

interface GameCardProps {
  game: Game;
  onViewDetails: (gameId: string) => void;
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatSpread(spread: number): string {
  if (spread > 0) return `+${spread}`;
  return `${spread}`;
}

function TeamLogo({ team }: { team: TeamInfo }) {
  // Placeholder logo with team abbreviation
  return (
    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center border border-white/10">
      <span className="text-sm font-bold text-white/80">{team.abbreviation}</span>
    </div>
  );
}

export function GameCard({ game, onViewDetails }: GameCardProps) {
  const borderClass = game.isClose 
    ? 'border-l-[#ff6b35]' 
    : game.isFavorite === 'home' 
      ? 'border-l-[#39ff14]' 
      : 'border-l-[#39ff14]';

  return (
    <div 
      className={`glass-card rounded-xl border-l-4 ${borderClass} card-hover overflow-hidden`}
    >
      {/* Header with time */}
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-[#00d4ff]" />
          <span className="text-xs font-medium text-muted-foreground">{game.startTime}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {game.isClose && (
            <span className="text-[10px] px-2 py-0.5 bg-[#ff6b35]/20 text-[#ff6b35] rounded-full font-semibold">
              CLOSE MATCHUP
            </span>
          )}
        </div>
      </div>

      {/* Teams Section */}
      <div className="p-4 space-y-3">
        {/* Away Team */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TeamLogo team={game.awayTeam} />
            <div>
              <div className="font-semibold text-white">{game.awayTeam.name}</div>
              <div className="text-xs text-muted-foreground">{game.awayTeam.record}</div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-right">
            <div>
              <div className={`text-sm font-mono font-semibold ${game.awayOdds.moneyline < game.homeOdds.moneyline ? 'text-[#39ff14]' : 'text-white'}`}>
                {formatOdds(game.awayOdds.moneyline)}
              </div>
              <div className="text-[10px] text-muted-foreground">ML</div>
            </div>
            <div>
              <div className="text-sm font-mono font-medium text-white">
                {formatSpread(game.awayOdds.spread)}
              </div>
              <div className="text-[10px] text-muted-foreground">{formatOdds(game.awayOdds.spreadOdds)}</div>
            </div>
          </div>
        </div>

        {/* VS Divider */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] text-muted-foreground font-medium">VS</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Home Team */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TeamLogo team={game.homeTeam} />
            <div>
              <div className="font-semibold text-white">{game.homeTeam.name}</div>
              <div className="text-xs text-muted-foreground">{game.homeTeam.record}</div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-right">
            <div>
              <div className={`text-sm font-mono font-semibold ${game.homeOdds.moneyline < game.awayOdds.moneyline ? 'text-[#39ff14]' : 'text-white'}`}>
                {formatOdds(game.homeOdds.moneyline)}
              </div>
              <div className="text-[10px] text-muted-foreground">ML</div>
            </div>
            <div>
              <div className="text-sm font-mono font-medium text-white">
                {formatSpread(game.homeOdds.spread)}
              </div>
              <div className="text-[10px] text-muted-foreground">{formatOdds(game.homeOdds.spreadOdds)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Over/Under & Probabilities */}
      <div className="px-4 py-3 border-t border-white/5 bg-white/[0.02]">
        <div className="flex items-center justify-between">
          {/* O/U */}
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="text-[10px] text-muted-foreground mb-0.5">O/U</div>
              <div className="text-sm font-mono font-semibold text-[#00d4ff]">{game.overUnder}</div>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="text-white/60">O {formatOdds(game.overOdds)}</span>
              <span className="mx-1.5">/</span>
              <span className="text-white/60">U {formatOdds(game.underOdds)}</span>
            </div>
          </div>

          {/* Implied Probabilities */}
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-[10px] text-muted-foreground mb-0.5">{game.awayTeam.abbreviation}</div>
              <div className="text-xs font-medium text-white">{game.awayImpliedProb}%</div>
            </div>
            <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-[#00d4ff] to-[#39ff14] rounded-full transition-all duration-500"
                style={{ width: `${game.homeImpliedProb}%` }}
              />
            </div>
            <div className="text-center">
              <div className="text-[10px] text-muted-foreground mb-0.5">{game.homeTeam.abbreviation}</div>
              <div className="text-xs font-medium text-white">{game.homeImpliedProb}%</div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Button */}
      <button
        onClick={() => onViewDetails(game.id)}
        className="w-full px-4 py-2.5 flex items-center justify-center gap-2 bg-[#00d4ff]/10 hover:bg-[#00d4ff]/20 transition-colors group"
      >
        <TrendingUp className="w-3.5 h-3.5 text-[#00d4ff]" />
        <span className="text-xs font-medium text-[#00d4ff]">View Game Details</span>
        <ChevronRight className="w-3.5 h-3.5 text-[#00d4ff] group-hover:translate-x-0.5 transition-transform" />
      </button>
    </div>
  );
}








