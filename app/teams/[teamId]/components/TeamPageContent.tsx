'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { TeamInfo, TeamGameStats, TeamSeasonAverages, TeamTrendPoint } from '@/lib/teams/types';
import { RecentGamesTable } from './RecentGamesTimeline';
import {
  TeamTrendChart,
  TIMEFRAME_OPTIONS,
  LOCATION_OPTIONS,
  METRIC_BUTTONS,
  getMetricLabel,
  type Timeframe,
  type LocationFilter,
  type TeamTrendMetric,
} from './TeamTrendChart';
import { TeamTrendLinePanel } from './TeamTrendLinePanel';

function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground uppercase">{label}</span>
      <span className="text-sm font-bold font-mono" style={color ? { color } : { color: 'white' }}>{value}</span>
    </div>
  );
}

interface TeamPageClientProps {
  team: TeamInfo;
  seasonAverages: TeamSeasonAverages | null;
  recentGames: TeamGameStats[];
  trendData: TeamTrendPoint[];
}

const buttonBase = 'rounded-lg text-xs font-medium transition-all';
const buttonActive = 'bg-[#bf5af2] text-white shadow-[0_0_12px_rgba(191,90,242,0.4)] font-semibold';
const buttonInactive = 'glass-card text-muted-foreground hover:text-white hover:bg-white/10';

export function TeamPageClient({ team, seasonAverages, recentGames, trendData }: TeamPageClientProps) {
  const [trendTimeframe, setTrendTimeframe] = useState<Timeframe>(20);
  const [trendLocation, setTrendLocation] = useState<LocationFilter>('all');
  const [trendMetric, setTrendMetric] = useState<TeamTrendMetric>('team_total');
  const [bettingLine, setBettingLine] = useState<number | null>(null);

  const wins = seasonAverages?.wins ?? 0;
  const losses = seasonAverages?.losses ?? 0;
  const winPct = seasonAverages?.win_pct != null ? (seasonAverages.win_pct * 100).toFixed(1) : '0.0';
  const ppg = seasonAverages?.avg_points != null ? seasonAverages.avg_points.toFixed(1) : null;
  const oppPpg = seasonAverages?.avg_points_allowed != null ? seasonAverages.avg_points_allowed.toFixed(1) : null;

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

  const byLocation =
    trendLocation === 'all'
      ? trendData
      : trendData.filter((g) => (trendLocation === 'home' ? g.is_home : !g.is_home));

  const filteredTrend =
    trendTimeframe === 'season' ? byLocation : byLocation.slice(-trendTimeframe);

  let chartData: number[];
  let chartSeasonAvg: number;
  const teamPpg = seasonAverages?.avg_points ?? 0;
  const teamOppPpg = seasonAverages?.avg_points_allowed ?? 0;

  if (trendMetric === 'team_total') {
    chartData = filteredTrend.map((g) => g.team_points);
    chartSeasonAvg = teamPpg || (chartData.length > 0 ? chartData.reduce((a, b) => a + b, 0) / chartData.length : 0);
  } else if (trendMetric === 'game_total') {
    chartData = filteredTrend.map((g) => g.team_points + (g.points_allowed ?? 0));
    chartSeasonAvg = teamPpg + teamOppPpg || (chartData.length > 0 ? chartData.reduce((a, b) => a + b, 0) / chartData.length : 0);
  } else if (trendMetric === 'spread') {
    chartData = filteredTrend.map((g) => g.team_points - (g.points_allowed ?? g.team_points));
    chartSeasonAvg = chartData.length > 0 ? chartData.reduce((a, b) => a + b, 0) / chartData.length : 0;
  } else {
    chartData = filteredTrend.map((g) => g.team_points);
    chartSeasonAvg = teamPpg || 0;
  }
  const chartLabels = filteredTrend.map((g) => g.opponent_abbr);
  const timeframeLabel =
    trendTimeframe === 'season' ? `${byLocation.length} games` : `last ${trendTimeframe} games`;
  const metricLabel = getMetricLabel(trendMetric);

  const gamesByLocation =
    trendLocation === 'all'
      ? recentGames
      : recentGames.filter((g) => (trendLocation === 'home' ? g.is_home : !g.is_home));
  const filteredGamesForTable =
    trendTimeframe === 'season' ? gamesByLocation : gamesByLocation.slice(0, trendTimeframe);
  const gameLogTitle =
    trendTimeframe === 'season'
      ? `Season (${filteredGamesForTable.length} games)`
      : `Last ${trendTimeframe} Games`;

  return (
    <>
      {/* Team header card */}
      <section className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#00d4ff] to-[#bf5af2] flex items-center justify-center border border-white/10">
              <span className="text-sm font-bold text-white">{team.abbreviation}</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-tight">{team.full_name}</h1>
              <p className="text-[10px] text-muted-foreground">
                {team.conference} • {team.division}
              </p>
            </div>
          </div>

          <div className="h-8 w-px bg-white/10 hidden md:block" />

          {seasonAverages && (
            <div className="flex items-center gap-4 flex-wrap">
              <StatPill label="Record" value={`${wins}-${losses}`} />
              <StatPill
                label="Win%"
                value={`${winPct}%`}
                color={parseFloat(winPct) >= 50 ? '#39ff14' : '#ff6b35'}
              />
              {ppg && <StatPill label="PPG" value={ppg} />}
              {oppPpg && <StatPill label="Opp PPG" value={oppPpg} />}
              {seasonAverages.avg_rebounds != null && (
                <StatPill label="RPG" value={seasonAverages.avg_rebounds.toFixed(1)} />
              )}
              {seasonAverages.avg_assists != null && (
                <StatPill label="APG" value={seasonAverages.avg_assists.toFixed(1)} />
              )}
              {(seasonAverages.home_wins > 0 || seasonAverages.home_losses > 0 || seasonAverages.away_wins > 0 || seasonAverages.away_losses > 0) && (
                <span className="text-[10px] text-muted-foreground">
                  Home: {seasonAverages.home_wins}-{seasonAverages.home_losses}
                  <span className="mx-1">·</span>
                  Away: {seasonAverages.away_wins}-{seasonAverages.away_losses}
                </span>
              )}
              {streakCount > 0 && streakType && (
                <span
                  className={`text-xs font-semibold px-2 py-1 rounded ${
                    streakType === 'W'
                      ? 'bg-[#39ff14]/20 text-[#39ff14]'
                      : 'bg-[#ff4757]/20 text-[#ff4757]'
                  }`}
                >
                  {streakCount}{streakType}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Team Trends: filters outside chart (match player page) */}
      {chartData.length > 0 && (
        <>
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Team Trends</h2>
                <p className="text-xs text-muted-foreground">
                  Performance breakdown across {timeframeLabel}
                </p>
              </div>
              <span className="text-[10px] px-2 py-1 bg-[#00d4ff]/20 text-[#00d4ff] rounded-full font-medium">
                {METRIC_BUTTONS.find((m) => m.value === trendMetric)?.label ?? metricLabel}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1.5">
                {TIMEFRAME_OPTIONS.map(({ value, label }) => (
                  <button
                    key={String(value)}
                    type="button"
                    onClick={() => setTrendTimeframe(value)}
                    className={cn(
                      'px-3 py-1.5',
                      buttonBase,
                      trendTimeframe === value ? buttonActive : buttonInactive
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="h-6 w-px bg-white/10 hidden sm:block" />
              <div className="flex gap-1.5">
                {LOCATION_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTrendLocation(value)}
                    className={cn(
                      'px-3 py-1.5',
                      buttonBase,
                      trendLocation === value ? buttonActive : buttonInactive
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="h-6 w-px bg-white/10 hidden sm:block" />
              <div className="flex flex-wrap gap-2">
                {METRIC_BUTTONS.map(({ value, label, disabled }) => (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (!disabled) {
                        setTrendMetric(value);
                        setBettingLine(null);
                      }
                    }}
                    title={disabled ? 'Coming soon' : undefined}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                      disabled && 'opacity-50 cursor-not-allowed',
                      !disabled && trendMetric === value
                        ? 'bg-[#00d4ff] text-black shadow-[0_0_16px_rgba(0,212,255,0.5)] font-semibold'
                        : !disabled && 'glass-card text-muted-foreground hover:text-white hover:bg-white/10'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="slide-up" style={{ animationDelay: '50ms' }}>
            <TeamTrendChart
              data={chartData}
              seasonAvg={chartSeasonAvg}
              labels={chartLabels}
              metricLabel={metricLabel}
              bettingLine={bettingLine}
            >
              <TeamTrendLinePanel
                values={chartData}
                bettingLine={bettingLine}
                onLineChange={setBettingLine}
                lineLabel={metricLabel === 'pts' ? 'Team total' : metricLabel === 'total pts' ? 'Game total' : 'Line'}
              />
            </TeamTrendChart>
          </section>
        </>
      )}

      {/* Game log — follows timeframe + location filter (same as player page) */}
      {recentGames.length > 0 && (
        <section className="slide-up" style={{ animationDelay: '150ms' }}>
          <RecentGamesTable
            games={filteredGamesForTable}
            teamId={team.team_id}
            title={gameLogTitle}
          />
        </section>
      )}

      {/* Advanced metrics */}
      {seasonAverages && (
        <section className="slide-up" style={{ animationDelay: '100ms' }}>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white">Advanced metrics</h2>
            <p className="text-xs text-muted-foreground">
              Season averages (Offensive/Defensive Rating, Pace, eFG%, TOV%, ORB%)
            </p>
          </div>
          <div className="glass-card rounded-xl p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">Off. rating</div>
                <div className="text-lg font-bold font-mono text-white">
                  {seasonAverages.avg_offensive_rating != null
                    ? seasonAverages.avg_offensive_rating.toFixed(1)
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">Def. rating</div>
                <div className="text-lg font-bold font-mono text-white">
                  {seasonAverages.avg_defensive_rating != null
                    ? seasonAverages.avg_defensive_rating.toFixed(1)
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">Pace</div>
                <div className="text-lg font-bold font-mono text-white">
                  {seasonAverages.avg_pace != null
                    ? seasonAverages.avg_pace.toFixed(1)
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">eFG%</div>
                <div className="text-lg font-bold font-mono text-white">
                  {seasonAverages.avg_efg_pct != null
                    ? (seasonAverages.avg_efg_pct * 100).toFixed(1) + '%'
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">TOV%</div>
                <div className="text-lg font-bold font-mono text-white">
                  {seasonAverages.avg_tov_pct != null
                    ? (seasonAverages.avg_tov_pct * 100).toFixed(1) + '%'
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">ORB%</div>
                <div className="text-lg font-bold font-mono text-white">
                  {seasonAverages.avg_orb_pct != null
                    ? (seasonAverages.avg_orb_pct * 100).toFixed(1) + '%'
                    : '—'}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Placeholder for future sections */}
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
            AI insights, upcoming games, and matchup analysis
          </p>
        </div>
      </section>
    </>
  );
}
