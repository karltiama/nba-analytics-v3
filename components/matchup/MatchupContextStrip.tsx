import type { MatchupGameContext } from '@/lib/pregame-matchup/compose';

const STATUS_STYLE: Record<string, string> = {
  Out: 'border-[#F2C9C4] bg-[#FDF3F2] text-[#8A2A1F]',
  Doubtful: 'border-[#F3DDB5] bg-[#FDF8EE] text-[#7A4B05]',
  Q: 'border-[#DCE9EA] bg-[#F8FBFA] text-[#4a6366]',
};

function TeamInjuries({ team }: { team: NonNullable<MatchupGameContext['injuries']['teams']>[number] }) {
  return (
    <div className="min-w-0" data-injury-team={team.abbr}>
      <div className="type-metadata">{team.abbr}</div>
      {team.players.length === 0 ? (
        <p className="type-secondary mt-1">No key injuries listed</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {team.players.map((player) => (
            <li
              key={player.name}
              className={`type-badge inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${STATUS_STYLE[player.status] ?? STATUS_STYLE.Q}`}
            >
              <span className="text-[#063f46]">{player.name}</span>
              <span>· {player.status === 'Q' ? 'Questionable' : player.status}</span>
            </li>
          ))}
          {team.extra > 0 ? <li className="type-secondary self-center">+{team.extra} more</li> : null}
        </ul>
      )}
    </div>
  );
}

/** Rest and key injuries for tonight. Same lines as the Today's Games card; no new reads or rules. */
export function MatchupContextStrip({ context }: { context: MatchupGameContext }) {
  const { injuries, schedule } = context;
  return (
    <section
      id="section-tonight"
      className="mx-auto w-full max-w-[65rem] overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm"
      style={{ scrollMarginTop: 'var(--matchup-scroll-offset, 9rem)' }}
      aria-labelledby="matchup-tonight-heading"
      data-injuries={injuries.status}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
        <h2 id="matchup-tonight-heading" className="type-section-heading text-[#063f46]">
          Tonight
        </h2>
        {injuries.asOfLabel ? <span className="type-metadata">{injuries.asOfLabel}</span> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-6">
        <div className="min-w-0">
          <h3 className="type-secondary">Rest</h3>
          <p className="type-body mt-1 text-pretty text-[#063f46]">{schedule ?? 'Schedule context unavailable.'}</p>
        </div>
        <div className="min-w-0">
          <h3 className="type-secondary">Key injuries</h3>
          {injuries.teams && injuries.status !== 'unavailable' ? (
            <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {injuries.teams.map((team) => (
                <TeamInjuries key={team.abbr} team={team} />
              ))}
            </div>
          ) : (
            <p className="type-body mt-1 text-[#063f46]">{injuries.text}</p>
          )}
        </div>
      </div>
    </section>
  );
}
