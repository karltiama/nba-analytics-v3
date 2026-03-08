'use client';

import type { PlayerVsOpponentHistory } from '@/lib/players/types';
import type { GameLog } from '@/lib/players/types';

function fmt(value: number): string {
  return value.toFixed(1);
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fgLine(made: number | null, attempted: number | null): string {
  if (made == null || attempted == null) return '—';
  return `${made}-${attempted}`;
}

export interface PlayerVsOpponentHistoryCardProps {
  vsOpponentHistory: PlayerVsOpponentHistory | null;
  opponentAbbr: string | null;
}

export function PlayerVsOpponentHistoryCard({
  vsOpponentHistory,
  opponentAbbr,
}: PlayerVsOpponentHistoryCardProps) {
  const abbr = opponentAbbr ?? 'opponent';

  if (!vsOpponentHistory) {
    return (
      <section className="glass-card rounded-xl p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Vs {abbr} History
        </h3>
        <p className="text-muted-foreground">No next game to compare.</p>
      </section>
    );
  }

  if (vsOpponentHistory.games_played === 0) {
    return (
      <section className="glass-card rounded-xl p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Vs {abbr} History
        </h3>
        <p className="text-muted-foreground">No games vs this opponent this season.</p>
      </section>
    );
  }

  const sampleNote =
    vsOpponentHistory.games_played < 2
      ? 'Sample too small'
      : `${vsOpponentHistory.games_played} game${vsOpponentHistory.games_played !== 1 ? 's' : ''} vs ${abbr}`;

  const games = vsOpponentHistory.games ?? [];

  return (
    <section className="glass-card rounded-xl p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Vs {abbr} History
      </h3>
      <p className="text-sm text-muted-foreground mb-3">{sampleNote}</p>

      {/* Averages row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase">PTS</div>
          <div className="text-lg font-bold font-mono text-white">
            {fmt(vsOpponentHistory.avg_pts)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase">REB</div>
          <div className="text-lg font-bold font-mono text-white">
            {fmt(vsOpponentHistory.avg_reb)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase">AST</div>
          <div className="text-lg font-bold font-mono text-white">
            {fmt(vsOpponentHistory.avg_ast)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase">PRA</div>
          <div className="text-lg font-bold font-mono text-white">
            {fmt(vsOpponentHistory.avg_pra)}
          </div>
        </div>
      </div>

      {/* Game log table */}
      {games.length > 0 && (
        <div className="border-t border-white/10 pt-3">
          <p className="text-[10px] text-muted-foreground uppercase mb-2">Game Log</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-muted-foreground uppercase">
                  <th className="text-left pr-3 pb-1.5 font-medium">Date</th>
                  <th className="text-center px-2 pb-1.5 font-medium">W/L</th>
                  <th className="text-center px-2 pb-1.5 font-medium">Score</th>
                  <th className="text-center px-2 pb-1.5 font-medium">MIN</th>
                  <th className="text-center px-2 pb-1.5 font-medium">PTS</th>
                  <th className="text-center px-2 pb-1.5 font-medium">REB</th>
                  <th className="text-center px-2 pb-1.5 font-medium">AST</th>
                  <th className="text-center px-2 pb-1.5 font-medium">STL</th>
                  <th className="text-center px-2 pb-1.5 font-medium">BLK</th>
                  <th className="text-center px-2 pb-1.5 font-medium">TO</th>
                  <th className="text-center px-2 pb-1.5 font-medium">FG</th>
                  <th className="text-center px-2 pb-1.5 font-medium">3PT</th>
                  <th className="text-center pl-2 pb-1.5 font-medium">+/-</th>
                </tr>
              </thead>
              <tbody>
                {games.map((g: GameLog) => (
                  <GameRow key={g.game_id} game={g} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function GameRow({ game }: { game: GameLog }) {
  const score =
    game.team_score != null && game.opponent_score != null
      ? `${game.team_score}-${game.opponent_score}`
      : '—';

  return (
    <tr className="border-t border-white/5">
      <td className="text-left pr-3 py-1.5 text-muted-foreground whitespace-nowrap">
        {formatDate(game.start_time || game.game_date)}
      </td>
      <td className="text-center px-2 py-1.5">
        <span
          className={
            game.result === 'W'
              ? 'text-[#39ff14] font-semibold'
              : game.result === 'L'
                ? 'text-red-400 font-semibold'
                : 'text-muted-foreground'
          }
        >
          {game.result ?? '—'}
        </span>
      </td>
      <td className="text-center px-2 py-1.5 text-muted-foreground whitespace-nowrap">{score}</td>
      <td className="text-center px-2 py-1.5 font-mono text-white">
        {game.minutes != null ? Math.round(game.minutes) : '—'}
      </td>
      <td className="text-center px-2 py-1.5 font-mono font-bold text-[#00d4ff]">
        {game.points ?? '—'}
      </td>
      <td className="text-center px-2 py-1.5 font-mono text-white">{game.rebounds ?? '—'}</td>
      <td className="text-center px-2 py-1.5 font-mono text-white">{game.assists ?? '—'}</td>
      <td className="text-center px-2 py-1.5 font-mono text-white">{game.steals ?? '—'}</td>
      <td className="text-center px-2 py-1.5 font-mono text-white">{game.blocks ?? '—'}</td>
      <td className="text-center px-2 py-1.5 font-mono text-white">{game.turnovers ?? '—'}</td>
      <td className="text-center px-2 py-1.5 font-mono text-muted-foreground whitespace-nowrap">
        {fgLine(game.field_goals_made, game.field_goals_attempted)}
      </td>
      <td className="text-center px-2 py-1.5 font-mono text-muted-foreground whitespace-nowrap">
        {fgLine(game.three_pointers_made, game.three_pointers_attempted)}
      </td>
      <td className="text-center pl-2 py-1.5 font-mono text-white">
        {game.plus_minus != null ? (game.plus_minus > 0 ? `+${game.plus_minus}` : game.plus_minus) : '—'}
      </td>
    </tr>
  );
}
