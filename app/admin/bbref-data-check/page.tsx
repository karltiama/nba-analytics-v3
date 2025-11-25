'use client';

import { useEffect, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Link from 'next/link';

interface TeamData {
  team_id: string;
  abbreviation: string;
  full_name: string;
  total_games: number;
  games_with_player_stats: number;
  games_with_team_stats: number;
  games_with_scores: number;
  earliest_game_date: string | null;
  latest_game_date: string | null;
  player_stats_count: number;
  team_stats_count: number;
  coverage_pct: number;
  missing_stats_count: number;
}

interface Summary {
  total_teams: number;
  total_games: number;
  games_with_player_stats: number;
  games_with_team_stats: number;
  games_with_scores: number;
  average_coverage: number;
  total_missing_stats: number;
}

interface Issues {
  teams_with_no_games: number;
  teams_with_low_coverage: number;
  teams_with_missing_stats: number;
}

export default function BBRefDataCheckPage() {
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [issues, setIssues] = useState<Issues | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'coverage' | 'missing' | 'team'>('coverage');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/bbref-data-check');
      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }
      const data = await response.json();
      setTeams(data.teams);
      setSummary(data.summary);
      setIssues(data.issues);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const sortedTeams = [...teams].sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'coverage') {
      comparison = a.coverage_pct - b.coverage_pct;
    } else if (sortBy === 'missing') {
      comparison = a.missing_stats_count - b.missing_stats_count;
    } else {
      comparison = a.abbreviation.localeCompare(b.abbreviation);
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const getCoverageColor = (coverage: number) => {
    if (coverage >= 80) return 'text-green-600 dark:text-green-400';
    if (coverage >= 50) return 'text-yellow-600 dark:text-yellow-400';
    if (coverage >= 25) return 'text-orange-600 dark:text-orange-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getCoverageBg = (coverage: number) => {
    if (coverage >= 80) return 'bg-green-100 dark:bg-green-900';
    if (coverage >= 50) return 'bg-yellow-100 dark:bg-yellow-900';
    if (coverage >= 25) return 'bg-orange-100 dark:bg-orange-900';
    return 'bg-red-100 dark:bg-red-900';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <p className="text-zinc-600 dark:text-zinc-400">Loading data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-lg p-4">
            <p className="text-red-800 dark:text-red-200">Error: {error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-black dark:text-zinc-50 mb-2">
              BBRef Data Check
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              Diagnose missing BBRef data across all teams
            </p>
          </div>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Refresh Data
          </button>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
              <div className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">Total Teams</div>
              <div className="text-3xl font-bold text-black dark:text-zinc-50">
                {summary.total_teams}
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
              <div className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">Total Games</div>
              <div className="text-3xl font-bold text-black dark:text-zinc-50">
                {summary.total_games.toLocaleString()}
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
              <div className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">Games with Stats</div>
              <div className="text-3xl font-bold text-black dark:text-zinc-50">
                {summary.games_with_team_stats.toLocaleString()}
              </div>
              <div className="text-sm text-zinc-500 mt-1">
                {summary.total_missing_stats.toLocaleString()} missing
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
              <div className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">Avg Coverage</div>
              <div className={`text-3xl font-bold ${getCoverageColor(summary.average_coverage)}`}>
                {summary.average_coverage}%
              </div>
            </div>
          </div>
        )}

        {/* Issues Alert */}
        {issues && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <h3 className="font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
              ⚠️ Data Issues Detected
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-medium">Teams with no games:</span>{' '}
                <span className="text-red-600 dark:text-red-400">{issues.teams_with_no_games}</span>
              </div>
              <div>
                <span className="font-medium">Teams with low coverage (&lt;50%):</span>{' '}
                <span className="text-orange-600 dark:text-orange-400">
                  {issues.teams_with_low_coverage}
                </span>
              </div>
              <div>
                <span className="font-medium">Teams with missing stats:</span>{' '}
                <span className="text-yellow-600 dark:text-yellow-400">
                  {issues.teams_with_missing_stats}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Sort Controls */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-1 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
            >
              <option value="coverage">Coverage %</option>
              <option value="missing">Missing Stats</option>
              <option value="team">Team Name</option>
            </select>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="px-3 py-1 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-black dark:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-700"
            >
              {sortOrder === 'asc' ? '↑ Asc' : '↓ Desc'}
            </button>
          </div>
        </div>

        {/* Teams Table */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Total Games</TableHead>
                  <TableHead className="text-right">Player Stats</TableHead>
                  <TableHead className="text-right">Team Stats</TableHead>
                  <TableHead className="text-right">Coverage</TableHead>
                  <TableHead className="text-right">Missing</TableHead>
                  <TableHead className="text-right">Scores</TableHead>
                  <TableHead>Date Range</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTeams.map((team) => (
                  <TableRow key={team.team_id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/teams/${team.team_id}`}
                        className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                      >
                        {team.abbreviation}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{team.total_games}</TableCell>
                    <TableCell className="text-right">{team.games_with_player_stats}</TableCell>
                    <TableCell className="text-right">{team.games_with_team_stats}</TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${getCoverageBg(
                          team.coverage_pct
                        )} ${getCoverageColor(team.coverage_pct)}`}
                      >
                        {team.coverage_pct}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {team.missing_stats_count > 0 ? (
                        <span className="text-red-600 dark:text-red-400 font-medium">
                          {team.missing_stats_count}
                        </span>
                      ) : (
                        <span className="text-zinc-400">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{team.games_with_scores}</TableCell>
                    <TableCell className="text-sm text-zinc-600 dark:text-zinc-400">
                      {team.earliest_game_date && team.latest_game_date ? (
                        <>
                          {team.earliest_game_date} to {team.latest_game_date}
                        </>
                      ) : (
                        'No games'
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/teams/${team.team_id}`}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        View →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          <p>Last updated: {new Date().toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}

