'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { ArrowLeft, Zap, Shield, TrendingUp, AlertTriangle, Target, Calendar, CalendarDays } from 'lucide-react';
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
  /** YYYY-MM-DD for B2B detection */
  game_date?: string | null;
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
  status: 'Out' | 'Questionable' | 'Probable' | 'Doubtful' | 'GTD';
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

/** True if team's most recent game was the day before this game (back-to-back). */
function isBackToBack(gameDate: string | undefined, recentForm: RecentGameResult[]): boolean {
  if (!gameDate || !recentForm.length) return false;
  const lastGameDate = recentForm[0]?.game_date;
  if (!lastGameDate) return false;
  const game = new Date(gameDate);
  const last = new Date(lastGameDate);
  const diffDays = Math.round((game.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays === 1;
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
  const statusColors: Record<InjuryReport['status'], string> = {
    Out: 'text-[#ff4757] bg-[#ff4757]/20',
    Questionable: 'text-[#ff6b35] bg-[#ff6b35]/20',
    Probable: 'text-[#39ff14] bg-[#39ff14]/20',
    Doubtful: 'text-[#ff9500] bg-[#ff9500]/20',
    GTD: 'text-[#ffcc00] bg-[#ffcc00]/20',
  };
  const statusClass = statusColors[injury.status] ?? statusColors.Out;
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-white truncate min-w-0">{injury.player}</span>
      <div className="flex items-center gap-2 shrink-0">
        {injury.injury ? (
          <span className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={injury.injury}>
            {injury.injury}
          </span>
        ) : null}
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${statusClass}`}>
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

const SECTION_IDS = ['section-ai-projection', 'section-odds', 'section-matchup', 'section-players', 'section-injuries'] as const;
const SECTION_LABELS: Record<(typeof SECTION_IDS)[number], string> = {
  'section-ai-projection': 'AI Projection',
  'section-odds': 'Odds',
  'section-matchup': 'Matchup',
  'section-players': 'Players',
  'section-injuries': 'Injuries',
};

export function MatchupPageLayout({ data }: { data: GameDetailsData }) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<(typeof SECTION_IDS)[number]>(SECTION_IDS[0]);
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

  const scrollToSection = (sectionId: (typeof SECTION_IDS)[number]) => {
    const el = document.getElementById(sectionId);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY;
    const stickyOffset = 160; // leave room for sticky header so section headers aren't covered
    window.scrollTo({ top: y - stickyOffset, behavior: 'smooth' });
    setActiveSection(sectionId);
  };

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    SECTION_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) setActiveSection(id);
          });
        },
        { rootMargin: '-20% 0px -60% 0px', threshold: 0 }
      );
      observer.observe(el);
      observers.push(observer);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  return (
    <main className="min-h-screen bg-background gradient-mesh max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-6">
      <div className="space-y-6">
        {/* Matchup header — back icon + centered title + section nav; sticky when scrolling */}
        <div className="sticky top-0 z-10 glass-card rounded-xl overflow-hidden border border-white/5 bg-background/95 backdrop-blur-sm">
          <div className="px-4 py-5 flex items-center justify-center gap-x-6 gap-y-3 min-w-0 bg-white/[0.02] relative">
            <button
              type="button"
              onClick={() => router.push('/betting')}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-lg text-muted-foreground hover:text-[#00d4ff] hover:bg-white/10 transition-colors"
              aria-label="Back to Betting"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 min-w-0 shrink-0">
              <Calendar className="w-5 h-5 text-[#00d4ff] shrink-0" />
              <span className="text-base font-medium text-muted-foreground truncate">{game.startTime}</span>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <Link href={`/teams/${game.awayTeam.id}`} className="text-center hover:opacity-90 transition-opacity">
                <span className="block text-lg font-semibold text-white hover:text-[#00d4ff] transition-colors">{game.awayTeam.abbreviation}</span>
                <span className="block text-sm text-muted-foreground mt-0.5">{game.awayTeam.record}</span>
              </Link>
              <span className="text-sm text-muted-foreground">@</span>
              <Link href={`/teams/${game.homeTeam.id}`} className="text-center hover:opacity-90 transition-opacity">
                <span className="block text-lg font-semibold text-white hover:text-[#00d4ff] transition-colors">{game.homeTeam.abbreviation}</span>
                <span className="block text-sm text-muted-foreground mt-0.5">{game.homeTeam.record}</span>
              </Link>
            </div>
          </div>
          <div className="px-5 py-2 border-t border-white/5 flex flex-wrap items-center justify-center gap-2 bg-white/[0.02]">
            {SECTION_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => scrollToSection(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeSection === id
                    ? 'bg-[#00d4ff]/20 text-[#00d4ff] border border-[#00d4ff]/40'
                    : 'bg-white/5 text-muted-foreground border border-white/5 hover:bg-white/10 hover:text-white'
                }`}
              >
                {SECTION_LABELS[id]}
              </button>
            ))}
          </div>
        </div>

        <section id="section-ai-projection" className="scroll-mt-[10rem]">
          <div className="glass-card rounded-xl overflow-hidden border border-[#bf5af2]/30">
            <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02] flex items-center gap-1.5">
              <div className="flex items-center justify-center p-1 rounded-md bg-[#bf5af2]/20 shrink-0"><Zap className="w-3 h-3 text-[#bf5af2]" /></div>
              <span className="text-sm font-semibold text-white">AI Projection Summary</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-[#bf5af2]/20 text-[#bf5af2] rounded-full">Beta</span>
            </div>
            <div className="p-3">
            <div className="flex flex-wrap items-center gap-2 mb-3">
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
            <p className="text-xs text-muted-foreground">Coming soon</p>
            </div>
          </div>
        </section>

        <section id="section-odds" className="space-y-4 scroll-mt-[10rem]">
          <div className="glass-card rounded-xl overflow-hidden border border-white/5">
            <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
              <h2 className="text-sm font-semibold text-white">Odds</h2>
            </div>
            <div className="p-3 flex items-center">
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
          </div>
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
        </section>

        <section id="section-matchup" className="space-y-6 scroll-mt-[10rem]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Column 1: Projected starters */}
            <div className="glass-card rounded-xl overflow-hidden border border-white/5 min-w-0">
              <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
                <h2 className="text-sm font-semibold text-white">Projected starters</h2>
              </div>
              <div className="p-3">
              {matchupAnalysis?.starting_lineups && (matchupAnalysis.starting_lineups.home || matchupAnalysis.starting_lineups.away) ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {matchupAnalysis.starting_lineups.away && (
                    <StartingLineupCard lineup={matchupAnalysis.starting_lineups.away} teamAbbr={game.awayTeam.abbreviation} embedded />
                  )}
                  {matchupAnalysis.starting_lineups.home && (
                    <StartingLineupCard lineup={matchupAnalysis.starting_lineups.home} teamAbbr={game.homeTeam.abbreviation} embedded />
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-4 text-center">No data yet</p>
              )}
              </div>
            </div>
            {/* Column 2: Team stats + O vs D */}
            <div className="glass-card rounded-xl overflow-hidden border border-white/5 min-w-0">
            <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
              <h2 className="text-sm font-semibold text-white">Team comparison</h2>
            </div>
            <div className="p-3">
            {(() => {
              const awayB2B = isBackToBack(game.gameDate, awayTeamStats.recentForm);
              const homeB2B = isBackToBack(game.gameDate, homeTeamStats.recentForm);
              return (
                <>
                  <Tabs defaultValue="away" className="w-full">
                    <TabsList className="w-full grid grid-cols-2 mb-4 bg-white/10 p-1 rounded-lg h-10">
                      <TabsTrigger value="away" className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-muted-foreground rounded-md text-sm font-medium flex items-center justify-center gap-2">
                        <span>{game.awayTeam.abbreviation}</span>
                        {awayB2B && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#ff6b35]/20 text-[#ff6b35]" title="Back-to-back (played yesterday)">
                            <CalendarDays className="w-3 h-3" />
                            B2B
                          </span>
                        )}
                      </TabsTrigger>
                      <TabsTrigger value="home" className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-muted-foreground rounded-md text-sm font-medium flex items-center justify-center gap-2">
                        <span>{game.homeTeam.abbreviation}</span>
                        {homeB2B && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#ff6b35]/20 text-[#ff6b35]" title="Back-to-back (played yesterday)">
                            <CalendarDays className="w-3 h-3" />
                            B2B
                          </span>
                        )}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="away" className="mt-0 outline-none">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                          <span className="text-xs font-bold">{game.awayTeam.abbreviation}</span>
                        </div>
                        <Link href={`/teams/${game.awayTeam.id}`} className="text-sm font-semibold text-white hover:text-[#00d4ff]">{game.awayTeam.name}</Link>
                        {awayB2B && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-[#ff6b35]/20 text-[#ff6b35]" title="Back-to-back (played yesterday)">
                            <CalendarDays className="w-3 h-3" />
                            Back-to-back
                          </span>
                        )}
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
                    </TabsContent>
                    <TabsContent value="home" className="mt-0 outline-none">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                          <span className="text-xs font-bold">{game.homeTeam.abbreviation}</span>
                        </div>
                        <Link href={`/teams/${game.homeTeam.id}`} className="text-sm font-semibold text-white hover:text-[#00d4ff]">{game.homeTeam.name}</Link>
                        {homeB2B && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-[#ff6b35]/20 text-[#ff6b35]" title="Back-to-back (played yesterday)">
                            <CalendarDays className="w-3 h-3" />
                            Back-to-back
                          </span>
                        )}
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
                    </TabsContent>
                  </Tabs>
                  {matchupAnalysis && (
                    <>
                      <div className="border-t border-white/10 my-4" aria-hidden />
                      <div className="space-y-4">
                        <OffenseVsDefenseComparison
                          offenseTeam={matchupAnalysis.away_offense}
                          defenseTeam={matchupAnalysis.home_defense}
                          offenseAbbr={game.awayTeam.abbreviation}
                          defenseAbbr={game.homeTeam.abbreviation}
                          isSwapped={false}
                          embedded
                        />
                        <OffenseVsDefenseComparison
                          offenseTeam={matchupAnalysis.home_offense}
                          defenseTeam={matchupAnalysis.away_defense}
                          offenseAbbr={game.homeTeam.abbreviation}
                          defenseAbbr={game.awayTeam.abbreviation}
                          isSwapped={false}
                          embedded
                        />
                      </div>
                    </>
                  )}
                </>
              );
            })()}
            </div>
            </div>
          </div>
          <h2 className="text-lg font-semibold text-white mb-4">Historical matchups</h2>
          <div className="glass-card rounded-xl overflow-hidden border border-white/5">
            <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
              <h2 className="text-sm font-semibold text-white">Historical matchups</h2>
            </div>
            <div className="p-3 overflow-x-auto">
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
          </div>
        </section>

        <section id="section-players" className="space-y-6 scroll-mt-[10rem]">
          <h2 className="text-lg font-semibold text-white mb-4">Key player matchups</h2>
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
          {playerProps.length > 0 && (
            <>
              <h2 className="text-lg font-semibold text-white mb-4">Player props</h2>
              <div className="glass-card rounded-xl overflow-hidden border border-white/5">
                <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
                  <h2 className="text-sm font-semibold text-white">Player props</h2>
                </div>
                <div className="p-3 overflow-x-auto">
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
              </div>
            </>
          )}
        </section>

        <section id="section-injuries" className="scroll-mt-[10rem]">
          <h2 className="text-lg font-semibold text-white mb-4">Injuries</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-card rounded-xl overflow-hidden border border-white/5">
              <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02] flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-[#ff6b35] shrink-0" />
                <Link href={`/teams/${game.awayTeam.id}`} className="text-sm font-semibold text-white hover:text-[#00d4ff]">{game.awayTeam.name}</Link>
                {(injuries?.away?.length ?? 0) > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground">
                    {(injuries?.away?.length ?? 0)} listed
                  </span>
                )}
              </div>
              <div className="p-3">
                {(injuries?.away?.length ?? 0) > 0 ? injuries.away.map((injury, i) => <InjuryRow key={`${injury.player}-${i}`} injury={injury} />) : <p className="text-xs text-muted-foreground">No injuries reported</p>}
              </div>
            </div>
            <div className="glass-card rounded-xl overflow-hidden border border-white/5">
              <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02] flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-[#ff6b35] shrink-0" />
                <Link href={`/teams/${game.homeTeam.id}`} className="text-sm font-semibold text-white hover:text-[#00d4ff]">{game.homeTeam.name}</Link>
                {(injuries?.home?.length ?? 0) > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground">
                    {(injuries?.home?.length ?? 0)} listed
                  </span>
                )}
              </div>
              <div className="p-3">
                {(injuries?.home?.length ?? 0) > 0 ? injuries.home.map((injury, i) => <InjuryRow key={`${injury.player}-${i}`} injury={injury} />) : <p className="text-xs text-muted-foreground">No injuries reported</p>}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
