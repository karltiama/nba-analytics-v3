'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Shield, Zap, Target, BarChart3, ArrowLeftRight, Users } from 'lucide-react';

interface OpponentDefensiveRankings {
  team_id: string;
  points_allowed_rank: number;
  rebounds_allowed_rank: number;
  assists_allowed_rank: number;
  threes_allowed_rank: number;
  points_allowed_per_game: number;
  rebounds_allowed_per_game: number;
  assists_allowed_per_game: number;
  threes_allowed_per_game: number;
  defensive_rating: number;
}

interface TeamOffensiveRankings {
  team_id: string;
  points_rank: number;
  rebounds_rank: number;
  assists_rank: number;
  threes_rank: number;
  points_per_game: number;
  rebounds_per_game: number;
  assists_per_game: number;
  threes_per_game: number;
  offensive_rating: number;
}

interface PlayerVsOpponentStats {
  player_id: string;
  player_name: string;
  team_id: string;
  games_played: number;
  avg_points: number;
  avg_rebounds: number;
  avg_assists: number;
  avg_threes: number;
  season_avg_points: number;
  season_avg_rebounds: number;
  season_avg_assists: number;
  season_avg_threes: number;
  points_diff: number;
  rebounds_diff: number;
  assists_diff: number;
  threes_diff: number;
}

interface PaceAnalysis {
  home_team_pace: number;
  away_team_pace: number;
  projected_pace: number;
  pace_advantage: 'home' | 'away' | 'neutral';
  pace_impact: 'fast' | 'average' | 'slow';
}

interface StartingLineupPlayer {
  player_id: string;
  full_name: string;
  position: string;
  games_started: number;
  avg_points: number;
  avg_minutes: number;
}

interface StartingLineup {
  team_id: string;
  players: StartingLineupPlayer[];
}

interface MatchupAnalysisData {
  game_id: string;
  home_team_id: string;
  away_team_id: string;
  home_offense: TeamOffensiveRankings | null;
  away_offense: TeamOffensiveRankings | null;
  home_defense: OpponentDefensiveRankings | null;
  away_defense: OpponentDefensiveRankings | null;
  pace_analysis: PaceAnalysis;
  key_players: PlayerVsOpponentStats[];
  starting_lineups: {
    home: StartingLineup | null;
    away: StartingLineup | null;
  };
}

interface MatchupAnalysisProps {
  data: MatchupAnalysisData;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
}

function RankBadge({ rank, total = 30 }: { rank: number; total?: number }) {
  const percentile = ((total - rank + 1) / total) * 100;
  let color = 'text-muted-foreground bg-white/5';
  
  if (percentile >= 70) {
    color = 'text-[#39ff14] bg-[#39ff14]/20'; // Top 30% - favorable
  } else if (percentile >= 40) {
    color = 'text-[#ff6b35] bg-[#ff6b35]/20'; // Middle 30% - neutral
  } else {
    color = 'text-[#ff4757] bg-[#ff4757]/20'; // Bottom 40% - tough
  }

  return (
    <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${color}`}>
      #{rank}
    </span>
  );
}

function StatDiff({ diff, stat }: { diff: number; stat: string }) {
  const isPositive = diff > 0;
  const isSignificant = Math.abs(diff) >= 1;
  
  if (!isSignificant) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex items-center gap-1">
      {isPositive ? (
        <TrendingUp className="w-3 h-3 text-[#39ff14]" />
      ) : (
        <TrendingDown className="w-3 h-3 text-[#ff4757]" />
      )}
      <span className={`text-xs font-medium ${isPositive ? 'text-[#39ff14]' : 'text-[#ff4757]'}`}>
        {isPositive ? '+' : ''}{diff.toFixed(1)}
      </span>
    </div>
  );
}

interface StatComparisonRowProps {
  label: string;
  offenseRank: number;
  offenseValue: number;
  defenseRank: number;
  defenseValue: number;
  maxValue: number;
  offenseLabel?: string;
  defenseLabel?: string;
  isSwapped?: boolean; // When true, defense is on left, offense is on right
}

function StatComparisonRow({ label, offenseRank, offenseValue, defenseRank, defenseValue, maxValue, offenseLabel, defenseLabel, isSwapped = false }: StatComparisonRowProps) {
  // Calculate bar split based on rankings
  // Lower rank number = better (1st is best)
  // We want the better-ranked team to take more of the line
  // Convert ranks to percentages: rank 1 = 100%, rank 30 = ~3%
  // Use inverse ranking: (31 - rank) / 30 gives us a 0-1 scale where 1 is best
  
  const offenseScore = (31 - offenseRank) / 30; // Higher is better
  const defenseScore = (31 - defenseRank) / 30; // Higher is better (lower rank = allows less)
  
  const totalScore = offenseScore + defenseScore;
  const offensePercentage = totalScore > 0 ? (offenseScore / totalScore) * 100 : 50;
  const defensePercentage = 100 - offensePercentage;
  
  // When swapped, defense is on left, offense is on right
  const leftPercentage = isSwapped ? defensePercentage : offensePercentage;
  const rightPercentage = isSwapped ? offensePercentage : defensePercentage;
  const leftValue = isSwapped ? defenseValue : offenseValue;
  const rightValue = isSwapped ? offenseValue : defenseValue;
  const leftRank = isSwapped ? defenseRank : offenseRank;
  const rightRank = isSwapped ? offenseRank : defenseRank;
  const leftLabel = isSwapped ? (defenseLabel || 'Defense') : (offenseLabel || 'Offense');
  const rightLabel = isSwapped ? (offenseLabel || 'Offense') : (defenseLabel || 'Defense');
  const leftColor = isSwapped ? 'bg-[#ff4757]/40' : 'bg-[#39ff14]/40';
  const rightColor = isSwapped ? 'bg-[#39ff14]/40' : 'bg-[#ff4757]/40';
  
  // Determine advantage
  const hasOffenseAdvantage = offenseRank < defenseRank; // Offense rank is better (lower number)
  const hasDefenseAdvantage = defenseRank < offenseRank; // Defense rank is better (lower number)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      
      {/* Single horizontal bar divided by ranking */}
      <div className="relative w-full">
        {/* Container bar */}
        <div className="relative w-full h-3 bg-white/5 rounded overflow-hidden flex">
          {/* Left portion */}
          <div 
            className={`h-full ${leftColor} flex items-center justify-start pl-1.5`}
            style={{ width: `${leftPercentage}%` }}
          >
            <span className="text-[9px] font-medium text-white">
              {leftValue.toFixed(1)}
            </span>
          </div>
          
          {/* Right portion */}
          <div 
            className={`h-full ${rightColor} flex items-center justify-end pr-1.5`}
            style={{ width: `${rightPercentage}%` }}
          >
            <span className="text-[9px] font-medium text-white">
              {rightValue.toFixed(1)}
            </span>
          </div>
        </div>
        
        {/* Rankings below the bar */}
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1.5 flex-1 justify-center">
            <span className="text-[9px] text-muted-foreground">{leftLabel}</span>
            <RankBadge rank={leftRank} />
          </div>
          <div className="flex items-center gap-1.5 flex-1 justify-center">
            <RankBadge rank={rightRank} />
            <span className="text-[9px] text-muted-foreground">{rightLabel}</span>
          </div>
        </div>
      </div>
      
      {/* Advantage indicator */}
      {(hasOffenseAdvantage || hasDefenseAdvantage) && (
        <div className="flex items-center justify-center gap-1 pt-0.5">
          {hasOffenseAdvantage && (
            <span className="text-[9px] text-[#39ff14] font-medium">Offensive Advantage</span>
          )}
          {hasDefenseAdvantage && (
            <span className="text-[9px] text-[#ff4757] font-medium">Defensive Advantage</span>
          )}
        </div>
      )}
    </div>
  );
}

function OffenseVsDefenseComparison({ 
  offenseTeam, 
  defenseTeam, 
  offenseAbbr, 
  defenseAbbr,
  isSwapped
}: { 
  offenseTeam: TeamOffensiveRankings | null;
  defenseTeam: OpponentDefensiveRankings | null;
  offenseAbbr: string;
  defenseAbbr: string;
  isSwapped?: boolean;
}) {
  if (!offenseTeam || !defenseTeam) {
    return (
      <div className="glass-card rounded-xl p-4">
        <p className="text-xs text-muted-foreground">No matchup data available</p>
      </div>
    );
  }

  // Calculate max values for normalization (not used for bar width, but kept for potential future use)
  const maxPoints = Math.max(offenseTeam.points_per_game, defenseTeam.points_allowed_per_game) * 1.1;
  const maxRebounds = Math.max(offenseTeam.rebounds_per_game, defenseTeam.rebounds_allowed_per_game) * 1.1;
  const maxAssists = Math.max(offenseTeam.assists_per_game, defenseTeam.assists_allowed_per_game) * 1.1;
  const maxThrees = Math.max(offenseTeam.threes_per_game, defenseTeam.threes_allowed_per_game) * 1.1;

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="space-y-3">
        <StatComparisonRow
          label="Points"
          offenseRank={offenseTeam.points_rank}
          offenseValue={offenseTeam.points_per_game}
          defenseRank={defenseTeam.points_allowed_rank}
          defenseValue={defenseTeam.points_allowed_per_game}
          maxValue={maxPoints}
          offenseLabel={offenseAbbr}
          defenseLabel={defenseAbbr}
          isSwapped={isSwapped}
        />
        
        <div className="border-t border-white/5 pt-3">
          <StatComparisonRow
            label="Rebounds"
            offenseRank={offenseTeam.rebounds_rank}
            offenseValue={offenseTeam.rebounds_per_game}
            defenseRank={defenseTeam.rebounds_allowed_rank}
            defenseValue={defenseTeam.rebounds_allowed_per_game}
            maxValue={maxRebounds}
            offenseLabel={offenseAbbr}
            defenseLabel={defenseAbbr}
            isSwapped={isSwapped}
          />
        </div>
        
        <div className="border-t border-white/5 pt-3">
          <StatComparisonRow
            label="Assists"
            offenseRank={offenseTeam.assists_rank}
            offenseValue={offenseTeam.assists_per_game}
            defenseRank={defenseTeam.assists_allowed_rank}
            defenseValue={defenseTeam.assists_allowed_per_game}
            maxValue={maxAssists}
            offenseLabel={offenseAbbr}
            defenseLabel={defenseAbbr}
            isSwapped={isSwapped}
          />
        </div>
        
        <div className="border-t border-white/5 pt-3">
          <StatComparisonRow
            label="3PM"
            offenseRank={offenseTeam.threes_rank}
            offenseValue={offenseTeam.threes_per_game}
            defenseRank={defenseTeam.threes_allowed_rank}
            defenseValue={defenseTeam.threes_allowed_per_game}
            maxValue={maxThrees}
            offenseLabel={offenseAbbr}
            defenseLabel={defenseAbbr}
            isSwapped={isSwapped}
          />
        </div>
      </div>
    </div>
  );
}

function PaceAnalysisCard({ paceAnalysis }: { paceAnalysis: PaceAnalysis }) {
  const { home_team_pace, away_team_pace, projected_pace, pace_advantage, pace_impact } = paceAnalysis;
  
  const paceColor = pace_impact === 'fast' 
    ? 'text-[#39ff14]' 
    : pace_impact === 'slow' 
      ? 'text-[#ff4757]' 
      : 'text-[#ff6b35]';

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-[#00d4ff]" />
        <h4 className="text-xs font-semibold text-white">Pace Analysis</h4>
      </div>
      
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-2 rounded-lg bg-white/5">
            <div className="text-[10px] text-muted-foreground mb-1">Home Pace</div>
            <div className="text-sm font-bold text-white">{home_team_pace.toFixed(1)}</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-white/5">
            <div className="text-[10px] text-muted-foreground mb-1">Away Pace</div>
            <div className="text-sm font-bold text-white">{away_team_pace.toFixed(1)}</div>
          </div>
        </div>
        
        <div className="border-t border-white/5 pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-muted-foreground">Projected Game Pace</span>
            <span className={`text-sm font-bold ${paceColor}`}>{projected_pace.toFixed(1)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Pace Impact</span>
            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
              pace_impact === 'fast' 
                ? 'bg-[#39ff14]/20 text-[#39ff14]' 
                : pace_impact === 'slow' 
                  ? 'bg-[#ff4757]/20 text-[#ff4757]' 
                  : 'bg-[#ff6b35]/20 text-[#ff6b35]'
            }`}>
              {pace_impact.toUpperCase()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerMatchupCard({ player, opponentAbbr }: { player: PlayerVsOpponentStats; opponentAbbr: string }) {
  return (
    <div className="glass-card rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h5 className="text-xs font-semibold text-white">{player.player_name}</h5>
          <p className="text-[10px] text-muted-foreground">
            {player.games_played} games vs {opponentAbbr}
          </p>
        </div>
      </div>
      
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Points</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white">
              {player.avg_points.toFixed(1)} (vs {player.season_avg_points.toFixed(1)} avg)
            </span>
            <StatDiff diff={player.points_diff} stat="points" />
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Rebounds</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white">
              {player.avg_rebounds.toFixed(1)} (vs {player.season_avg_rebounds.toFixed(1)} avg)
            </span>
            <StatDiff diff={player.rebounds_diff} stat="rebounds" />
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Assists</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white">
              {player.avg_assists.toFixed(1)} (vs {player.season_avg_assists.toFixed(1)} avg)
            </span>
            <StatDiff diff={player.assists_diff} stat="assists" />
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">3PM</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white">
              {player.avg_threes.toFixed(1)} (vs {player.season_avg_threes.toFixed(1)} avg)
            </span>
            <StatDiff diff={player.threes_diff} stat="threes" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function MatchupAnalysis({ data, homeTeamAbbr, awayTeamAbbr }: MatchupAnalysisProps) {
  const { home_offense, away_offense, home_defense, away_defense, pace_analysis, key_players } = data;
  
  // Toggle state: false = Away Offense vs Home Defense, true = Home Offense vs Away Defense
  const [isSwapped, setIsSwapped] = useState(false);

  // Separate key players by team
  const homePlayers = key_players.filter(p => p.team_id === data.home_team_id);
  const awayPlayers = key_players.filter(p => p.team_id === data.away_team_id);

  // Teams always stay in same position: Away (left) vs Home (right)
  // Toggle switches what stat is shown: Offense vs Defense
  // Default: Away Offense (left) vs Home Defense (right)
  // Swapped: Away Defense (left) vs Home Offense (right)
  const leftLabel = isSwapped ? `${awayTeamAbbr} Defense` : `${awayTeamAbbr} Offense`;
  const rightLabel = isSwapped ? `${homeTeamAbbr} Offense` : `${homeTeamAbbr} Defense`;
  
  // For the comparison component, we need to pass offense and defense
  // The component always expects: offense (left) vs defense (right)
  // When not swapped: Away Offense vs Home Defense
  // When swapped: Home Offense vs Away Defense (but displayed as Away Defense vs Home Offense)
  const offenseTeam = isSwapped ? home_offense : away_offense;
  const defenseTeam = isSwapped ? away_defense : home_defense;
  const offenseAbbr = isSwapped ? homeTeamAbbr : awayTeamAbbr;
  const defenseAbbr = isSwapped ? awayTeamAbbr : homeTeamAbbr;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#bf5af2]" />
          <h3 className="text-sm font-semibold text-white">Matchup Analysis</h3>
        </div>
      </div>

      {/* Pace Analysis */}
      <PaceAnalysisCard paceAnalysis={pace_analysis} />

      {/* Offense vs Defense Comparison */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-1 justify-center">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#39ff14]" />
              <span className="text-xs font-semibold text-white">{leftLabel}</span>
            </div>
            <ArrowLeftRight 
              className="w-4 h-4 text-muted-foreground cursor-pointer hover:text-white transition-colors"
              onClick={() => setIsSwapped(!isSwapped)}
            />
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#ff4757]" />
              <span className="text-xs font-semibold text-white">{rightLabel}</span>
            </div>
          </div>
          <button
            onClick={() => setIsSwapped(!isSwapped)}
            className="text-[10px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-muted-foreground hover:text-white transition-colors"
          >
            Switch
          </button>
        </div>
        
        <OffenseVsDefenseComparison
          offenseTeam={offenseTeam as TeamOffensiveRankings | null}
          defenseTeam={defenseTeam as OpponentDefensiveRankings | null}
          offenseAbbr={offenseAbbr}
          defenseAbbr={defenseAbbr}
          isSwapped={isSwapped}
        />
      </div>

      {/* Key Player Matchups */}
      {(homePlayers.length > 0 || awayPlayers.length > 0) && (
        <div>
          <h4 className="text-xs font-semibold text-white mb-3">Key Player Matchups</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {awayPlayers.map((player) => (
              <PlayerMatchupCard 
                key={player.player_id} 
                player={player} 
                opponentAbbr={homeTeamAbbr}
              />
            ))}
            {homePlayers.map((player) => (
              <PlayerMatchupCard 
                key={player.player_id} 
                player={player} 
                opponentAbbr={awayTeamAbbr}
              />
            ))}
          </div>
        </div>
      )}

      {/* Projected Starting Lineups */}
      {data.starting_lineups && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-[#bf5af2]" />
            <h4 className="text-xs font-semibold text-white">Projected Starting Lineups</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.starting_lineups.away ? (
              <StartingLineupCard 
                lineup={data.starting_lineups.away}
                teamAbbr={awayTeamAbbr}
              />
            ) : (
              <div className="glass-card rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                    <span className="text-xs font-bold">{awayTeamAbbr}</span>
                  </div>
                  <h5 className="text-xs font-semibold text-white">{awayTeamAbbr} Starting 5</h5>
                </div>
                <p className="text-xs text-muted-foreground text-center py-4">
                  No starting lineup data available
                </p>
              </div>
            )}
            {data.starting_lineups.home ? (
              <StartingLineupCard 
                lineup={data.starting_lineups.home}
                teamAbbr={homeTeamAbbr}
              />
            ) : (
              <div className="glass-card rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                    <span className="text-xs font-bold">{homeTeamAbbr}</span>
                  </div>
                  <h5 className="text-xs font-semibold text-white">{homeTeamAbbr} Starting 5</h5>
                </div>
                <p className="text-xs text-muted-foreground text-center py-4">
                  No starting lineup data available
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StartingLineupCard({ lineup, teamAbbr }: { lineup: StartingLineup; teamAbbr: string }) {
  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
          <span className="text-xs font-bold">{teamAbbr}</span>
        </div>
        <h5 className="text-xs font-semibold text-white">{teamAbbr} Starting 5</h5>
      </div>
      
      <div className="space-y-2">
        {lineup.players.map((player, index) => (
          <Link
            key={player.player_id}
            href={`/players/${player.player_id}`}
            className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-white/5 transition-colors border-b border-white/5 last:border-0"
          >
            <div className="flex items-center gap-2 flex-1">
              <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center">
                <span className="text-[9px] font-bold text-white">{index + 1}</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white">{player.full_name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground">
                    {player.position}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[9px] text-muted-foreground">
                    {player.games_started} starts
                  </span>
                  <span className="text-[9px] text-muted-foreground">•</span>
                  <span className="text-[9px] text-muted-foreground">
                    {player.avg_points.toFixed(1)} PPG
                  </span>
                  <span className="text-[9px] text-muted-foreground">•</span>
                  <span className="text-[9px] text-muted-foreground">
                    {player.avg_minutes.toFixed(1)} MPG
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
      
      {lineup.players.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          No starting lineup data available
        </p>
      )}
    </div>
  );
}

