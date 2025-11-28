'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { TrendSparkline } from './TrendSparkline';

interface PropSuggestion {
  type: 'points' | 'rebounds' | 'assists' | 'threes';
  line: number;
  trend: 'over' | 'under';
  confidence: number;
  recentAvg: number;
  seasonAvg: number;
}

export interface PlayerData {
  id: string;
  name: string;
  team: string;
  teamAbbreviation: string;
  position: string;
  opponent: string;
  opponentAbbreviation: string;
  imageUrl?: string;
  props: PropSuggestion[];
  recentPoints: number[];
  recentRebounds: number[];
  recentAssists: number[];
  whyText: string;
  trendPercentage: number;
  trendDirection: 'up' | 'down';
}

interface PlayerCardProps {
  player: PlayerData;
}

function PropBadge({ prop }: { prop: PropSuggestion }) {
  const typeLabels: Record<string, string> = {
    points: 'PTS',
    rebounds: 'REB',
    assists: 'AST',
    threes: '3PM'
  };

  const isOver = prop.trend === 'over';
  const trendColor = isOver ? '#39ff14' : '#ff4757';

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-white/5 border border-white/5">
      <div className="text-center min-w-[40px]">
        <div className="text-[10px] text-muted-foreground">{typeLabels[prop.type]}</div>
        <div className="text-sm font-mono font-semibold text-white">{prop.line}</div>
      </div>
      <div className="flex flex-col items-start">
        <div className="flex items-center gap-1">
          {isOver ? (
            <TrendingUp className="w-3 h-3" style={{ color: trendColor }} />
          ) : (
            <TrendingDown className="w-3 h-3" style={{ color: trendColor }} />
          )}
          <span className="text-xs font-semibold" style={{ color: trendColor }}>
            {isOver ? 'OVER' : 'UNDER'}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          L5: {prop.recentAvg.toFixed(1)} | Szn: {prop.seasonAvg.toFixed(1)}
        </div>
      </div>
      <div className="ml-auto">
        <div 
          className="text-xs font-bold px-1.5 py-0.5 rounded"
          style={{ 
            backgroundColor: `${trendColor}20`,
            color: trendColor 
          }}
        >
          {prop.confidence}%
        </div>
      </div>
    </div>
  );
}

export function PlayerCard({ player }: PlayerCardProps) {
  const [showWhy, setShowWhy] = useState(false);

  const trendColor = player.trendDirection === 'up' ? '#39ff14' : '#ff4757';

  return (
    <div className="glass-card rounded-xl card-hover overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-start gap-3">
        {/* Player Avatar */}
        <div className="relative">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center border border-white/10 overflow-hidden">
            {player.imageUrl ? (
              <img src={player.imageUrl} alt={player.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-lg font-bold text-white/50">
                {player.name.split(' ').map(n => n[0]).join('')}
              </span>
            )}
          </div>
          {/* Team badge */}
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-md bg-secondary flex items-center justify-center border border-white/10">
            <span className="text-[8px] font-bold text-white/80">{player.teamAbbreviation}</span>
          </div>
        </div>

        {/* Player Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-white truncate">{player.name}</h3>
              <div className="text-xs text-muted-foreground">
                {player.position} • vs {player.opponent}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {player.trendDirection === 'up' ? (
                <TrendingUp className="w-3.5 h-3.5" style={{ color: trendColor }} />
              ) : (
                <TrendingDown className="w-3.5 h-3.5" style={{ color: trendColor }} />
              )}
              <span className="text-xs font-semibold" style={{ color: trendColor }}>
                {player.trendDirection === 'up' ? '+' : ''}{player.trendPercentage}%
              </span>
            </div>
          </div>

          {/* Mini Sparklines */}
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">PTS</span>
              <TrendSparkline data={player.recentPoints} color="auto" height={20} width={50} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">REB</span>
              <TrendSparkline data={player.recentRebounds} color="auto" height={20} width={50} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">AST</span>
              <TrendSparkline data={player.recentAssists} color="auto" height={20} width={50} />
            </div>
          </div>
        </div>
      </div>

      {/* Props */}
      <div className="px-4 pb-3 space-y-2">
        {player.props.map((prop, index) => (
          <PropBadge key={index} prop={prop} />
        ))}
      </div>

      {/* Why This Player */}
      <div className="border-t border-white/5">
        <button
          onClick={() => setShowWhy(!showWhy)}
          className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-2">
            <HelpCircle className="w-3.5 h-3.5 text-[#bf5af2]" />
            <span className="text-xs font-medium text-[#bf5af2]">Why this player?</span>
          </div>
          {showWhy ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>
        
        {showWhy && (
          <div className="px-4 pb-4 fade-in">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {player.whyText}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}






