'use client';

import Link from 'next/link';
import { X, TrendingUp, TrendingDown, Shield, Zap, AlertTriangle, Target, Users } from 'lucide-react';
import { LineMovementChart } from './LineMovementChart';
import { MatchupAnalysis } from './MatchupAnalysis';
import type { Game } from './GameCard';

interface RecentGameResult {
  opponent: string;
  result: 'W' | 'L';
  score: string;
  spread: number;
  covered: boolean;
}

interface TeamStats {
  offensiveRating: number;
  defensiveRating: number;
  pace: number;
  recentForm: RecentGameResult[];
}

interface HistoricalMatchup {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  totalPoints: number;
}

interface InjuryReport {
  player: string;
  status: 'Out' | 'Questionable' | 'Probable';
  injury: string;
}

interface AIBetSuggestion {
  type: 'ML' | 'Spread' | 'O/U';
  pick: string;
  confidence: number;
  explanation: string;
}

interface MatchupAnalysisData {
  game_id: string;
  home_team_id: string;
  away_team_id: string;
  home_offense: any;
  away_offense: any;
  home_defense: any;
  away_defense: any;
  pace_analysis: any;
  key_players: any[];
  starting_lineups: {
    home: any;
    away: any;
  };
}

interface GameDetailsData {
  game: Game;
  homeTeamStats: TeamStats;
  awayTeamStats: TeamStats;
  spreadMovement: { time: string; value: number }[];
  totalMovement: { time: string; value: number }[];
  historicalMatchups: HistoricalMatchup[];
  injuries: { home: InjuryReport[]; away: InjuryReport[] };
  aiSuggestions: AIBetSuggestion[];
  aiConfidenceScores: {
    moneyline: number;
    spread: number;
    total: number;
  };
  matchupAnalysis?: MatchupAnalysisData;
}

interface GameDetailsModalProps {
  data: GameDetailsData;
  onClose: () => void;
}

function RecentFormRow({ game, teamAbbr }: { game: RecentGameResult; teamAbbr: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${
          game.result === 'W' ? 'bg-[#39ff14]/20 text-[#39ff14]' : 'bg-[#ff4757]/20 text-[#ff4757]'
        }`}>
          {game.result}
        </span>
        <span className="text-xs text-muted-foreground">vs {game.opponent}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-white font-mono">{game.score}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          game.covered ? 'bg-[#39ff14]/20 text-[#39ff14]' : 'bg-[#ff4757]/20 text-[#ff4757]'
        }`}>
          {game.spread > 0 ? '+' : ''}{game.spread} {game.covered ? '✓' : '✗'}
        </span>
      </div>
    </div>
  );
}

function InjuryRow({ injury }: { injury: InjuryReport }) {
  const statusColors = {
    'Out': 'text-[#ff4757] bg-[#ff4757]/20',
    'Questionable': 'text-[#ff6b35] bg-[#ff6b35]/20',
    'Probable': 'text-[#39ff14] bg-[#39ff14]/20'
  };

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-white">{injury.player}</span>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">{injury.injury}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColors[injury.status]}`}>
          {injury.status}
        </span>
      </div>
    </div>
  );
}

function AIConfidenceGauge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className="relative w-16 h-16 mx-auto mb-2">
        <svg className="w-full h-full -rotate-90">
          <circle
            cx="32"
            cy="32"
            r="28"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="4"
          />
          <circle
            cx="32"
            cy="32"
            r="28"
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${value * 1.76} 176`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold" style={{ color }}>{value}%</span>
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

export function GameDetailsModal({ data, onClose }: GameDetailsModalProps) {
  const { game, homeTeamStats, awayTeamStats, spreadMovement, totalMovement, historicalMatchups, injuries, aiSuggestions, aiConfidenceScores, matchupAnalysis } = data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto glass-card rounded-2xl fade-in">
        {/* Header */}
        <div className="sticky top-0 z-10 glass-card px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                <span className="text-sm font-bold">{game.awayTeam.abbreviation}</span>
              </div>
              <span className="text-lg font-bold text-white">@</span>
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                <span className="text-sm font-bold">{game.homeTeam.abbreviation}</span>
              </div>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                <Link 
                  href={`/teams/${game.awayTeam.id}`}
                  className="hover:text-[#00d4ff] transition-colors"
                >
                  {game.awayTeam.name}
                </Link>
                {' @ '}
                <Link 
                  href={`/teams/${game.homeTeam.id}`}
                  className="hover:text-[#00d4ff] transition-colors"
                >
                  {game.homeTeam.name}
                </Link>
              </h2>
              <p className="text-xs text-muted-foreground">{game.startTime}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* AI Confidence Scores */}
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-4">
              <Target className="w-4 h-4 text-[#bf5af2]" />
              <h3 className="text-sm font-semibold text-white">AI Confidence Scores</h3>
            </div>
            <div className="flex items-center justify-around">
              <AIConfidenceGauge label="Moneyline" value={aiConfidenceScores.moneyline} color="#00d4ff" />
              <AIConfidenceGauge label="Spread" value={aiConfidenceScores.spread} color="#39ff14" />
              <AIConfidenceGauge label="Over/Under" value={aiConfidenceScores.total} color="#ff6b35" />
            </div>
          </div>

          {/* Team Stats Comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Away Team Stats */}
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <span className="text-xs font-bold">{game.awayTeam.abbreviation}</span>
                </div>
                <Link 
                  href={`/teams/${game.awayTeam.id}`}
                  className="text-sm font-semibold text-white hover:text-[#00d4ff] transition-colors cursor-pointer"
                >
                  {game.awayTeam.name}
                </Link>
              </div>
              
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Zap className="w-3 h-3 text-[#00d4ff]" />
                    <span className="text-[10px] text-muted-foreground">ORTG</span>
                  </div>
                  <span className="text-lg font-bold text-[#00d4ff]">{awayTeamStats.offensiveRating.toFixed(1)}</span>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Shield className="w-3 h-3 text-[#39ff14]" />
                    <span className="text-[10px] text-muted-foreground">DRTG</span>
                  </div>
                  <span className="text-lg font-bold text-[#39ff14]">{awayTeamStats.defensiveRating.toFixed(1)}</span>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <TrendingUp className="w-3 h-3 text-[#ff6b35]" />
                    <span className="text-[10px] text-muted-foreground">PACE</span>
                  </div>
                  <span className="text-lg font-bold text-[#ff6b35]">{awayTeamStats.pace.toFixed(1)}</span>
                </div>
              </div>

              <div className="border-t border-white/5 pt-3">
                <h4 className="text-xs font-medium text-muted-foreground mb-2">Recent Form (L5)</h4>
                {awayTeamStats.recentForm.map((g, i) => (
                  <RecentFormRow key={i} game={g} teamAbbr={game.awayTeam.abbreviation} />
                ))}
              </div>
            </div>

            {/* Home Team Stats */}
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <span className="text-xs font-bold">{game.homeTeam.abbreviation}</span>
                </div>
                <Link 
                  href={`/teams/${game.homeTeam.id}`}
                  className="text-sm font-semibold text-white hover:text-[#00d4ff] transition-colors cursor-pointer"
                >
                  {game.homeTeam.name}
                </Link>
              </div>
              
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Zap className="w-3 h-3 text-[#00d4ff]" />
                    <span className="text-[10px] text-muted-foreground">ORTG</span>
                  </div>
                  <span className="text-lg font-bold text-[#00d4ff]">{homeTeamStats.offensiveRating.toFixed(1)}</span>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Shield className="w-3 h-3 text-[#39ff14]" />
                    <span className="text-[10px] text-muted-foreground">DRTG</span>
                  </div>
                  <span className="text-lg font-bold text-[#39ff14]">{homeTeamStats.defensiveRating.toFixed(1)}</span>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <TrendingUp className="w-3 h-3 text-[#ff6b35]" />
                    <span className="text-[10px] text-muted-foreground">PACE</span>
                  </div>
                  <span className="text-lg font-bold text-[#ff6b35]">{homeTeamStats.pace.toFixed(1)}</span>
                </div>
              </div>

              <div className="border-t border-white/5 pt-3">
                <h4 className="text-xs font-medium text-muted-foreground mb-2">Recent Form (L5)</h4>
                {homeTeamStats.recentForm.map((g, i) => (
                  <RecentFormRow key={i} game={g} teamAbbr={game.homeTeam.abbreviation} />
                ))}
              </div>
            </div>
          </div>

          {/* Matchup Analysis */}
          {matchupAnalysis && (
            <div className="glass-card rounded-xl p-4">
              <MatchupAnalysis 
                data={matchupAnalysis}
                homeTeamAbbr={game.homeTeam.abbreviation}
                awayTeamAbbr={game.awayTeam.abbreviation}
              />
            </div>
          )}

          {/* Line Movement Charts */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Line Movement</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <LineMovementChart 
                data={spreadMovement} 
                label={`Spread: ${game.homeTeam.abbreviation}`}
                color="#00d4ff"
              />
              <LineMovementChart 
                data={totalMovement} 
                label="Total (Over/Under)"
                color="#39ff14"
              />
            </div>
          </div>

          {/* Injuries */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-[#ff6b35]" />
                <Link 
                  href={`/teams/${game.awayTeam.id}`}
                  className="text-sm font-semibold text-white hover:text-[#00d4ff] transition-colors cursor-pointer"
                >
                  {game.awayTeam.name} Injuries
                </Link>
              </div>
              {injuries.away.length > 0 ? (
                injuries.away.map((injury, i) => <InjuryRow key={i} injury={injury} />)
              ) : (
                <p className="text-xs text-muted-foreground">No injuries reported</p>
              )}
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-[#ff6b35]" />
                <Link 
                  href={`/teams/${game.homeTeam.id}`}
                  className="text-sm font-semibold text-white hover:text-[#00d4ff] transition-colors cursor-pointer"
                >
                  {game.homeTeam.name} Injuries
                </Link>
              </div>
              {injuries.home.length > 0 ? (
                injuries.home.map((injury, i) => <InjuryRow key={i} injury={injury} />)
              ) : (
                <p className="text-xs text-muted-foreground">No injuries reported</p>
              )}
            </div>
          </div>

          {/* Historical Matchups */}
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-[#bf5af2]" />
              <h3 className="text-sm font-semibold text-white">Historical Matchups</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-[10px] text-muted-foreground py-2">Date</th>
                    <th className="text-left text-[10px] text-muted-foreground py-2">Matchup</th>
                    <th className="text-center text-[10px] text-muted-foreground py-2">Score</th>
                    <th className="text-center text-[10px] text-muted-foreground py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {historicalMatchups.map((matchup, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="py-2 text-xs text-muted-foreground">{matchup.date}</td>
                      <td className="py-2 text-xs text-white">{matchup.awayTeam} @ {matchup.homeTeam}</td>
                      <td className="py-2 text-xs text-white text-center font-mono">
                        {matchup.awayScore} - {matchup.homeScore}
                      </td>
                      <td className="py-2 text-xs text-center">
                        <span className="px-2 py-0.5 rounded bg-white/5 text-[#00d4ff] font-mono">
                          {matchup.totalPoints}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* AI Suggested Bets */}
          <div className="glass-card rounded-xl p-4 border border-[#bf5af2]/30">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-1.5 rounded-lg bg-[#bf5af2]/20">
                <Zap className="w-4 h-4 text-[#bf5af2]" />
              </div>
              <h3 className="text-sm font-semibold text-white">AI Suggested Bets</h3>
              <span className="text-[10px] px-2 py-0.5 bg-[#bf5af2]/20 text-[#bf5af2] rounded-full">Beta</span>
            </div>
            <div className="space-y-3">
              {aiSuggestions.map((suggestion, i) => (
                <div key={i} className="p-3 rounded-lg bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 bg-white/10 rounded font-medium">
                        {suggestion.type}
                      </span>
                      <span className="text-sm font-semibold text-white">{suggestion.pick}</span>
                    </div>
                    <div className={`text-xs font-bold px-2 py-0.5 rounded ${
                      suggestion.confidence >= 70 
                        ? 'bg-[#39ff14]/20 text-[#39ff14]' 
                        : suggestion.confidence >= 50 
                          ? 'bg-[#ff6b35]/20 text-[#ff6b35]'
                          : 'bg-white/10 text-muted-foreground'
                    }`}>
                      {suggestion.confidence}% confidence
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{suggestion.explanation}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground text-center">
              * AI suggestions are for informational purposes only. Not betting advice.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}








