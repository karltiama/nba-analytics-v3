'use client';

import { useState, useEffect, useCallback } from 'react';
import { Zap, TrendingUp, AlertTriangle, Target, DollarSign, Activity } from 'lucide-react';
import {
  Header,
  type Insight,
} from '@/components/betting';
import { RecentGamesTable } from './RecentGamesTimeline';
import { UpcomingGames } from './UpcomingGames';
import { TeamTrendChart, type Timeframe, type LocationFilter, type TeamTrendMetric } from './TeamTrendChart';

function getInsightIcon(type: Insight['type']) {
  const iconMap = {
    pace: <Activity className="w-3.5 h-3.5 text-[#00d4ff]" />,
    trend: <TrendingUp className="w-3.5 h-3.5 text-[#39ff14]" />,
    sharp: <DollarSign className="w-3.5 h-3.5 text-[#ff6b35]" />,
    injury: <AlertTriangle className="w-3.5 h-3.5 text-[#ff4757]" />,
    value: <Target className="w-3.5 h-3.5 text-[#bf5af2]" />,
    general: <Zap className="w-3.5 h-3.5 text-[#00d4ff]" />,
  };
  return iconMap[type] || iconMap.general;
}

function getImportanceDot(importance: Insight['importance']) {
  const colors = { high: 'bg-[#ff4757]', medium: 'bg-[#ff6b35]', low: 'bg-[#39ff14]' };
  return colors[importance];
}

function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground uppercase">{label}</span>
      <span className="text-sm font-bold font-mono" style={color ? { color } : { color: 'white' }}>{value}</span>
    </div>
  );
}

interface TeamInfo {
  team_id: string;
  abbreviation: string;
  full_name: string;
  name: string;
  city: string;
  conference: string;
  division: string;
}

interface TeamStats {
  season_stats: any;
  season_record?: {
    games_played: number | string;
    wins: number | string;
    losses: number | string;
    home_wins: number | string;
    home_losses: number | string;
    away_wins: number | string;
    away_losses: number | string;
  };
  rankings: any;
  splits: any;
  recent_form: any;
  quarter_strengths: any;
}

interface TeamPageContentProps {
  teamId: string;
  rosterSlot?: React.ReactNode;
}

export function TeamPageContent({ teamId, rosterSlot }: TeamPageContentProps) {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);

  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [teamStats, setTeamStats] = useState<TeamStats | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [upcomingGames, setUpcomingGames] = useState<any[]>([]);

  const [loadingTeam, setLoadingTeam] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingInsights, setLoadingInsights] = useState(true);
  const [loadingUpcoming, setLoadingUpcoming] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trendTimeframe, setTrendTimeframe] = useState<Timeframe>(20);
  const [trendLocation, setTrendLocation] = useState<LocationFilter>('all');
  const [trendMetric, setTrendMetric] = useState<TeamTrendMetric>('team_total');

  useEffect(() => {
    setSelectedDate(new Date());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const fetchTeam = useCallback(async () => {
    setLoadingTeam(true);
    try {
      const res = await fetch(`/api/teams/${teamId}`);
      if (!res.ok) throw new Error('Failed to fetch team');
      const data = await res.json();
      setTeam(data);
    } catch (err: any) {
      console.error('Error fetching team:', err);
      setError(err.message);
    } finally {
      setLoadingTeam(false);
    }
  }, [teamId]);

  const fetchTeamStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/stats`);
      if (!res.ok) throw new Error('Failed to fetch team stats');
      const data = await res.json();
      setTeamStats(data);
    } catch (err: any) {
      console.error('Error fetching team stats:', err);
    } finally {
      setLoadingStats(false);
    }
  }, [teamId]);

  const fetchInsights = useCallback(async () => {
    setLoadingInsights(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/insights`);
      if (!res.ok) throw new Error('Failed to fetch insights');
      const data = await res.json();
      setInsights(data.insights || []);
    } catch (err: any) {
      console.error('Error fetching insights:', err);
    } finally {
      setLoadingInsights(false);
    }
  }, [teamId]);

  const fetchUpcomingGames = useCallback(async () => {
    setLoadingUpcoming(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/upcoming?limit=5`);
      if (!res.ok) throw new Error('Failed to fetch upcoming games');
      const data = await res.json();
      setUpcomingGames(data.games || []);
    } catch (err: any) {
      console.error('Error fetching upcoming games:', err);
    } finally {
      setLoadingUpcoming(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (teamId) {
      fetchTeam();
      fetchTeamStats();
      fetchInsights();
      fetchUpcomingGames();
    }
  }, [teamId, fetchTeam, fetchTeamStats, fetchInsights, fetchUpcomingGames]);

  if (!mounted) {
    return null;
  }

  if (error && !team) {
    return (
      <div className="min-h-screen bg-background gradient-mesh">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-6">
          <div className="glass-card rounded-xl p-8 text-center">
            <h1 className="text-2xl font-bold text-white mb-4">Team not found</h1>
            <p className="text-muted-foreground mb-4">{error}</p>
            <button
              onClick={() => { setError(null); fetchTeam(); }}
              className="text-sm text-[#00d4ff] hover:underline"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background gradient-mesh">
      <Header
        selectedDate={selectedDate || new Date()}
        onDateChange={setSelectedDate}
        isDarkMode={isDarkMode}
        onThemeToggle={() => setIsDarkMode(!isDarkMode)}
        teamName={team?.full_name}
        teamAbbr={team?.abbreviation}
      />

      {/* AI Insights Ticker */}
      {!loadingInsights && insights.length > 0 && (
        <div className="border-b border-white/5 bg-white/[0.02]">
          <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 py-2">
              <div className="flex items-center gap-1.5 shrink-0">
                <Zap className="w-3.5 h-3.5 text-[#bf5af2]" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#bf5af2]">AI Insights</span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#39ff14] pulse-dot" />
              </div>
              <div className="h-4 w-px bg-white/10 shrink-0" />
              <div className="flex-1 overflow-x-auto scrollbar-hide">
                <div className="flex items-center gap-3">
                  {insights.map((insight) => (
                    <div
                      key={insight.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-colors shrink-0 max-w-[340px] group cursor-default"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getImportanceDot(insight.importance)}`} />
                      {getInsightIcon(insight.type)}
                      <span className="text-xs text-white font-medium truncate">{insight.title}</span>
                      <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
                        {insight.description.length > 60 ? insight.description.slice(0, 60) + '…' : insight.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-6 min-h-[calc(100vh-5rem)]">
        <div className="flex flex-col xl:flex-row gap-6 xl:min-h-[calc(100vh-8rem)]">
          <div className="flex-1 space-y-6 min-w-0">
            {(loadingTeam || loadingStats) ? (
              <div className="glass-card rounded-xl p-8">
                <div className="animate-pulse space-y-4">
                  <div className="h-8 bg-white/10 rounded w-1/3" />
                  <div className="h-4 bg-white/10 rounded w-1/2" />
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="h-24 bg-white/10 rounded" />
                    ))}
                  </div>
                </div>
              </div>
            ) : team ? (() => {
              const seasonRecord = teamStats?.season_record;
              const totalWins = Number(seasonRecord?.wins) || 0;
              const totalLosses = Number(seasonRecord?.losses) || 0;
              const totalGames = Number(seasonRecord?.games_played) || 0;
              const winPct = totalGames > 0 ? ((totalWins / totalGames) * 100).toFixed(1) : '0.0';
              const last10 = teamStats?.recent_form?.last_10;
              const recentGames = last10?.games || [];
              let streakCount = 0;
              let streakType: 'W' | 'L' | null = null;
              if (recentGames.length > 0) {
                streakType = recentGames[0].result;
                for (const game of recentGames) {
                  if (game.result === streakType) {
                    streakCount++;
                  } else {
                    break;
                  }
                }
              }
              const homeWins = Number(seasonRecord?.home_wins) || 0;
              const homeLosses = Number(seasonRecord?.home_losses) || 0;
              const awayWins = Number(seasonRecord?.away_wins) || 0;
              const awayLosses = Number(seasonRecord?.away_losses) || 0;
              const homeRecord = teamStats?.splits?.home;
              const awayRecord = teamStats?.splits?.away;

              const ppg = teamStats?.season_stats?.points_for ? Number(teamStats.season_stats.points_for).toFixed(1) : null;
              const oppPpg = teamStats?.season_stats?.points_against ? Number(teamStats.season_stats.points_against).toFixed(1) : null;

              return (
                <section className="glass-card rounded-xl p-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    {/* Logo + name */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#00d4ff] to-[#bf5af2] flex items-center justify-center border border-white/10">
                        <span className="text-sm font-bold text-white">{team.abbreviation}</span>
                      </div>
                      <div>
                        <h1 className="text-lg font-bold text-white leading-tight">{team.full_name}</h1>
                        <p className="text-[10px] text-muted-foreground">{team.conference} • {team.division}</p>
                      </div>
                    </div>

                    <div className="h-8 w-px bg-white/10 hidden md:block" />

                    {/* Inline stats */}
                    {teamStats && (
                      <div className="flex items-center gap-4 flex-wrap">
                        <StatPill label="Record" value={`${totalWins}-${totalLosses}`} />
                        <StatPill label="Win%" value={`${winPct}%`} color={parseFloat(winPct) >= 50 ? '#39ff14' : '#ff6b35'} />
                        <StatPill label="Home" value={`${homeWins}-${homeLosses}`} />
                        <StatPill label="Away" value={`${awayWins}-${awayLosses}`} />
                        {ppg && <StatPill label="PPG" value={ppg} />}
                        {oppPpg && <StatPill label="Opp" value={oppPpg} />}
                        {teamStats.rankings?.offensive_rank && <StatPill label="ORtg" value={`#${teamStats.rankings.offensive_rank}`} color="#39ff14" />}
                        {teamStats.rankings?.defensive_rank && <StatPill label="DRtg" value={`#${teamStats.rankings.defensive_rank}`} color="#ff6b35" />}
                        {streakCount > 0 && streakType && (
                          <span className={`text-xs font-semibold px-2 py-1 rounded ${streakType === 'W' ? 'bg-[#39ff14]/20 text-[#39ff14]' : 'bg-[#ff4757]/20 text-[#ff4757]'}`}>
                            {streakCount}{streakType}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              );
            })() : null}

            {error && (
              <div className="glass-card rounded-xl p-4 border-l-4 border-l-[#ff4757]">
                <p className="text-sm text-[#ff4757]">Error loading data: {error}</p>
                <button
                  onClick={() => { setError(null); fetchTeam(); fetchTeamStats(); }}
                  className="mt-2 text-xs text-[#00d4ff] hover:underline"
                >
                  Retry
                </button>
              </div>
            )}

            {(() => {
              const recentForm = teamStats?.recent_form;
              const allGames = (recentForm?.last_20?.games ?? recentForm?.last_10?.games ?? []) as Array<{
                points_for: number;
                points_against?: number;
                margin?: number;
                opponent_abbr?: string;
                is_home?: boolean;
              }>;
              const byLocation =
                trendLocation === 'all'
                  ? allGames
                  : allGames.filter((g) => (trendLocation === 'home' ? g.is_home : !g.is_home));
              const filteredGames =
                trendTimeframe === 'season' ? byLocation : byLocation.slice(0, trendTimeframe);

              const teamPpg = teamStats?.season_stats?.points_for != null
                ? Number(teamStats.season_stats.points_for)
                : 0;
              const oppPpg = teamStats?.season_stats?.points_against != null
                ? Number(teamStats.season_stats.points_against)
                : 0;

              let trendData: number[];
              let seasonAvg: number;
              if (trendMetric === 'team_total') {
                trendData = filteredGames.map((g) => g.points_for ?? 0);
                seasonAvg = teamPpg || (trendData.length > 0 ? trendData.reduce((a, b) => a + b, 0) / trendData.length : 0);
              } else if (trendMetric === 'game_total') {
                trendData = filteredGames.map((g) => (g.points_for ?? 0) + (g.points_against ?? 0));
                seasonAvg = teamPpg + oppPpg || (trendData.length > 0 ? trendData.reduce((a, b) => a + b, 0) / trendData.length : 0);
              } else if (trendMetric === 'spread') {
                trendData = filteredGames.map((g) => g.margin ?? (g.points_for ?? 0) - (g.points_against ?? 0));
                seasonAvg = trendData.length > 0 ? trendData.reduce((a, b) => a + b, 0) / trendData.length : 0;
              } else {
                trendData = filteredGames.map((g) => g.points_for ?? 0);
                seasonAvg = teamPpg || 0;
              }

              const trendLabels = filteredGames.map((g) => g.opponent_abbr ?? '—');
              if (trendData.length === 0) return null;
              return (
                <section>
                  <TeamTrendChart
                    data={trendData}
                    seasonAvg={seasonAvg}
                    labels={trendLabels}
                    metric={trendMetric}
                    onMetricChange={setTrendMetric}
                    timeframe={trendTimeframe}
                    onTimeframeChange={setTrendTimeframe}
                    locationFilter={trendLocation}
                    onLocationFilterChange={setTrendLocation}
                  />
                </section>
              );
            })()}

            {teamStats?.recent_form?.last_5?.games && (
              <section>
                <RecentGamesTable
                  games={teamStats.recent_form.last_5.games}
                  teamId={teamId}
                  loading={loadingStats}
                />
              </section>
            )}

            <section>
              <UpcomingGames
                games={upcomingGames}
                teamId={teamId}
                loading={loadingUpcoming}
              />
            </section>

            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Team Analysis</h2>
                <span className="text-[10px] px-2 py-1 bg-[#bf5af2]/20 text-[#bf5af2] rounded-full font-medium">
                  COMING SOON
                </span>
              </div>
              <div className="glass-card rounded-xl p-8 text-center">
                <p className="text-muted-foreground">More team-based analytics coming soon</p>
                <p className="text-xs text-muted-foreground/60 mt-2">
                  Player props, matchup analysis, and advanced metrics
                </p>
              </div>
            </section>
          </div>

          <aside className="w-full xl:w-80 shrink-0 xl:min-h-[calc(100vh-8rem)] flex flex-col">
            <div className="xl:sticky xl:top-20 xl:flex-1 xl:flex xl:flex-col xl:min-h-0">
              {rosterSlot}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
