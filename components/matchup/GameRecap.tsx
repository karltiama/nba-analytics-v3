import Link from 'next/link';
import type { GameRecap as GameRecapModel, RecapBoxLine, RecapStarter, RecapTeam } from '@/lib/pregame-matchup/recap';
import { MatchupSection } from '@/components/matchup/MatchupSection';
import { playerPageHref } from '@/lib/pregame-matchup/href';

function PlayerLink({ p }: { p: RecapStarter }) {
  return (
    <Link href={playerPageHref(p.playerId)} className="hover:text-[#075B5C] hover:underline">
      {p.name}
    </Link>
  );
}

function Names({ players }: { players: RecapStarter[] }) {
  return (
    <>
      {players.map((p, i) => (
        <span key={p.playerId}>
          {i > 0 ? ', ' : null}
          <PlayerLink p={p} />
        </span>
      ))}
    </>
  );
}

const STAT_COLUMNS: { key: keyof RecapBoxLine; label: string; title: string }[] = [
  { key: 'min', label: 'MIN', title: 'Minutes' },
  { key: 'pts', label: 'PTS', title: 'Points' },
  { key: 'reb', label: 'REB', title: 'Rebounds' },
  { key: 'ast', label: 'AST', title: 'Assists' },
  { key: 'fg', label: 'FG', title: 'Field goals made-attempted' },
  { key: 'tp', label: '3PT', title: 'Threes made-attempted' },
  { key: 'ft', label: 'FT', title: 'Free throws made-attempted' },
  { key: 'stl', label: 'STL', title: 'Steals' },
  { key: 'blk', label: 'BLK', title: 'Blocks' },
  { key: 'tov', label: 'TO', title: 'Turnovers' },
  { key: 'pm', label: '+/-', title: 'Plus-minus' },
];

const CELL = 'whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums';

function statText(line: RecapBoxLine, key: keyof RecapBoxLine): string {
  const v = line[key];
  if (key === 'pm') return v == null ? '—' : (v as number) > 0 ? `+${v}` : String(v);
  return v == null ? '—' : String(v);
}

function PlayerRow({ line }: { line: RecapBoxLine }) {
  return (
    <tr className="border-t border-[#DCE9EA]" data-box-player={line.playerId} data-starter={line.starter ? 'true' : undefined}>
      <td className="sticky left-0 bg-white px-3 py-1.5">
        <PlayerLink p={line} />
      </td>
      {STAT_COLUMNS.map((c) => (
        <td key={c.key} className={`${CELL}${c.key === 'pts' ? ' font-semibold' : ''}`}>
          {statText(line, c.key)}
        </td>
      ))}
    </tr>
  );
}

function GroupRow({ label }: { label: string }) {
  return (
    <tr className="border-t border-[#DCE9EA] bg-[#F8FBFA]">
      <td colSpan={STAT_COLUMNS.length + 1} className="type-metadata px-3 py-1">
        {label}
      </td>
    </tr>
  );
}

function TeamBox({ team }: { team: RecapTeam }) {
  const starters = team.players.filter((p) => p.starter);
  const bench = team.players.filter((p) => !p.starter && !p.dnp);
  const dnp = team.players.filter((p) => p.dnp);
  const totals = team.totals;
  return (
    <div className="min-w-0" data-recap-team={team.abbr}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="type-interactive text-[#063f46]">{team.name}</h3>
        {team.starters ? <span className="type-metadata">{team.starters.summary}</span> : null}
      </div>
      {team.starters && team.starters.in.length > 0 ? (
        <p className="type-metadata mb-2 text-[#7A4B05]" data-recap-lineup-change>
          New in the five: <Names players={team.starters.in} />
          {team.starters.out.length > 0 ? (
            <>
              {' '}
              · Dropped: <Names players={team.starters.out} />
            </>
          ) : null}
        </p>
      ) : null}
      {team.players.length === 0 ? (
        <p className="type-secondary">Box score not loaded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#DCE9EA]">
          <table className="w-full min-w-[40rem]">
            <thead className="type-metadata">
              <tr className="text-left text-[#4a6366]">
                <th className="sticky left-0 bg-white px-3 py-2 font-medium">Player</th>
                {STAT_COLUMNS.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right font-medium" title={c.title}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="type-table-data text-[#063f46]">
              {starters.length > 0 ? <GroupRow label="Starters" /> : null}
              {starters.map((line) => (
                <PlayerRow key={line.playerId} line={line} />
              ))}
              {bench.length > 0 ? <GroupRow label={starters.length > 0 ? 'Bench' : 'Players'} /> : null}
              {bench.map((line) => (
                <PlayerRow key={line.playerId} line={line} />
              ))}
              {totals ? (
                <tr className="border-t-2 border-[#DCE9EA] font-semibold" data-box-totals>
                  <td className="sticky left-0 bg-white px-3 py-1.5">Team</td>
                  {STAT_COLUMNS.map((c) => (
                    <td key={c.key} className={CELL}>
                      {c.key === 'min' || c.key === 'pm' ? '' : String(totals[c.key as keyof typeof totals])}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {dnp.length > 0 ? (
        <p className="type-metadata mt-1.5" data-recap-dnp>
          Did not play: <Names players={dnp} />
        </p>
      ) : null}
    </div>
  );
}

/** Final games: the result against the closing line, then each team's box score with its starters. */
export function GameRecap({ recap, flow = false }: { recap: GameRecapModel; flow?: boolean }) {
  return (
    <MatchupSection id="section-recap" headingId="game-recap" title="Game recap" aside={recap.headline} flow={flow} data-game-recap>
      <div>
        <h3 className="type-interactive text-[#063f46]">Against the closing line</h3>
        {recap.market.length > 0 ? (
          <>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2" data-recap-market>
              {recap.market.map((row) => (
                <li key={row.label} className="rounded-xl border border-[#DCE9EA] bg-[#F8FBFA] p-3" data-recap-tile={row.label}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="type-metadata">{row.label}</span>
                    <span className="type-badge rounded-full border border-[#DCE9EA] bg-white px-2 py-0.5 text-[#063f46]">{row.chip}</span>
                  </div>
                  <p className="type-secondary mt-1.5 text-[#063f46]">{row.text}</p>
                </li>
              ))}
            </ul>
            {recap.marketCaption ? <p className="type-metadata mt-2">{recap.marketCaption}</p> : null}
          </>
        ) : (
          <p className="type-secondary mt-2">{recap.marketNote}</p>
        )}
      </div>

      <div id="section-box" className="mt-6 space-y-6" style={{ scrollMarginTop: 'var(--matchup-scroll-offset, 9rem)' }} data-recap-box>
        {recap.teams.map((team) => (
          <TeamBox key={team.teamId} team={team} />
        ))}
      </div>
    </MatchupSection>
  );
}
