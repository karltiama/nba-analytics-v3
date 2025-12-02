'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Header,
  AIInsightPanel,
  type Insight,
} from '@/components/betting';
import {
  AIInsightPanelSkeleton,
} from '@/components/betting/skeletons';
import { RecentGamesTable } from './components/RecentGamesTimeline';
import { UpcomingGames } from './components/UpcomingGames';

// ================================
// DATA FETCHING
// ================================

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

// ================================
// MAIN COMPONENT
// ================================

export default function TeamPage() {
  const params = useParams();
  const teamId = params.teamId as string;
  
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);

  // Data states
  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [teamStats, setTeamStats] = useState<TeamStats | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [upcomingGames, setUpcomingGames] = useState<any[]>([]);
  
  // Loading states
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingInsights, setLoadingInsights] = useState(true);
  const [loadingUpcoming, setLoadingUpcoming] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Set initial date on mount to avoid hydration mismatch
  useEffect(() => {
    setSelectedDate(new Date());
    setMounted(true);
  }, []);

  // Apply dark mode class to html element
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Fetch team info
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

  // Fetch team stats
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

  // Fetch team insights
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

  // Fetch upcoming games
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

  // Initial data fetch
  useEffect(() => {
    if (teamId) {
      fetchTeam();
      fetchTeamStats();
      fetchInsights();
      fetchUpcomingGames();
    }
  }, [teamId, fetchTeam, fetchTeamStats, fetchInsights, fetchUpcomingGames]);

  const isLoading = loadingTeam || loadingStats || loadingInsights;

  if (!mounted) {
    return null; // Prevent hydration mismatch
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

      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-6">
        <div className="flex flex-col xl:flex-row gap-6">
          {/* Main Content */}
          <div className="flex-1 space-y-6">
            {/* Team Header Section */}
            {loadingTeam ? (
              <div className="glass-card rounded-xl p-8">
                <div className="animate-pulse space-y-4">
                  <div className="h-8 bg-white/10 rounded w-1/3" />
                  <div className="h-4 bg-white/10 rounded w-1/2" />
                </div>
              </div>
            ) : team ? (
              <section className="glass-card rounded-xl p-6">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#00d4ff] to-[#bf5af2] flex items-center justify-center border border-white/10">
                    <span className="text-2xl font-bold text-white">{team.abbreviation}</span>
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-white">{team.full_name}</h1>
                    <p className="text-sm text-muted-foreground">
                      {team.conference} Conference • {team.division} Division
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            {/* Error State */}
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

            {/* Team Stats Overview */}
            {loadingStats ? (
              <div className="glass-card rounded-xl p-8">
                <div className="animate-pulse space-y-4">
                  <div className="h-6 bg-white/10 rounded w-1/4" />
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="h-24 bg-white/10 rounded" />
                    ))}
                  </div>
                </div>
              </div>
            ) : teamStats ? (() => {
              // Use full season record from bbref_games (Basketball Reference source)
              const seasonRecord = teamStats.season_record;
              // Convert string values to numbers (PostgreSQL returns numeric types as strings)
              const totalWins = Number(seasonRecord?.wins) || 0;
              const totalLosses = Number(seasonRecord?.losses) || 0;
              const totalGames = Number(seasonRecord?.games_played) || 0;
              const winPct = totalGames > 0 ? ((totalWins / totalGames) * 100).toFixed(1) : '0.0';
              
              // Get recent form for streak calculation
              const last10 = teamStats.recent_form?.last_10;
              
              // Calculate streak from recent games
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
              
              // Get home/away records from season record (Basketball Reference source)
              const homeWins = Number(seasonRecord?.home_wins) || 0;
              const homeLosses = Number(seasonRecord?.home_losses) || 0;
              const awayWins = Number(seasonRecord?.away_wins) || 0;
              const awayLosses = Number(seasonRecord?.away_losses) || 0;
              
              // Get home/away splits for PPG display
              const homeRecord = teamStats.splits?.home;
              const awayRecord = teamStats.splits?.away;

              return (
                <section>
                  <h2 className="text-lg font-semibold text-white mb-4">Team Overview</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Record & Win % Card */}
                    <div className="glass-card rounded-xl p-4">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Season Record</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-muted-foreground">Overall</span>
                          <span className="text-lg font-bold text-white">
                            {totalWins}-{totalLosses}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">Win %</span>
                          <span className={`text-sm font-semibold ${
                            parseFloat(winPct) >= 50 ? 'text-[#39ff14]' : 'text-[#ff6b35]'
                          }`}>
                            {winPct}%
                          </span>
                        </div>
                        {streakCount > 0 && streakType && (
                          <div className="flex justify-between items-center pt-2 border-t border-white/5">
                            <span className="text-xs text-muted-foreground">Streak</span>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                              streakType === 'W' 
                                ? 'bg-[#39ff14]/20 text-[#39ff14]' 
                                : 'bg-[#ff4757]/20 text-[#ff4757]'
                            }`}>
                              {streakCount} {streakType}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Home/Away Split Card */}
                    <div className="glass-card rounded-xl p-4">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Home/Away</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">Home</span>
                          <span className="text-sm font-semibold text-white">
                            {homeWins}-{homeLosses}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">Away</span>
                          <span className="text-sm font-semibold text-white">
                            {awayWins}-{awayLosses}
                          </span>
                        </div>
                        {homeRecord?.points_for && awayRecord?.points_for && (
                          <div className="pt-2 border-t border-white/5">
                            <div className="text-[10px] text-muted-foreground">
                              Home: {Number(homeRecord.points_for).toFixed(1)} PPG
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              Away: {Number(awayRecord.points_for).toFixed(1)} PPG
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Season Stats Card */}
                    <div className="glass-card rounded-xl p-4">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Season Stats</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">Points For</span>
                          <span className="text-sm font-semibold text-white">
                            {teamStats.season_stats?.points_for 
                              ? Number(teamStats.season_stats.points_for).toFixed(1) 
                              : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">Points Against</span>
                          <span className="text-sm font-semibold text-white">
                            {teamStats.season_stats?.points_against 
                              ? Number(teamStats.season_stats.points_against).toFixed(1) 
                              : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">Pace</span>
                          <span className="text-sm font-semibold text-[#00d4ff]">
                            {teamStats.season_stats?.pace 
                              ? Number(teamStats.season_stats.pace).toFixed(1) 
                              : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Rankings Card */}
                    <div className="glass-card rounded-xl p-4">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">League Rankings</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">Offensive Rank</span>
                          <span className="text-sm font-semibold text-[#39ff14]">
                            {teamStats.rankings?.offensive_rank || 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">Defensive Rank</span>
                          <span className="text-sm font-semibold text-[#ff6b35]">
                            {teamStats.rankings?.defensive_rank || 'N/A'}
                          </span>
                        </div>
                        {teamStats.rankings?.offensive_rank && teamStats.rankings?.defensive_rank && (
                          <div className="pt-2 border-t border-white/5">
                            <div className="text-[10px] text-muted-foreground">
                              Net: {teamStats.rankings.offensive_rank - teamStats.rankings.defensive_rank > 0 ? '+' : ''}
                              {teamStats.rankings.offensive_rank - teamStats.rankings.defensive_rank}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })() : null}

            {/* Last 5 Games Table */}
            {teamStats?.recent_form?.last_5?.games && (
              <section>
                <RecentGamesTable
                  games={teamStats.recent_form.last_5.games}
                  teamId={teamId}
                  loading={loadingStats}
                />
              </section>
            )}

            {/* Next 5 Games Table */}
            <section>
              <UpcomingGames
                games={upcomingGames}
                teamId={teamId}
                loading={loadingUpcoming}
              />
            </section>

            {/* Placeholder for Future Team-Based Content */}
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

          {/* AI Insights Sidebar */}
          <aside className="w-full xl:w-80 shrink-0">
            <div className="sticky top-20">
              {loadingInsights ? (
                <AIInsightPanelSkeleton />
              ) : (
                <AIInsightPanel insights={insights} />
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
