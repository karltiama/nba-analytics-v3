'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Zap, Shield, TrendingUp, AlertTriangle, Target, Calendar } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Game } from './GameCard';
import { LineMovementChart } from './LineMovementChart';
import {
  OffenseVsDefenseComparison,
  PlayerMatchupCard,
  StartingLineupCard,
} from './MatchupAnalysis';

// --- Types (migrated from GameDetailsModal) ---
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

interface CurrentOdds {
  spread: number | null;
  spreadOddsHome: number | null;
  spreadOddsAway: number | null;
  moneylineHome: number | null;
  moneylineAway: number | null;
  overUnder: number | null;
  overOdds: number | null;
  underOdds: number | null;
  bookmaker: string | null;
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
  starting_lineups: { home: any; away: any };
}

export interface PlayerPropItem {
  playerId: string;
  playerName: string;
  propType: string;
  lineValue: number;
  overOdds: number | null;
  underOdds: number | null;
  vendor: string;
}

export interface GameDetailsData {
  game: Game;
  homeTeamStats: TeamStats;
  awayTeamStats: TeamStats;
  spreadMovement: { time: string; value: number }[];
  totalMovement: { time: string; value: number }[];
  currentOdds?: CurrentOdds | null;
  historicalMatchups: HistoricalMatchup[];
  injuries: { home: InjuryReport[]; away: InjuryReport[] };
  aiSuggestions: AIBetSuggestion[];
  aiConfidenceScores: { moneyline: number; spread: number; total: number };
  matchupAnalysis?: MatchupAnalysisData | null;
  playerProps?: PlayerPropItem[];
}

// --- Row / gauge helpers (migrated from modal) ---
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
    Out: 'text-[#ff4757] bg-[#ff4757]/20',
    Questionable: 'text-[#ff6b35] bg-[#ff6b35]/20',
    Probable: 'text-[#39ff14] bg-[#39ff14]/20',
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
          <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
          <circle
            cx="32" cy="32" r="28"
            fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
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

/** 2–4 high-signal summary bullets from existing data */
function getGameSummaryBullets(data: GameDetailsData): string[] {
  const bullets: string[] = [];
  const { matchupAnalysis, homeTeamStats, awayTeamStats, spreadMovement, injuries } = data;

  if (matchupAnalysis?.pace_analysis) {
    const { projected_pace, pace_impact } = matchupAnalysis.pace_analysis;
    bullets.push(`${pace_impact.charAt(0).toUpperCase() + pace_impact.slice(1)} pace (projected ${projected_pace?.toFixed(0) ?? '—'})`);
  } else if (homeTeamStats?.pace != null && awayTeamStats?.pace != null) {
    const avg = (homeTeamStats.pace + awayTeamStats.pace) / 2;
    bullets.push(`Avg pace ${avg.toFixed(0)}`);
  }

  if (matchupAnalysis?.home_offense && matchupAnalysis?.away_defense && matchupAnalysis?.away_offense && matchupAnalysis?.home_defense) {
    const homeO = matchupAnalysis.home_offense.offensive_rating ?? 0;
    const awayD = matchupAnalysis.away_defense.defensive_rating ?? 0;
    const awayO = matchupAnalysis.away_offense.offensive_rating ?? 0;
    const homeD = matchupAnalysis.home_defense.defensive_rating ?? 0;
    if (homeO > awayD && awayO <= homeD) bullets.push('Home offense vs Away defense: advantage Home');
    else if (awayO > homeD && homeO <= awayD) bullets.push('Away offense vs Home defense: advantage Away');
    else bullets.push('Offense vs defense: mixed');
  }

  if (spreadMovement?.length >= 2) {
    const open = spreadMovement[0].value;
    const now = spreadMovement[spreadMovement.length - 1].value;
    const move = now - open;
    if (Math.abs(move) >= 0.5) {
      bullets.push(`Line moved ${move > 0 ? 'toward Home' : 'toward Away'} (${move > 0 ? '+' : ''}${move.toFixed(1)})`);
    }
  }

  const totalInjuries = (injuries?.home?.length ?? 0) + (injuries?.away?.length ?? 0);
  if (totalInjuries === 0) bullets.push('No major injuries reported');
  else bullets.push(`Key injury context: ${totalInjuries} listed`);

  return bullets.slice(0, 4);
}

const KEY_PLAYERS_MAX = 4;

export function MatchupPageLayout({ data }: { data: GameDetailsData }) {
  const router = useRouter();
  const {
    game,
    homeTeamStats,
    awayTeamStats,
    spreadMovement,
    totalMovement,
    currentOdds,
    historicalMatchups,
    injuries,
    aiSuggestions,
    aiConfidenceScores,
    matchupAnalysis,
    playerProps = [],
  } = data;

  const summaryBullets = getGameSummaryBullets(data);
  const keyPlayers = (matchupAnalysis?.key_players ?? []).slice(0, KEY_PLAYERS_MAX);

  return (
    <main className="min-h-screen bg-background gradient-mesh max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-6">
      {/* Back link */}
      <div className="mb-6">
        <button
          type="button"
          onClick={() => router.push('/betting')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-[#00d4ff] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Betting
        </button>
      </div>

      <div className="space-y-6">
        {/* A. Game Header — compact, GameCard-like on small screens */}
        <section className="space-y-6">
          <div className="glass-card rounded-xl overflow-hidden border border-white/5">
            {/* Single compact bar: same feel as GameCard header — time · away @ home · records */}
            <div className="px-4 py-2 flex items-center justify-between gap-3 min-w-0 bg-white/[0.02]">
              <div className="flex items-center gap-2 min-w-0 shrink-0">
                <Calendar className="w-3.5 h-3.5 text-[#00d4ff] shrink-0" />
                <span className="text-xs font-medium text-muted-foreground truncate">{game.startTime}</span>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                <Link href={`/teams/${game.awayTeam.id}`} className="text-sm font-semibold text-white hover:text-[#00d4ff] transition-colors">{game.awayTeam.abbreviation}</Link>
                <span className="text-[10px] text-muted-foreground">@</span>
                <Link href={`/teams/${game.homeTeam.id}`} className="text-sm font-semibold text-white hover:text-[#00d4ff] transition-colors">{game.homeTeam.abbreviation}</Link>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
                <span>{game.awayTeam.record}</span>
                <span className="text-white/40">·</span>
                <span>{game.homeTeam.record}</span>
              </div>
            </div>
          </div>

          {/* Quick Betting + Insight badges */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="glass-card rounded-xl p-4 flex items-center">
              <div className="flex items-center justify-between gap-4 w-full">
                <div className="text-center flex-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Spread</p>
                  <p className="text-lg font-bold text-white">
                    {currentOdds?.spread != null ? `${game.homeTeam.abbreviation} ${currentOdds.spread > 0 ? '+' : ''}${currentOdds.spread}` : '—'}
                  </p>
                  {(currentOdds?.spreadOddsHome != null || currentOdds?.spreadOddsAway != null) && (
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                      {game.homeTeam.abbreviation} {currentOdds?.spreadOddsHome != null ? (currentOdds.spreadOddsHome > 0 ? `+${currentOdds.spreadOddsHome}` : currentOdds.spreadOddsHome) : '—'} / {game.awayTeam.abbreviation} {currentOdds?.spreadOddsAway != null ? (currentOdds.spreadOddsAway > 0 ? `+${currentOdds.spreadOddsAway}` : currentOdds.spreadOddsAway) : '—'}
                    </p>
                  )}
                </div>
                <div className="w-px h-10 bg-white/10 shrink-0" />
                <div className="text-center flex-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Moneyline</p>
                  <p className="text-sm font-bold text-white leading-tight">
                    {currentOdds?.moneylineAway != null && currentOdds?.moneylineHome != null ? (
                      <><span className="text-muted-foreground">{game.awayTeam.abbreviation}</span> {currentOdds.moneylineAway > 0 ? '+' : ''}{currentOdds.moneylineAway} <span className="text-white/50">/</span> <span className="text-muted-foreground">{game.homeTeam.abbreviation}</span> {currentOdds.moneylineHome > 0 ? '+' : ''}{currentOdds.moneylineHome}</>
                    ) : currentOdds?.moneylineHome != null ? (
                      <><span className="text-muted-foreground">{game.homeTeam.abbreviation}</span> {currentOdds.moneylineHome > 0 ? '+' : ''}{currentOdds.moneylineHome}</>
                    ) : currentOdds?.moneylineAway != null ? (
                      <><span className="text-muted-foreground">{game.awayTeam.abbreviation}</span> {currentOdds.moneylineAway > 0 ? '+' : ''}{currentOdds.moneylineAway}</>
                    ) : (
                      '—'
                    )}
                  </p>
                </div>
                <div className="w-px h-10 bg-white/10 shrink-0" />
                <div className="text-center flex-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Total</p>
                  <p className="text-lg font-bold text-white">{currentOdds?.overUnder ?? '—'}</p>
                  {(currentOdds?.overOdds != null || currentOdds?.underOdds != null) && (
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                      O {currentOdds?.overOdds != null ? (currentOdds.overOdds > 0 ? `+${currentOdds.overOdds}` : currentOdds.overOdds) : '—'} / U {currentOdds?.underOdds != null ? (currentOdds.underOdds > 0 ? `+${currentOdds.underOdds}` : currentOdds.underOdds) : '—'}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {summaryBullets.slice(0, 4).map((label, i) => {
                const isPace = /pace|fast|slow|avg/i.test(label);
                const isLine = /line|moved/i.test(label);
                const isInjury = /injur|listed/i.test(label);
                const Icon = isPace ? Zap : isLine ? TrendingUp : isInjury ? AlertTriangle : TrendingUp;
                return (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-white/10 text-muted-foreground border border-white/5"
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    {label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* AI Projection placeholder */}
          <div className="glass-card rounded-xl p-4 border border-dashed border-[#bf5af2]/40 bg-[#bf5af2]/5">
            <div className="flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-white font-medium">AI Projection Summary</p>
                <p className="text-xs text-muted-foreground mt-1">Coming Soon</p>
              </div>
            </div>
          </div>
        </section>

        {/* B. Line movement + Key player matchups — compact side-by-side */}
        <section>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Line movement — compact card with header strip like GameCard */}
            <div className="glass-card rounded-xl overflow-hidden border border-white/5">
              <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
                <h2 className="text-sm font-semibold text-white">Line movement</h2>
              </div>
              <div className="p-3">
                <Tabs defaultValue="spread" className="w-full">
                <TabsList className="w-full grid grid-cols-2 mb-2 bg-white/10 p-1 rounded-lg h-8">
                  <TabsTrigger value="spread" className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-muted-foreground rounded text-xs">
                    Spread ({game.homeTeam.abbreviation})
                  </TabsTrigger>
                  <TabsTrigger value="total" className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-muted-foreground rounded text-xs">
                    Total (O/U)
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="spread" className="mt-0 outline-none">
                  <LineMovementChart data={spreadMovement} label={`Spread: ${game.homeTeam.abbreviation}`} color="#00d4ff" height={200} width={520} embedded />
                </TabsContent>
                <TabsContent value="total" className="mt-0 outline-none">
                  <LineMovementChart data={totalMovement} label="Total (O/U)" color="#39ff14" height={200} width={520} embedded />
                </TabsContent>
              </Tabs>
              </div>
            </div>

            {/* Key player matchups — same card style as Line movement */}
            <div className="glass-card rounded-xl overflow-hidden border border-white/5">
              <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
                <h2 className="text-sm font-semibold text-white">Key player matchups</h2>
              </div>
              <div className="p-3">
                {keyPlayers.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {keyPlayers.map((player) => (
                      <PlayerMatchupCard
                        key={player.player_id}
                        player={player}
                        opponentAbbr={String(player.team_id) === String(game.homeTeam.id) ? game.awayTeam.abbreviation : game.homeTeam.abbreviation}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No matchup data for this game yet.</p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* C. Team comparison — no outer card, grid of team cards + pace + O vs D */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">Team comparison</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <span className="text-xs font-bold">{game.awayTeam.abbreviation}</span>
                </div>
                <Link href={`/teams/${game.awayTeam.id}`} className="text-sm font-semibold text-white hover:text-[#00d4ff]">{game.awayTeam.name}</Link>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="flex items-center justify-center gap-1 mb-1"><Zap className="w-3 h-3 text-[#00d4ff]" /><span className="text-[10px] text-muted-foreground">ORTG</span></div>
                  <span className="text-sm font-bold text-[#00d4ff]">{awayTeamStats.offensiveRating.toFixed(1)}</span>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="flex items-center justify-center gap-1 mb-1"><Shield className="w-3 h-3 text-[#39ff14]" /><span className="text-[10px] text-muted-foreground">DRTG</span></div>
                  <span className="text-sm font-bold text-[#39ff14]">{awayTeamStats.defensiveRating.toFixed(1)}</span>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="flex items-center justify-center gap-1 mb-1"><TrendingUp className="w-3 h-3 text-[#ff6b35]" /><span className="text-[10px] text-muted-foreground">PACE</span></div>
                  <span className="text-sm font-bold text-[#ff6b35]">{awayTeamStats.pace.toFixed(1)}</span>
                </div>
              </div>
              <div className="border-t border-white/5 pt-2">
                <h4 className="text-[10px] font-medium text-muted-foreground mb-1">L5</h4>
                {awayTeamStats.recentForm.slice(0, 3).map((g, i) => (
                  <RecentFormRow key={i} game={g} teamAbbr={game.awayTeam.abbreviation} />
                ))}
                {awayTeamStats.recentForm.length === 0 && <p className="text-[10px] text-muted-foreground">—</p>}
              </div>
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <span className="text-xs font-bold">{game.homeTeam.abbreviation}</span>
                </div>
                <Link href={`/teams/${game.homeTeam.id}`} className="text-sm font-semibold text-white hover:text-[#00d4ff]">{game.homeTeam.name}</Link>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="flex items-center justify-center gap-1 mb-1"><Zap className="w-3 h-3 text-[#00d4ff]" /><span className="text-[10px] text-muted-foreground">ORTG</span></div>
                  <span className="text-sm font-bold text-[#00d4ff]">{homeTeamStats.offensiveRating.toFixed(1)}</span>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="flex items-center justify-center gap-1 mb-1"><Shield className="w-3 h-3 text-[#39ff14]" /><span className="text-[10px] text-muted-foreground">DRTG</span></div>
                  <span className="text-sm font-bold text-[#39ff14]">{homeTeamStats.defensiveRating.toFixed(1)}</span>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="flex items-center justify-center gap-1 mb-1"><TrendingUp className="w-3 h-3 text-[#ff6b35]" /><span className="text-[10px] text-muted-foreground">PACE</span></div>
                  <span className="text-sm font-bold text-[#ff6b35]">{homeTeamStats.pace.toFixed(1)}</span>
                </div>
              </div>
              <div className="border-t border-white/5 pt-2">
                <h4 className="text-[10px] font-medium text-muted-foreground mb-1">L5</h4>
                {homeTeamStats.recentForm.slice(0, 3).map((g, i) => (
                  <RecentFormRow key={i} game={g} teamAbbr={game.homeTeam.abbreviation} />
                ))}
                {homeTeamStats.recentForm.length === 0 && <p className="text-[10px] text-muted-foreground">—</p>}
              </div>
            </div>
          </div>
          {matchupAnalysis && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <OffenseVsDefenseComparison
                  offenseTeam={matchupAnalysis.away_offense}
                  defenseTeam={matchupAnalysis.home_defense}
                  offenseAbbr={game.awayTeam.abbreviation}
                  defenseAbbr={game.homeTeam.abbreviation}
                  isSwapped={false}
                />
                <OffenseVsDefenseComparison
                  offenseTeam={matchupAnalysis.home_offense}
                  defenseTeam={matchupAnalysis.away_defense}
                  offenseAbbr={game.homeTeam.abbreviation}
                  defenseAbbr={game.awayTeam.abbreviation}
                  isSwapped={false}
                />
              </div>
            </div>
          )}
        </section>

        {/* D. Projected starters — two cards */}
        {matchupAnalysis?.starting_lineups && (matchupAnalysis.starting_lineups.home || matchupAnalysis.starting_lineups.away) && (
          <section>
            <h2 className="text-lg font-semibold text-white mb-4">Projected starters</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {matchupAnalysis.starting_lineups.away && (
                <StartingLineupCard lineup={matchupAnalysis.starting_lineups.away} teamAbbr={game.awayTeam.abbreviation} />
              )}
              {matchupAnalysis.starting_lineups.home && (
                <StartingLineupCard lineup={matchupAnalysis.starting_lineups.home} teamAbbr={game.homeTeam.abbreviation} />
              )}
            </div>
          </section>
        )}

        {/* F. Injuries — one card with two columns */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">Injuries</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-[#ff6b35]" />
                <Link href={`/teams/${game.awayTeam.id}`} className="text-sm font-semibold text-white hover:text-[#00d4ff]">{game.awayTeam.name}</Link>
              </div>
              {injuries.away.length > 0 ? injuries.away.map((injury, i) => <InjuryRow key={i} injury={injury} />) : <p className="text-xs text-muted-foreground">No injuries reported</p>}
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-[#ff6b35]" />
                <Link href={`/teams/${game.homeTeam.id}`} className="text-sm font-semibold text-white hover:text-[#00d4ff]">{game.homeTeam.name}</Link>
              </div>
              {injuries.home.length > 0 ? injuries.home.map((injury, i) => <InjuryRow key={i} injury={injury} />) : <p className="text-xs text-muted-foreground">No injuries reported</p>}
            </div>
          </div>
        </section>

        {/* G. Historical matchups — no outer card, table in card */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">Historical matchups</h2>
          <div className="glass-card rounded-xl p-4 overflow-x-auto">
            <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-[10px] text-muted-foreground py-1.5">Date</th>
                    <th className="text-left text-[10px] text-muted-foreground py-1.5">Matchup</th>
                    <th className="text-center text-[10px] text-muted-foreground py-1.5">Score</th>
                    <th className="text-center text-[10px] text-muted-foreground py-1.5">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {historicalMatchups.map((matchup, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="py-1.5 text-[10px] text-muted-foreground">{matchup.date}</td>
                      <td className="py-1.5 text-[10px] text-white">{matchup.awayTeam} @ {matchup.homeTeam}</td>
                      <td className="py-1.5 text-[10px] text-white text-center font-mono">{matchup.awayScore} – {matchup.homeScore}</td>
                      <td className="py-1.5 text-[10px] text-center"><span className="px-2 py-0.5 rounded bg-white/5 text-[#00d4ff] font-mono">{matchup.totalPoints}</span></td>
                    </tr>
                  ))}
                    </tbody>
            </table>
          </div>
        </section>

        {/* Player props */}
        {playerProps.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-white mb-4">Player props</h2>
            <div className="glass-card rounded-xl p-4 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-[10px] text-muted-foreground py-1.5">Player</th>
                    <th className="text-left text-[10px] text-muted-foreground py-1.5">Prop</th>
                    <th className="text-center text-[10px] text-muted-foreground py-1.5">Line</th>
                    <th className="text-center text-[10px] text-muted-foreground py-1.5">Over</th>
                    <th className="text-center text-[10px] text-muted-foreground py-1.5">Under</th>
                  </tr>
                </thead>
                <tbody>
                  {playerProps.map((prop, i) => (
                    <tr key={`${prop.playerId}-${prop.propType}-${prop.lineValue}-${i}`} className="border-b border-white/5 last:border-0">
                      <td className="py-1.5 text-xs text-white">
                        <Link href={`/players/${prop.playerId}`} className="hover:text-[#00d4ff] transition-colors">
                          {prop.playerName}
                        </Link>
                      </td>
                      <td className="py-1.5 text-[10px] text-muted-foreground capitalize">{prop.propType.replace(/_/g, ' ')}</td>
                      <td className="py-1.5 text-xs font-mono text-white text-center">{prop.lineValue}</td>
                      <td className="py-1.5 text-[10px] font-mono text-center text-muted-foreground">
                        {prop.overOdds != null ? (prop.overOdds > 0 ? `+${prop.overOdds}` : prop.overOdds) : '—'}
                      </td>
                      <td className="py-1.5 text-[10px] font-mono text-center text-muted-foreground">
                        {prop.underOdds != null ? (prop.underOdds > 0 ? `+${prop.underOdds}` : prop.underOdds) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-muted-foreground mt-2">Odds from {playerProps[0]?.vendor ?? 'book'} · American format</p>
            </div>
          </section>
        )}

        {/* AI Suggested Bets */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">AI Suggested Bets</h2>
          <div className="glass-card rounded-xl p-4 border border-[#bf5af2]/30">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg bg-[#bf5af2]/20"><Zap className="w-4 h-4 text-[#bf5af2]" /></div>
              <span className="text-sm font-semibold text-white">AI Suggested Bets</span>
              <span className="text-[10px] px-2 py-0.5 bg-[#bf5af2]/20 text-[#bf5af2] rounded-full">Beta</span>
            </div>
            {aiSuggestions.length > 0 ? (
              <div className="space-y-2">
                {aiSuggestions.map((s, i) => (
                  <div key={i} className="p-2 rounded-lg bg-white/5 border border-white/5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] px-2 py-0.5 bg-white/10 rounded font-medium">{s.type}</span>
                      <span className="text-xs font-semibold text-white">{s.pick}</span>
                      <span className="text-[10px] font-bold text-[#39ff14]">{s.confidence}%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{s.explanation}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">AI suggestions (coming soon)</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
