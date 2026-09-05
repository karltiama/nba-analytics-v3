'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { TeamInfo, TeamGameStats, TeamSeasonAverages, TeamTrendPoint } from '@/lib/teams/types';
import type { CompactScheduleGame } from '@/lib/teams/team-compact-schedule';
import type { TeamSeasonSnapshot } from '@/lib/teams/team-season-snapshot';
import type { TeamRosterContinuity } from '@/lib/teams/team-roster-continuity';
import type { PreviousSeasonBaseline } from '@/lib/teams/team-previous-season-baseline';
import type { RosterChangeStory } from '@/lib/teams/roster-change-story';
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
import { TeamSeasonSwitcher } from './TeamSeasonSwitcher';
import { TeamCompactSchedule } from './TeamCompactSchedule';
import { TeamSeasonSnapshotPanel } from './TeamSeasonSnapshotPanel';
import type { TeamPageSeasonChoice } from '@/lib/teams/team-page-season';

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
  /** Analytics start-year (queries already scoped to this). */
  season: string;
  /** User-facing label e.g. "2025–26". */
  seasonLabel: string;
  seasonAverages: TeamSeasonAverages | null;
  recentGames: TeamGameStats[];
  trendData: TeamTrendPoint[];
  upcomingGames: CompactScheduleGame[];
  recentScheduleGames: CompactScheduleGame[];
  seasonSnapshot: TeamSeasonSnapshot;
  rosterContinuity: TeamRosterContinuity;
  rosterChangeStory: RosterChangeStory;
  previousBaseline: PreviousSeasonBaseline;
  seasonChoices: TeamPageSeasonChoice[];
  defaultSeason: string;
  /** Route param team id (for season switcher links). */
  routeTeamId: string;
  /** Roster — after snapshot on mobile; sticky right column on xl. */
  roster: ReactNode;
}

const buttonBase = 'rounded-lg text-xs font-medium transition-all';
const buttonActive = 'bg-[#bf5af2] text-white shadow-[0_0_12px_rgba(191,90,242,0.4)] font-semibold';
const buttonInactive = 'glass-card text-muted-foreground hover:text-white hover:bg-white/10';

export function TeamPageClient({
  team,
  season,
  seasonLabel,
  seasonAverages,
  recentGames,
  trendData,
  upcomingGames,
  recentScheduleGames,
  seasonSnapshot,
  rosterContinuity,
  rosterChangeStory,
  previousBaseline,
  seasonChoices,
  defaultSeason,
  routeTeamId,
  roster,
}: TeamPageClientProps) {
  const [trendTimeframe, setTrendTimeframe] = useState<Timeframe>(20);
  const [trendLocation, setTrendLocation] = useState<LocationFilter>('all');
  const [trendMetric, setTrendMetric] = useState<TeamTrendMetric>('team_total');
  const [bettingLine, setBettingLine] = useState<number | null>(null);

  const wins = seasonAverages?.wins ?? 0;
  const losses = seasonAverages?.losses ?? 0;
  const winPct = seasonAverages?.win_pct != null ? (seasonAverages.win_pct * 100).toFixed(1) : '0.0';
  const ppg = seasonAverages?.avg_points != null ? seasonAverages.avg_points.toFixed(1) : null;

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

  const hasFourFactors =
    !!seasonAverages &&
    (seasonAverages.avg_efg_pct != null ||
      seasonAverages.avg_tov_pct != null ||
      seasonAverages.avg_orb_pct != null);

  return (
    <>
      <div className="space-y-6 min-w-0 xl:col-start-1">
        <section className="glass-card rounded-xl p-4" data-analytics-season={season}>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3 shrink-0 min-w-0">
              <div className="w-11 h-11 shrink-0 rounded-lg bg-gradient-to-br from-[#00d4ff] to-[#bf5af2] flex items-center justify-center border border-white/10">
                <span className="text-sm font-bold text-white">{team.abbreviation}</span>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg font-bold text-white leading-tight truncate">
                    {team.full_name}
                  </h1>
                  <TeamSeasonSwitcher
                    teamId={routeTeamId}
                    currentSeason={season}
                    defaultSeason={defaultSeason}
                    choices={seasonChoices}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {team.conference} • {team.division}
                  <span className="mx-1.5 text-white/20">·</span>
                  {seasonLabel}
                </p>
              </div>
            </div>

            {seasonAverages && seasonAverages.games_played > 0 && (
              <>
                <div className="h-8 w-px bg-white/10 hidden md:block" />
                <div className="flex items-center gap-4 flex-wrap">
                  <StatPill label="Record" value={`${wins}-${losses}`} />
                  <StatPill
                    label="Win%"
                    value={`${winPct}%`}
                    color={parseFloat(winPct) >= 50 ? '#39ff14' : '#ff6b35'}
                  />
                  {ppg && <StatPill label="PPG" value={ppg} />}
                  {streakCount > 0 && streakType && (
                    <span
                      className={`text-xs font-semibold px-2 py-1 rounded ${
                        streakType === 'W'
                          ? 'bg-[#39ff14]/20 text-[#39ff14]'
                          : 'bg-[#ff4757]/20 text-[#ff4757]'
                      }`}
                      title={`${streakCount}-game ${streakType === 'W' ? 'win' : 'losing'} streak`}
                    >
                      {streakCount}
                      {streakType}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        <TeamCompactSchedule
          routeTeamId={routeTeamId}
          season={season}
          seasonLabel={seasonLabel}
          upcoming={upcomingGames}
          recent={recentScheduleGames}
        />

        <TeamSeasonSnapshotPanel
          season={season}
          seasonLabel={seasonLabel}
          snapshot={seasonSnapshot}
          continuity={rosterContinuity}
          rosterChangeStory={rosterChangeStory}
          previousBaseline={previousBaseline}
        />
      </div>

      <aside className="min-w-0 xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:sticky xl:top-20 xl:self-start">
        {roster}
      </aside>

      <div className="space-y-6 min-w-0 xl:col-start-1">
        {chartData.length > 0 && (
          <>
            <section>
              <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
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
                  lineLabel={
                    metricLabel === 'pts'
                      ? 'Team total'
                      : metricLabel === 'total pts'
                        ? 'Game total'
                        : 'Line'
                  }
                />
              </TeamTrendChart>
            </section>
          </>
        )}

        {recentGames.length > 0 && (
          <section className="slide-up" style={{ animationDelay: '150ms' }}>
            <RecentGamesTable
              games={filteredGamesForTable}
              teamId={team.team_id}
              title={gameLogTitle}
            />
          </section>
        )}

        {hasFourFactors && seasonAverages && (
          <section className="slide-up" style={{ animationDelay: '100ms' }}>
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-white">Four Factors</h2>
              <p className="text-[10px] text-muted-foreground">
                {seasonLabel} · shooting, turnovers, offensive boards
              </p>
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase">eFG%</div>
                  <div className="text-base font-bold font-mono text-white">
                    {seasonAverages.avg_efg_pct != null
                      ? (seasonAverages.avg_efg_pct * 100).toFixed(1) + '%'
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase">TOV%</div>
                  <div className="text-base font-bold font-mono text-white">
                    {seasonAverages.avg_tov_pct != null
                      ? (seasonAverages.avg_tov_pct * 100).toFixed(1) + '%'
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase">ORB%</div>
                  <div className="text-base font-bold font-mono text-white">
                    {seasonAverages.avg_orb_pct != null
                      ? (seasonAverages.avg_orb_pct * 100).toFixed(1) + '%'
                      : '—'}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
