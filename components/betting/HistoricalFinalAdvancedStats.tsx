'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { playerResearchHref } from '@/lib/betting/research-journey';
import type { HistoricalBoxPlayer } from '@/lib/betting/historical-final';
import {
  ADVANCED_METRIC_HELP,
  formatAdvancedRow,
} from '@/lib/betting/historical-advanced-format';

function MetricAbbr({
  metric,
}: {
  metric: (typeof ADVANCED_METRIC_HELP)[keyof typeof ADVANCED_METRIC_HELP];
}) {
  return (
    <abbr
      className="no-underline cursor-help"
      title={metric.help}
      aria-label={`${metric.label}. ${metric.help}`}
    >
      {metric.abbr}
    </abbr>
  );
}

function SecondaryMetrics({ row }: { row: ReturnType<typeof formatAdvancedRow> }) {
  return (
    <dl className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-1.5 text-[11px]">
      {(
        [
          ['ast', row.ast],
          ['reb', row.reb],
          ['tov', row.tov],
          ['pie', row.pie],
          ['poss', row.poss],
          ['pace', row.pace],
        ] as const
      ).map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-muted-foreground">
            <MetricAbbr metric={ADVANCED_METRIC_HELP[key]} />
          </dt>
          <dd className="font-mono tabular-nums text-white">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlayerLink({
  row,
  gameId,
  date,
  season,
}: {
  row: HistoricalBoxPlayer;
  gameId: string;
  date?: string;
  season?: string;
}) {
  return (
    <Link
      href={playerResearchHref({
        playerId: row.playerId,
        gameId,
        date,
        season,
      })}
      className="text-white hover:text-[#00d4ff] font-medium truncate"
    >
      {row.playerName || 'Player'}
    </Link>
  );
}

function AdvancedTeamBlock({
  teamName,
  teamId,
  rows,
  gameId,
  date,
  season,
}: {
  teamName: string;
  teamId: string;
  rows: HistoricalBoxPlayer[];
  gameId: string;
  date?: string;
  season?: string;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  const toggle = (playerId: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  return (
    <div className="glass-card rounded-xl overflow-hidden border border-white/5 min-w-0">
      <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
        <Link href={`/teams/${teamId}`} className="text-sm font-semibold text-white hover:text-[#00d4ff]">
          {teamName}
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground p-4">No player logs for this team.</p>
      ) : (
        <>
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="px-3 py-2 font-medium">Player</th>
                  <th className="px-2 py-2 font-medium text-right">MIN</th>
                  <th className="px-2 py-2 font-medium text-right">
                    <MetricAbbr metric={ADVANCED_METRIC_HELP.usg} />
                  </th>
                  <th className="px-2 py-2 font-medium text-right">
                    <MetricAbbr metric={ADVANCED_METRIC_HELP.ts} />
                  </th>
                  <th className="px-2 py-2 font-medium text-right">
                    <MetricAbbr metric={ADVANCED_METRIC_HELP.efg} />
                  </th>
                  <th className="px-2 py-2 font-medium text-right">
                    <MetricAbbr metric={ADVANCED_METRIC_HELP.ortg} />
                  </th>
                  <th className="px-2 py-2 font-medium text-right">
                    <MetricAbbr metric={ADVANCED_METRIC_HELP.drtg} />
                  </th>
                  <th className="px-2 py-2 font-medium text-right">
                    <MetricAbbr metric={ADVANCED_METRIC_HELP.net} />
                  </th>
                  <th className="px-2 py-2 font-medium text-right">
                    <span className="sr-only">More this-game Advanced metrics</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const formatted = formatAdvancedRow(row.advanced);
                  const open = openIds.has(row.playerId);
                  const rowKey = `${row.teamId}-${row.playerId}`;
                  return (
                    <Fragment key={rowKey}>
                      <tr className="border-t border-white/5">
                        <td className="px-3 py-1.5 max-w-[10rem]">
                          <PlayerLink row={row} gameId={gameId} date={date} season={season} />
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                          {row.minutes ?? '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-white">
                          {formatted.usg}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-white">
                          {formatted.ts}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-white">
                          {formatted.efg}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-white">
                          {formatted.ortg}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-white">
                          {formatted.drtg}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-white">
                          {formatted.net}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button
                            type="button"
                            className="text-[11px] text-[#00d4ff] hover:underline"
                            aria-expanded={open}
                            aria-controls={`adv-more-${row.playerId}`}
                            onClick={() => toggle(row.playerId)}
                          >
                            {open ? 'Less' : 'More'}
                          </button>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-t border-white/5 bg-white/[0.02]">
                          <td colSpan={9} className="px-3 py-2" id={`adv-more-${row.playerId}`}>
                            <SecondaryMetrics row={formatted} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="lg:hidden divide-y divide-white/5">
            {rows.map((row) => {
              const formatted = formatAdvancedRow(row.advanced);
              const open = openIds.has(row.playerId);
              return (
                <li key={`${row.teamId}-${row.playerId}`} className="px-3 py-2.5 space-y-2">
                  <div className="flex items-baseline justify-between gap-2 min-w-0">
                    <PlayerLink row={row} gameId={gameId} date={date} season={season} />
                    <span className="shrink-0 text-[11px] font-mono tabular-nums text-muted-foreground">
                      {row.minutes ?? '—'} MIN
                      {formatted.poss !== '—' ? ` · ${formatted.poss} poss` : ''}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ['usg', formatted.usg],
                        ['ts', formatted.ts],
                        ['efg', formatted.efg],
                        ['ortg', formatted.ortg],
                        ['drtg', formatted.drtg],
                        ['net', formatted.net],
                      ] as const
                    ).map(([key, value]) => (
                      <div key={key} className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          <MetricAbbr metric={ADVANCED_METRIC_HELP[key]} />
                        </div>
                        <div className="text-sm font-mono tabular-nums text-white">{value}</div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="text-[11px] text-[#00d4ff] hover:underline"
                    aria-expanded={open}
                    onClick={() => toggle(row.playerId)}
                  >
                    {open ? 'Hide AST%, REB%, TOV, PIE, Poss, Pace' : 'More this-game metrics'}
                  </button>
                  {open ? <SecondaryMetrics row={formatted} /> : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export function HistoricalFinalAdvancedStats({
  awayName,
  awayTeamId,
  homeName,
  homeTeamId,
  away,
  home,
  gameId,
  date,
  season,
}: {
  awayName: string;
  awayTeamId: string;
  homeName: string;
  homeTeamId: string;
  away: HistoricalBoxPlayer[];
  home: HistoricalBoxPlayer[];
  gameId: string;
  date?: string;
  season?: string;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <AdvancedTeamBlock
        teamName={awayName}
        teamId={awayTeamId}
        rows={away}
        gameId={gameId}
        date={date}
        season={season}
      />
      <AdvancedTeamBlock
        teamName={homeName}
        teamId={homeTeamId}
        rows={home}
        gameId={gameId}
        date={date}
        season={season}
      />
    </div>
  );
}
