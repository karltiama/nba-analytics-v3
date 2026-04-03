'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Zap, Shield, TrendingUp, AlertTriangle, Target, Calendar, CalendarDays, ChevronDown, Loader2, Users } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Game } from './GameCard';
import { LineMovementChart } from './LineMovementChart';
import { StartingLineupCard } from './MatchupAnalysis';
import type { InjuryMatchupContext } from '@/lib/betting/injury-matchup-context';
import { buildInjuryContextNarrative } from '@/lib/betting/injury-context-narrative';
import {
  getGameSummaryBulletsForAi,
  formatOddsHintForAiSummary,
  buildAiSupplementalLines,
} from '@/lib/betting/ai-game-summary-payload';
import type { MarketSentimentSnapshot } from '@/lib/betting/market-sentiment-types';
import { MarketSentimentChart, resolveSentimentChartData } from '@/components/betting/MarketSentimentChart';

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
  key_players?: any[];
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

export type { MarketSentimentSnapshot } from '@/lib/betting/market-sentiment-types';

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
  /** Teammate splits when Out/Doubtful players did not play (box-score based). */
  injuryMatchupContext?: InjuryMatchupContext | null;
  /** Prediction-market crowd sentiment (e.g. Polymarket); optional until wired to an API. */
  marketSentiment?: MarketSentimentSnapshot | null;
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

// --- Player props filterable list ---
const LINE_NONE = '__none__';

function hasLineValue(prop: PlayerPropItem): boolean {
  const v = prop.lineValue;
  return v != null && !Number.isNaN(v);
}

function formatLineDisplay(prop: PlayerPropItem): string {
  if (!hasLineValue(prop)) return '—';
  return String(prop.lineValue);
}

function samePropMarket(a: PlayerPropItem, b: PlayerPropItem): boolean {
  return (
    a.playerId === b.playerId &&
    a.propType === b.propType &&
    a.lineValue === b.lineValue
  );
}

/** Prefer points; else first prop after stable sort. */
function pickPrimaryProp(props: PlayerPropItem[]): PlayerPropItem {
  if (props.length === 0) {
    throw new Error('pickPrimaryProp: empty');
  }
  const sorted = [...props].sort(
    (a, b) => a.propType.localeCompare(b.propType) || Number(a.lineValue) - Number(b.lineValue)
  );
  const pts = sorted.find((p) => p.propType.toLowerCase() === 'points');
  return pts ?? sorted[0];
}

function groupPropsByPlayer(props: PlayerPropItem[]): Array<{
  playerId: string;
  playerName: string;
  props: PlayerPropItem[];
}> {
  const map = new Map<string, PlayerPropItem[]>();
  for (const p of props) {
    if (!map.has(p.playerId)) map.set(p.playerId, []);
    map.get(p.playerId)!.push(p);
  }
  return Array.from(map.entries())
    .map(([playerId, list]) => ({
      playerId,
      playerName: list[0]?.playerName ?? '',
      props: list.sort(
        (a, b) => a.propType.localeCompare(b.propType) || Number(a.lineValue) - Number(b.lineValue)
      ),
    }))
    .sort((a, b) => a.playerName.localeCompare(b.playerName));
}

function PlayerPropsFilterableList({ props: playerProps }: { props: PlayerPropItem[] }) {
  const [filterPlayer, setFilterPlayer] = useState<string>('all');
  const [filterPropType, setFilterPropType] = useState<string>('all');
  const [filterLine, setFilterLine] = useState<string>('all');
  const [expandedPlayerIds, setExpandedPlayerIds] = useState<Set<string>>(() => new Set());

  const players = Array.from(
    new Map(playerProps.map((p) => [p.playerId, { id: p.playerId, name: p.playerName }])).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const propTypes = Array.from(new Set(playerProps.map((p) => p.propType))).sort();

  const hasAnyWithoutLine = playerProps.some((p) => !hasLineValue(p));
  const numericLines = Array.from(
    new Set(playerProps.filter(hasLineValue).map((p) => String(p.lineValue)))
  ).sort((a, b) => parseFloat(a) - parseFloat(b));

  const filtered = playerProps.filter((prop) => {
    if (filterPlayer !== 'all' && prop.playerId !== filterPlayer) return false;
    if (filterPropType !== 'all' && prop.propType !== filterPropType) return false;
    if (filterLine === 'all') return true;
    if (filterLine === LINE_NONE) return !hasLineValue(prop);
    return hasLineValue(prop) && String(prop.lineValue) === filterLine;
  });

  const grouped = useMemo(() => groupPropsByPlayer(filtered), [filtered]);

  const togglePlayerExpanded = (playerId: string) => {
    setExpandedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  const selectClass =
    'rounded-lg border border-white/10 bg-gray-900 text-white text-xs py-1.5 px-2 min-w-0 focus:outline-none focus:ring-1 focus:ring-[#00d4ff] focus:border-[#00d4ff]/50';
  const optionStyle = { backgroundColor: '#111827', color: '#fff' };

  return (
    <>
      <div className="glass-card rounded-xl overflow-hidden border border-white/5">
        <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02] flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-white shrink-0">Player props</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[10px] text-muted-foreground shrink-0">Player</label>
            <select
              value={filterPlayer}
              onChange={(e) => setFilterPlayer(e.target.value)}
              className={selectClass}
              aria-label="Filter by player"
            >
              <option value="all" style={optionStyle}>All players</option>
              {players.map((p) => (
                <option key={p.id} value={p.id} style={optionStyle}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="text-[10px] text-muted-foreground shrink-0 ml-1">Prop</label>
            <select
              value={filterPropType}
              onChange={(e) => setFilterPropType(e.target.value)}
              className={selectClass}
              aria-label="Filter by prop type"
            >
              <option value="all" style={optionStyle}>All props</option>
              {propTypes.map((t) => (
                <option key={t} value={t} style={optionStyle}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <label className="text-[10px] text-muted-foreground shrink-0 ml-1">Line</label>
            <select
              value={filterLine}
              onChange={(e) => setFilterLine(e.target.value)}
              className={selectClass}
              aria-label="Filter by line"
            >
              <option value="all" style={optionStyle}>All lines</option>
              {numericLines.map((l) => (
                <option key={l} value={l} style={optionStyle}>
                  {l}
                </option>
              ))}
              {hasAnyWithoutLine && (
                <option value={LINE_NONE} style={optionStyle}>(No line)</option>
              )}
            </select>
          </div>
          <span className="text-[10px] text-muted-foreground ml-auto text-right max-w-[11rem] leading-tight">
            {grouped.length} player{grouped.length === 1 ? '' : 's'} · {filtered.length} line{filtered.length === 1 ? '' : 's'}{' '}
            <span className="text-muted-foreground/80">(expand for more markets)</span>
          </span>
        </div>
        <div className="p-3 overflow-x-auto max-h-[min(520px,65vh)] overflow-y-auto">
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
              {grouped.length > 0 ? (
                grouped.flatMap((g) => {
                  const primary = pickPrimaryProp(g.props);
                  const rest = g.props.filter((p) => !samePropMarket(p, primary));
                  const isOpen = expandedPlayerIds.has(g.playerId);
                  const showExpand = rest.length > 0;

                  const rowFor = (prop: PlayerPropItem, opts: { sub?: boolean }) => (
                    <tr
                      key={`${prop.playerId}-${prop.propType}-${prop.lineValue}${opts.sub ? '-sub' : ''}`}
                      className={`border-b border-white/5 last:border-0 ${opts.sub ? 'bg-white/[0.02]' : ''}`}
                    >
                      <td className={`py-1.5 text-xs text-white ${opts.sub ? 'pl-8' : ''}`}>
                        {opts.sub ? (
                          <span className="text-[10px] text-muted-foreground">↳</span>
                        ) : (
                          <div className="flex items-center gap-1 min-w-0">
                            {showExpand ? (
                              <button
                                type="button"
                                onClick={() => togglePlayerExpanded(g.playerId)}
                                className="p-0.5 rounded shrink-0 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                                aria-expanded={isOpen}
                                aria-label={isOpen ? `Collapse props for ${g.playerName}` : `Expand ${rest.length} more props for ${g.playerName}`}
                              >
                                <ChevronDown
                                  className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                                />
                              </button>
                            ) : (
                              <span className="w-4 shrink-0" aria-hidden />
                            )}
                            <Link
                              href={`/betting/players/${prop.playerId}`}
                              className="hover:text-[#00d4ff] transition-colors truncate"
                            >
                              {prop.playerName}
                            </Link>
                            {showExpand && (
                              <span className="text-[10px] text-muted-foreground shrink-0">+{rest.length}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 text-[10px] text-muted-foreground capitalize">
                        {prop.propType.replace(/_/g, ' ')}
                      </td>
                      <td className="py-1.5 text-xs font-mono text-white text-center">{formatLineDisplay(prop)}</td>
                      <td className="py-1.5 text-[10px] font-mono text-center text-muted-foreground">
                        {prop.overOdds != null ? (prop.overOdds > 0 ? `+${prop.overOdds}` : prop.overOdds) : '—'}
                      </td>
                      <td className="py-1.5 text-[10px] font-mono text-center text-muted-foreground">
                        {prop.underOdds != null ? (prop.underOdds > 0 ? `+${prop.underOdds}` : prop.underOdds) : '—'}
                      </td>
                    </tr>
                  );

                  const rows = [rowFor(primary, {})];
                  if (isOpen) {
                    for (const p of rest) {
                      rows.push(rowFor(p, { sub: true }));
                    }
                  }
                  return rows;
                })
              ) : (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                    No props match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="text-[10px] text-muted-foreground mt-2">
            Odds from {playerProps[0]?.vendor ?? 'book'} · American format · Primary row is points when available
          </p>
        </div>
      </div>
    </>
  );
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

function MarketSentimentPanel({
  game,
  sentiment,
}: {
  game: Game;
  sentiment?: MarketSentimentSnapshot | null;
}) {
  const { points, mode } = resolveSentimentChartData(game.id, sentiment);
  const lastHome = points[points.length - 1].homeWinPct;
  const lastAway = Math.max(0, Math.min(100, 100 - lastHome));

  const awayBar = lastAway;
  const homeBar = lastHome;

  const caption =
    mode === 'history'
      ? 'Crowd-implied home win % over time (prediction market).'
      : mode === 'snapshot'
        ? 'Snapshot only — add price history for a full trajectory.'
        : 'Sample trajectory — wire Gamma + CLOB (or another public feed) for live data.';

  const sourceLine =
    mode === 'demo'
      ? 'Data: illustrative (not live).'
      : sentiment?.source
        ? `Source: ${sentiment.source}`
        : 'Source: prediction market';

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-2 py-2 sm:px-3 sm:py-2.5 h-full flex flex-col min-h-[200px]">
      <div className="flex items-start gap-2 mb-2">
        <Users className="w-3.5 h-3.5 text-white/40 shrink-0 mt-0.5" aria-hidden />
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Human sentiment</p>
          <p className="text-[10px] text-muted-foreground/90 leading-snug mt-0.5">
            Crowd-implied win odds from a prediction market — not a book line.
          </p>
        </div>
      </div>

      <div className="mb-2">
        <MarketSentimentChart data={points} homeTeamAbbr={game.homeTeam.abbreviation} />
        <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{caption}</p>
      </div>

      <div className="flex h-2.5 rounded-full overflow-hidden bg-white/10 mb-3 mt-1">
        <div
          className="h-full bg-[#00d4ff]/90 transition-[width]"
          style={{ width: `${awayBar}%` }}
          title={`${game.awayTeam.abbreviation} ${lastAway.toFixed(1)}%`}
        />
        <div
          className="h-full bg-[#39ff14]/90 transition-[width]"
          style={{ width: `${homeBar}%` }}
          title={`${game.homeTeam.abbreviation} ${lastHome.toFixed(1)}%`}
        />
      </div>
      <div className="space-y-2 text-xs flex-1">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{game.awayTeam.abbreviation}</span>
          <span className="font-mono tabular-nums text-[#00d4ff] font-semibold">{lastAway.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{game.homeTeam.abbreviation}</span>
          <span className="font-mono tabular-nums text-[#39ff14] font-semibold">{lastHome.toFixed(1)}%</span>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground mt-auto pt-2">{sourceLine}</p>
    </div>
  );
}

const SECTION_IDS = ['section-ai-projection', 'section-odds', 'section-matchup', 'section-players', 'section-injuries'] as const;
const SECTION_LABELS: Record<(typeof SECTION_IDS)[number], string> = {
  'section-ai-projection': 'AI Projection',
  'section-odds': 'Odds & sentiment',
  'section-matchup': 'Matchup',
  'section-players': 'Players',
  'section-injuries': 'Injuries',
};

export function MatchupPageLayout({ data }: { data: GameDetailsData }) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<(typeof SECTION_IDS)[number]>(SECTION_IDS[0]);
  const [aiSummaryText, setAiSummaryText] = useState<string | null>(null);
  const [aiSummaryStatus, setAiSummaryStatus] = useState<
    'idle' | 'loading' | 'success' | 'unavailable' | 'error'
  >('idle');
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
    injuryMatchupContext,
    marketSentiment,
  } = data;

  const summaryBullets = getGameSummaryBulletsForAi({
    matchupAnalysis: data.matchupAnalysis,
    homeTeamStats: data.homeTeamStats,
    awayTeamStats: data.awayTeamStats,
    spreadMovement: data.spreadMovement,
    injuries: data.injuries,
  });

  const injuryNarrative = useMemo(
    () =>
      injuryMatchupContext?.entries?.length
        ? buildInjuryContextNarrative(
            injuryMatchupContext,
            game.homeTeam.id,
            game.homeTeam.name,
            game.awayTeam.name
          )
        : null,
    [injuryMatchupContext, game.homeTeam.id, game.homeTeam.name, game.awayTeam.name]
  );

  const scrollToSection = (sectionId: (typeof SECTION_IDS)[number]) => {
    const el = document.getElementById(sectionId);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY;
    const stickyOffset = 160;
    window.scrollTo({ top: y - stickyOffset, behavior: 'smooth' });
    setActiveSection(sectionId);
  };

  const totalListedInjuries = (injuries?.home?.length ?? 0) + (injuries?.away?.length ?? 0);

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

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    async function loadAiSummary() {
      setAiSummaryStatus('loading');
      setAiSummaryText(null);
      const bullets = getGameSummaryBulletsForAi({
        matchupAnalysis,
        homeTeamStats: data.homeTeamStats,
        awayTeamStats: data.awayTeamStats,
        spreadMovement: data.spreadMovement,
        injuries: data.injuries,
      });
      const oddsHint = formatOddsHintForAiSummary(currentOdds, game);
      const supplemental = buildAiSupplementalLines(
        data.injuries,
        data.injuryMatchupContext,
        game,
        matchupAnalysis
      );
      const body: Record<string, unknown> = {
        homeTeamName: game.homeTeam.name,
        awayTeamName: game.awayTeam.name,
        bullets,
        oddsHint,
      };
      if (supplemental.injuryReportLines.length) {
        body.injuryReportLines = supplemental.injuryReportLines;
      }
      if (supplemental.usageShiftLines.length) {
        body.usageShiftLines = supplemental.usageShiftLines;
      }
      if (supplemental.expectedStarterLines.length) {
        body.expectedStarterLines = supplemental.expectedStarterLines;
      }
      if (injuryNarrative) {
        body.injuryIntro = injuryNarrative.intro;
        body.injuryParagraphs = injuryNarrative.paragraphs;
      }

      try {
        const res = await fetch(`/api/betting/games/${encodeURIComponent(game.id)}/ai-projection-summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        const j = (await res.json().catch(() => ({}))) as {
          summary?: string;
          code?: string;
        };
        if (cancelled) return;
        if (res.status === 503 && j?.code === 'NO_OPENAI_KEY') {
          setAiSummaryStatus('unavailable');
          return;
        }
        if (!res.ok) {
          setAiSummaryStatus('error');
          return;
        }
        const text = typeof j.summary === 'string' ? j.summary.trim() : '';
        if (text) {
          setAiSummaryText(text);
          setAiSummaryStatus('success');
        } else {
          setAiSummaryStatus('error');
        }
      } catch {
        if (ac.signal.aborted || cancelled) return;
        setAiSummaryStatus('error');
      }
    }

    loadAiSummary();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [data, injuryNarrative, matchupAnalysis]);

  return (
    <main className="min-h-screen bg-background gradient-mesh max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-5">
      {/* Sticky header: matchup + horizontal section nav (scroll-to-section everywhere) */}
      <div className="sticky top-0 z-10 glass-card rounded-xl overflow-hidden border border-white/5 bg-background/95 backdrop-blur-sm">
        <div className="px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-center gap-x-4 gap-y-2 min-w-0 bg-white/[0.02] relative">
          <button
            type="button"
            onClick={() => router.push('/betting')}
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-muted-foreground hover:text-[#00d4ff] hover:bg-white/10 transition-colors"
            aria-label="Back to Betting"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 min-w-0 shrink-0">
            <Calendar className="w-4 h-4 text-[#00d4ff] shrink-0" />
            <span className="text-sm font-medium text-muted-foreground truncate">{game.startTime}</span>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <Link href={`/teams/${game.awayTeam.id}`} className="text-center hover:opacity-90 transition-opacity">
              <span className="block text-base sm:text-lg font-semibold text-white hover:text-[#00d4ff] transition-colors">{game.awayTeam.abbreviation}</span>
              <span className="block text-[11px] sm:text-xs text-muted-foreground mt-0.5">{game.awayTeam.record}</span>
            </Link>
            <span className="text-xs text-muted-foreground">@</span>
            <Link href={`/teams/${game.homeTeam.id}`} className="text-center hover:opacity-90 transition-opacity">
              <span className="block text-base sm:text-lg font-semibold text-white hover:text-[#00d4ff] transition-colors">{game.homeTeam.abbreviation}</span>
              <span className="block text-[11px] sm:text-xs text-muted-foreground mt-0.5">{game.homeTeam.record}</span>
            </Link>
          </div>
        </div>
        <div className="px-3 sm:px-5 py-2 border-t border-white/5 flex flex-wrap items-center justify-center gap-1.5 bg-white/[0.02]">
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

      <div className="mt-4 flex flex-col lg:flex-row lg:items-start gap-4 lg:gap-5">
        <div className="flex-1 min-w-0 space-y-4">
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
            {aiSummaryStatus === 'loading' && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-[#bf5af2]/90" aria-hidden />
                <span>Generating summary…</span>
              </div>
            )}
            {aiSummaryStatus === 'success' && aiSummaryText && (
              <p className="text-sm text-white/90 leading-relaxed mt-3 border-l-2 border-[#bf5af2]/35 pl-3">
                {aiSummaryText}
              </p>
            )}
            {aiSummaryStatus === 'unavailable' && (
              <p className="text-xs text-muted-foreground mt-3">
                Add <span className="font-mono text-white/70">OPENAI_API_KEY</span> on the server to enable the
                AI-written summary.
              </p>
            )}
            {aiSummaryStatus === 'error' && (
              <p className="text-xs text-amber-400/90 mt-3">Could not load AI summary. Try again later.</p>
            )}
            {injuryMatchupContext?.entries?.length ? (
              <div className="mt-4 pt-4 border-t border-white/5 space-y-3">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Out / doubtful — players to watch (splits)
                </p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  From season box scores: teammate PTS when listed players had minutes vs no minutes. Descriptive only—not a projection; tiny samples can mislead.
                </p>
                <details className="group rounded-lg border border-white/10 bg-white/[0.02]">
                  <summary className="cursor-pointer list-none px-3 py-2 text-[11px] text-muted-foreground hover:text-white/90 [&::-webkit-details-marker]:hidden flex items-center gap-2">
                    <ChevronDown className="w-3.5 h-3.5 shrink-0 transition-transform group-open:rotate-180" />
                    Underlying numbers
                  </summary>
                  <div className="px-3 pb-3 pt-0 space-y-3 border-t border-white/5">
                    {injuryMatchupContext?.entries.map((entry) => {
                      const teamLabel =
                        entry.team_id === game.homeTeam.id ? game.homeTeam.name : game.awayTeam.name;
                      return (
                        <div key={entry.player_id} className="border border-white/5 rounded-lg p-2.5 bg-white/[0.02]">
                          <div className="flex flex-wrap items-baseline gap-2 mb-2">
                            <span className="text-xs font-medium text-white">{entry.full_name}</span>
                            <span className="text-[10px] text-muted-foreground">{teamLabel}</span>
                            <span className="text-[10px] text-muted-foreground">
                              With minutes {entry.games_played_sample} · No minutes {entry.games_missed_sample} team games
                            </span>
                            {entry.low_sample && (
                              <span className="text-[10px] text-amber-400/90">Low sample</span>
                            )}
                          </div>
                          {entry.teammates.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground">No teammate split data.</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-[10px] text-left">
                                <thead>
                                  <tr className="text-muted-foreground border-b border-white/5">
                                    <th className="py-1 pr-2 font-normal">Teammate</th>
                                    <th className="py-1 px-1 font-normal">PTS (with)</th>
                                    <th className="py-1 px-1 font-normal">PTS (out)</th>
                                    <th className="py-1 px-1 font-normal">Δ</th>
                                    <th className="py-1 pl-1 font-normal text-right">n</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {entry.teammates.map((t) => (
                                    <tr key={t.player_id} className="border-b border-white/[0.03] text-white/90">
                                      <td className="py-1 pr-2 truncate max-w-[140px]" title={t.full_name}>
                                        {t.full_name}
                                      </td>
                                      <td className="py-1 px-1">{t.avg_pts_with ?? '—'}</td>
                                      <td className="py-1 px-1">{t.avg_pts_without ?? '—'}</td>
                                      <td className={`py-1 px-1 ${(t.pts_delta ?? 0) > 0 ? 'text-emerald-400/90' : (t.pts_delta ?? 0) < 0 ? 'text-rose-400/90' : ''}`}>
                                        {t.pts_delta != null ? (t.pts_delta > 0 ? `+${t.pts_delta}` : String(t.pts_delta)) : '—'}
                                      </td>
                                      <td className="py-1 pl-1 text-right text-muted-foreground">
                                        {t.n_games_played_with}/{t.n_games_missed}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground mt-3">
              {aiSummaryStatus === 'success' && aiSummaryText ? (
                <>
                  Generated from on-page signals; not betting advice.{' '}
                  <span className="text-white/35">·</span> Full AI projection — coming soon
                </>
              ) : (
                'Full AI projection — coming soon'
              )}
            </p>
            </div>
          </div>
        </section>

        <section id="section-odds" className="scroll-mt-[10rem]">
          <div className="glass-card rounded-xl overflow-hidden border border-white/5">
            <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
              <h2 className="text-sm font-semibold text-white">Odds & line movement</h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">Sportsbook lines and crowd sentiment side by side</p>
            </div>
            <div className="p-2.5 sm:p-3">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:items-stretch">
                <div className="space-y-3 min-w-0 flex flex-col">
                  <div className="rounded-lg border border-white/5 bg-white/[0.02] px-2 py-2 sm:px-3 sm:py-2.5">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Odds & lines</p>
                    <div className="flex items-stretch justify-between gap-2 sm:gap-4 w-full">
                      <div className="text-center flex-1 min-w-0">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Spread</p>
                        <p className="text-base sm:text-lg font-bold text-white tabular-nums">
                          {currentOdds?.spread != null ? `${game.homeTeam.abbreviation} ${currentOdds.spread > 0 ? '+' : ''}${currentOdds.spread}` : '—'}
                        </p>
                        {(currentOdds?.spreadOddsHome != null || currentOdds?.spreadOddsAway != null) && (
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5 leading-tight">
                            {game.homeTeam.abbreviation} {currentOdds?.spreadOddsHome != null ? (currentOdds.spreadOddsHome > 0 ? `+${currentOdds.spreadOddsHome}` : currentOdds.spreadOddsHome) : '—'} / {game.awayTeam.abbreviation} {currentOdds?.spreadOddsAway != null ? (currentOdds.spreadOddsAway > 0 ? `+${currentOdds.spreadOddsAway}` : currentOdds.spreadOddsAway) : '—'}
                          </p>
                        )}
                      </div>
                      <div className="w-px min-h-10 bg-white/10 shrink-0 self-center" />
                      <div className="text-center flex-1 min-w-0">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Moneyline</p>
                        <p className="text-xs sm:text-sm font-bold text-white leading-tight">
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
                      <div className="w-px min-h-10 bg-white/10 shrink-0 self-center" />
                      <div className="text-center flex-1 min-w-0">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Total</p>
                        <p className="text-base sm:text-lg font-bold text-white tabular-nums">{currentOdds?.overUnder ?? '—'}</p>
                        {(currentOdds?.overOdds != null || currentOdds?.underOdds != null) && (
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5 leading-tight">
                            O {currentOdds?.overOdds != null ? (currentOdds.overOdds > 0 ? `+${currentOdds.overOdds}` : currentOdds.overOdds) : '—'} / U {currentOdds?.underOdds != null ? (currentOdds.underOdds > 0 ? `+${currentOdds.underOdds}` : currentOdds.underOdds) : '—'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-white/5 pt-3 flex-1 min-h-0">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Line movement</p>
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
                        <LineMovementChart data={spreadMovement} label={`Spread: ${game.homeTeam.abbreviation}`} color="#00d4ff" height={176} width={520} embedded />
                      </TabsContent>
                      <TabsContent value="total" className="mt-0 outline-none">
                        <LineMovementChart data={totalMovement} label="Total (O/U)" color="#39ff14" height={176} width={520} embedded />
                      </TabsContent>
                    </Tabs>
                  </div>
                </div>

                <div className="min-w-0 lg:border-l lg:border-white/5 lg:pl-3 flex flex-col">
                  <MarketSentimentPanel game={game} sentiment={marketSentiment} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="section-matchup" className="space-y-4 scroll-mt-[10rem]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
                </>
              );
            })()}
            </div>
            </div>
          </div>
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

        <section id="section-players" className="space-y-4 scroll-mt-[10rem]">
          {playerProps.length > 0 && (
            <PlayerPropsFilterableList props={playerProps} />
          )}
        </section>

        <section id="section-injuries" className="scroll-mt-[10rem]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

        <aside
          className="hidden lg:flex flex-col w-[17rem] shrink-0 gap-3 self-start sticky top-40 z-[5] pt-1"
          aria-label="Game snapshot"
        >
          <div className="glass-card rounded-xl border border-white/5 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
              <p className="text-xs font-semibold text-white">At a glance</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Snapshot only — scroll the page for full sections</p>
            </div>
            <div className="p-3 space-y-3 text-xs">
              <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
                <span>{game.awayTeam.abbreviation}</span>
                <span className="text-white font-mono tabular-nums">{game.awayTeam.record}</span>
              </div>
              <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
                <span>{game.homeTeam.abbreviation}</span>
                <span className="text-white font-mono tabular-nums">{game.homeTeam.record}</span>
              </div>
              <div className="border-t border-white/5 pt-3 space-y-2">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Lines</p>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Spread</span>
                  <span className="text-white font-mono tabular-nums text-right">
                    {currentOdds?.spread != null
                      ? `${game.homeTeam.abbreviation} ${currentOdds.spread > 0 ? '+' : ''}${currentOdds.spread}`
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Total</span>
                  <span className="text-white font-mono tabular-nums">{currentOdds?.overUnder ?? '—'}</span>
                </div>
                <div className="text-[10px] text-muted-foreground leading-snug">
                  ML{' '}
                  <span className="text-white/90">
                    {currentOdds?.moneylineAway != null && currentOdds?.moneylineHome != null
                      ? `${game.awayTeam.abbreviation} ${currentOdds.moneylineAway > 0 ? '+' : ''}${currentOdds.moneylineAway} · ${game.homeTeam.abbreviation} ${currentOdds.moneylineHome > 0 ? '+' : ''}${currentOdds.moneylineHome}`
                      : '—'}
                  </span>
                </div>
                {currentOdds?.bookmaker && (
                  <p className="text-[10px] text-muted-foreground pt-1">Book: {currentOdds.bookmaker}</p>
                )}
              </div>
              <div className="border-t border-white/5 pt-3">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Injuries</p>
                <p className="text-[11px] text-white/90">
                  {totalListedInjuries === 0
                    ? 'None listed'
                    : `${totalListedInjuries} player${totalListedInjuries === 1 ? '' : 's'} on report`}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {game.awayTeam.abbreviation} {injuries?.away?.length ?? 0} · {game.homeTeam.abbreviation}{' '}
                  {injuries?.home?.length ?? 0}
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
