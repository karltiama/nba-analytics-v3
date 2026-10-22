'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Shield, Zap, Target, BarChart3, ArrowLeftRight, Users } from 'lucide-react';

export interface OpponentDefensiveRankings {
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

export interface TeamOffensiveRankings {
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

export interface PlayerVsOpponentStats {
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

export interface PaceAnalysis {
  home_team_pace: number;
  away_team_pace: number;
  projected_pace: number;
  pace_advantage: 'home' | 'away' | 'neutral';
  pace_impact: 'fast' | 'average' | 'slow';
}

export interface StartingLineupPlayer {
  player_id: string;
  full_name: string;
  position: string;
  games_started: number;
  avg_points: number;
  avg_minutes: number;
}

export interface StartingLineup {
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
  pace_analysis: PaceAnalysis | null;
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
  let color = 'text-[#4a6366] bg-[#F8FBFA]';
  
  if (percentile >= 70) {
    color = 'text-[#20B95A] bg-[#20B95A]/15'; // Top 30% - favorable
  } else if (percentile >= 40) {
    color = 'text-[#ff6b35] bg-[#ff6b35]/20'; // Middle 30% - neutral
  } else {
    color = 'text-[#c2410c] bg-[#c2410c]/15'; // Bottom 40% - tough
  }

  return (
    <span className={`type-badge whitespace-nowrap rounded px-2 py-0.5 ${color}`}>
      #{rank}
    </span>
  );
}

function StatDiff({ diff, stat }: { diff: number; stat: string }) {
  const isPositive = diff > 0;
  const isSignificant = Math.abs(diff) >= 1;
  
  if (!isSignificant) {
    return <span className="type-table-data text-[#4a6366]">—</span>;
  }

  return (
    <div className="flex items-center gap-1">
      {isPositive ? (
        <TrendingUp className="w-3 h-3 text-[#20B95A]" />
      ) : (
        <TrendingDown className="w-3 h-3 text-[#c2410c]" />
      )}
      <span className={`type-table-data whitespace-nowrap ${isPositive ? 'text-[#20B95A]' : 'text-[#c2410c]'}`}>
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
  const leftColor = isSwapped ? 'bg-[#c2410c]/40' : 'bg-[#20B95A]/40';
  const rightColor = isSwapped ? 'bg-[#20B95A]/40' : 'bg-[#c2410c]/40';
  
  // Determine advantage
  const hasOffenseAdvantage = offenseRank < defenseRank; // Offense rank is better (lower number)
  const hasDefenseAdvantage = defenseRank < offenseRank; // Defense rank is better (lower number)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="type-secondary">{label}</span>
      </div>
      
      {/* Single horizontal bar divided by ranking */}
      <div className="relative w-full">
        {/* Container bar */}
        <div className="relative flex h-5 w-full overflow-hidden rounded bg-[#F8FBFA]">
          {/* Left portion */}
          <div 
            className={`h-full ${leftColor} flex items-center justify-start pl-1.5`}
            style={{ width: `${leftPercentage}%` }}
          >
            <span className="type-table-data whitespace-nowrap text-[#063f46]">
              {leftValue.toFixed(1)}
            </span>
          </div>
          
          {/* Right portion */}
          <div 
            className={`h-full ${rightColor} flex items-center justify-end pr-1.5`}
            style={{ width: `${rightPercentage}%` }}
          >
            <span className="type-table-data whitespace-nowrap text-[#063f46]">
              {rightValue.toFixed(1)}
            </span>
          </div>
        </div>
        
        {/* Rankings below the bar */}
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1.5 flex-1 justify-center">
            <span className="type-metadata">{leftLabel}</span>
            <RankBadge rank={leftRank} />
          </div>
          <div className="flex items-center gap-1.5 flex-1 justify-center">
            <RankBadge rank={rightRank} />
            <span className="type-metadata">{rightLabel}</span>
          </div>
        </div>
      </div>
      
      {/* Advantage indicator */}
      {(hasOffenseAdvantage || hasDefenseAdvantage) && (
        <div className="flex items-center justify-center gap-1 pt-0.5">
          {hasOffenseAdvantage && (
            <span className="type-badge text-[#20B95A]">Offensive Advantage</span>
          )}
          {hasDefenseAdvantage && (
            <span className="type-badge text-[#c2410c]">Defensive Advantage</span>
          )}
        </div>
      )}
    </div>
  );
}

export function OffenseVsDefenseComparison({ 
  offenseTeam, 
  defenseTeam, 
  offenseAbbr, 
  defenseAbbr,
  isSwapped,
  embedded = false
}: { 
  offenseTeam: TeamOffensiveRankings | null;
  defenseTeam: OpponentDefensiveRankings | null;
  offenseAbbr: string;
  defenseAbbr: string;
  isSwapped?: boolean;
  /** When true, render inner content only (no card wrapper) for use inside a parent card */
  embedded?: boolean;
}) {
  if (!offenseTeam || !defenseTeam) {
    return embedded ? (
      <p className="type-secondary">No matchup data available</p>
    ) : (
      <div className="bg-white rounded-2xl border border-[#DCE9EA] shadow-sm p-4">
        <p className="type-secondary">No matchup data available</p>
      </div>
    );
  }

  // Calculate max values for normalization (not used for bar width, but kept for potential future use)
  const maxPoints = Math.max(offenseTeam.points_per_game, defenseTeam.points_allowed_per_game) * 1.1;
  const maxRebounds = Math.max(offenseTeam.rebounds_per_game, defenseTeam.rebounds_allowed_per_game) * 1.1;
  const maxAssists = Math.max(offenseTeam.assists_per_game, defenseTeam.assists_allowed_per_game) * 1.1;
  const maxThrees = Math.max(offenseTeam.threes_per_game, defenseTeam.threes_allowed_per_game) * 1.1;

  const content = (
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
        
        <div className="border-t border-[#DCE9EA] pt-3">
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
        
        <div className="border-t border-[#DCE9EA] pt-3">
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
        
        <div className="border-t border-[#DCE9EA] pt-3">
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
  );

  if (embedded) return content;
  return <div className="bg-white rounded-2xl border border-[#DCE9EA] shadow-sm p-4">{content}</div>;
}

export function PaceAnalysisCard({ paceAnalysis }: { paceAnalysis: PaceAnalysis | null }) {
  if (!paceAnalysis) {
    return (
      <div className="bg-white rounded-2xl border border-[#DCE9EA] shadow-sm p-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-[#075B5C]" />
          <h4 className="type-section-heading text-[#063f46]">Pace Context</h4>
        </div>
        <p className="type-secondary">Not enough season data</p>
      </div>
    );
  }
  const { home_team_pace, away_team_pace, projected_pace, pace_advantage, pace_impact } = paceAnalysis;
  
  const paceColor = pace_impact === 'fast' 
    ? 'text-[#20B95A]' 
    : pace_impact === 'slow' 
      ? 'text-[#c2410c]' 
      : 'text-[#ff6b35]';

  return (
    <div className="bg-white rounded-2xl border border-[#DCE9EA] shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-[#075B5C]" />
        <h4 className="type-section-heading text-[#063f46]">Pace Context</h4>
      </div>
      
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-2 rounded-lg bg-[#F8FBFA]">
            <div className="type-metadata mb-1">Home season pace</div>
            <div className="type-card-data text-[#063f46]">{home_team_pace.toFixed(1)}</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-[#F8FBFA]">
            <div className="type-metadata mb-1">Away season pace</div>
            <div className="type-card-data text-[#063f46]">{away_team_pace.toFixed(1)}</div>
          </div>
        </div>
        
        <div className="border-t border-[#DCE9EA] pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="type-metadata">Projected pace</span>
            <span className={`type-card-data ${paceColor}`}>{projected_pace.toFixed(1)}</span>
          </div>
          <p className="type-secondary mb-2">
            Average of the two season paces. Descriptive context only — not a projected total or winner.
          </p>
          <div className="flex items-center justify-between">
            <span className="type-metadata">Pace Impact</span>
            <span className={`type-badge whitespace-nowrap rounded px-2 py-0.5 ${
              pace_impact === 'fast' 
                ? 'bg-[#20B95A]/15 text-[#20B95A]' 
                : pace_impact === 'slow' 
                  ? 'bg-[#c2410c]/15 text-[#c2410c]' 
                  : 'bg-[#ff6b35]/20 text-[#ff6b35]'
            }`}>
              {pace_impact}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PlayerMatchupCard({ player, opponentAbbr }: { player: PlayerVsOpponentStats; opponentAbbr: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#DCE9EA] shadow-sm p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h5 className="type-card-data text-[#063f46]">{player.player_name}</h5>
          <p className="type-secondary">
            {player.games_played} games vs {opponentAbbr}
          </p>
        </div>
      </div>
      
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="type-metadata">Points</span>
          <div className="flex items-center gap-2">
            <span className="type-table-data whitespace-nowrap text-[#063f46]">
              {player.avg_points.toFixed(1)} (vs {player.season_avg_points.toFixed(1)} avg)
            </span>
            <StatDiff diff={player.points_diff} stat="points" />
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="type-metadata">Rebounds</span>
          <div className="flex items-center gap-2">
            <span className="type-table-data whitespace-nowrap text-[#063f46]">
              {player.avg_rebounds.toFixed(1)} (vs {player.season_avg_rebounds.toFixed(1)} avg)
            </span>
            <StatDiff diff={player.rebounds_diff} stat="rebounds" />
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="type-metadata">Assists</span>
          <div className="flex items-center gap-2">
            <span className="type-table-data whitespace-nowrap text-[#063f46]">
              {player.avg_assists.toFixed(1)} (vs {player.season_avg_assists.toFixed(1)} avg)
            </span>
            <StatDiff diff={player.assists_diff} stat="assists" />
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="type-metadata">3PM</span>
          <div className="flex items-center gap-2">
            <span className="type-table-data whitespace-nowrap text-[#063f46]">
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
          <h3 className="type-section-heading text-[#063f46]">Matchup Analysis</h3>
        </div>
      </div>

      {/* Pace Analysis */}
      <PaceAnalysisCard paceAnalysis={pace_analysis} />

      {/* Offense vs Defense Comparison */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-1 justify-center">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#20B95A]" />
              <span className="type-secondary text-[#063f46]">{leftLabel}</span>
            </div>
            <ArrowLeftRight 
              className="w-4 h-4 text-[#4a6366] cursor-pointer hover:text-[#063f46] transition-colors"
              onClick={() => setIsSwapped(!isSwapped)}
            />
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#c2410c]" />
              <span className="type-secondary text-[#063f46]">{rightLabel}</span>
            </div>
          </div>
          <button
            onClick={() => setIsSwapped(!isSwapped)}
            className="type-interactive rounded bg-[#F8FBFA] px-2 py-1 text-cc-secondary transition-colors hover:bg-white/20 hover:text-[#063f46]"
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
          <h4 className="type-section-heading mb-3 text-[#063f46]">Key Player Matchups</h4>
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
            <h4 className="type-section-heading text-[#063f46]">Projected Starting Lineups</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.starting_lineups.away ? (
              <StartingLineupCard 
                lineup={data.starting_lineups.away}
                teamAbbr={awayTeamAbbr}
              />
            ) : (
              <div className="bg-white rounded-2xl border border-[#DCE9EA] shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-[#F8FBFA] flex items-center justify-center">
                    <span className="type-metadata text-[#063f46]">{awayTeamAbbr}</span>
                  </div>
                  <h5 className="type-secondary text-[#063f46]">{awayTeamAbbr} Starting 5</h5>
                </div>
                <p className="type-secondary py-4 text-center">
                  Not enough current-season data
                </p>
              </div>
            )}
            {data.starting_lineups.home ? (
              <StartingLineupCard 
                lineup={data.starting_lineups.home}
                teamAbbr={homeTeamAbbr}
              />
            ) : (
              <div className="bg-white rounded-2xl border border-[#DCE9EA] shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-[#F8FBFA] flex items-center justify-center">
                    <span className="type-metadata text-[#063f46]">{homeTeamAbbr}</span>
                  </div>
                  <h5 className="type-secondary text-[#063f46]">{homeTeamAbbr} Starting 5</h5>
                </div>
                <p className="type-secondary py-4 text-center">
                  Not enough current-season data
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function StartingLineupCard({ lineup, teamAbbr, embedded = false }: { lineup: StartingLineup; teamAbbr: string; embedded?: boolean }) {
  const content = (
    <>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-[#F8FBFA] flex items-center justify-center">
          <span className="type-metadata text-[#063f46]">{teamAbbr}</span>
        </div>
        <h5 className="type-secondary text-[#063f46]">{teamAbbr} Starting 5</h5>
      </div>
      
      <div className="space-y-2">
        {lineup.players.map((player, index) => (
          <Link
            key={player.player_id}
            href={`/betting/players/${player.player_id}`}
            className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[#f7f9f7] transition-colors border-b border-[#DCE9EA] last:border-0"
          >
            <div className="flex items-center gap-2 flex-1">
              <div className="w-6 h-6 rounded bg-[#F8FBFA] flex items-center justify-center">
                <span className="type-metadata text-[#063f46]">{index + 1}</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="type-table-data text-[#063f46]">{player.full_name}</span>
                  <span className="type-badge whitespace-nowrap rounded bg-[#F8FBFA] px-1.5 py-0.5">
                    {player.position}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="type-metadata">
                    {player.games_started} starts
                  </span>
                  <span className="type-metadata">•</span>
                  <span className="type-metadata">
                    {player.avg_points.toFixed(1)} PPG
                  </span>
                  <span className="type-metadata">•</span>
                  <span className="type-metadata">
                    {player.avg_minutes.toFixed(1)} MPG
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
      
      {lineup.players.length === 0 && (
        <p className="type-secondary py-4 text-center">
          Not enough current-season data
        </p>
      )}
    </>
  );

  if (embedded) return <div className="min-w-0">{content}</div>;
  return <div className="bg-white rounded-2xl border border-[#DCE9EA] shadow-sm p-4">{content}</div>;
}

