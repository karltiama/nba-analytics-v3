import type { MatchupGameContext } from '@/lib/pregame-matchup/compose';

const STATUS_STYLE: Record<string, string> = {
  Out: 'border-[#F2C9C4] bg-[#FDF3F2] text-[#8A2A1F]',
  Doubtful: 'border-[#F3DDB5] bg-[#FDF8EE] text-[#7A4B05]',
  Q: 'border-[#DCE9EA] bg-[#F8FBFA] text-[#4a6366]',
};

export const RAIL_CARD = 'min-w-0 overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm';
export const RAIL_HEADER = 'flex flex-wrap items-baseline justify-between gap-2 border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2';

function TeamInjuries({
  team,
  moreHref,
}: {
  team: NonNullable<MatchupGameContext['injuries']['teams']>[number];
  moreHref: string | null;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-2" data-injury-team={team.abbr}>
      <div className="type-metadata">{team.abbr}</div>
      {team.players.length === 0 ? (
        <p className="type-secondary">No key injuries listed</p>
      ) : (
        <ul className="flex min-w-0 flex-wrap gap-1.5">
          {team.players.map((player) => (
            <li
              key={player.name}
              className={`type-badge inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${STATUS_STYLE[player.status] ?? STATUS_STYLE.Q}`}
            >
              <span className="text-[#063f46]">{player.name}</span>
              <span>· {player.status === 'Q' ? 'Questionable' : player.status}</span>
            </li>
          ))}
          {team.extra > 0 ? (
            <li className="type-secondary self-center">
              {moreHref ? (
                <a href={moreHref} className="text-[#075B5C] hover:underline">
                  +{team.extra} more
                </a>
              ) : (
                <>+{team.extra} more</>
              )}
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

/** Rest and key injuries for tonight, sized for the sidebar. Same lines as the Today's Games card. */
export function MatchupContextStrip({
  context,
  moreHref = null,
}: {
  context: MatchupGameContext;
  /** Where "+N more" links: the full injury report on the page, when there is one. */
  moreHref?: string | null;
}) {
  const { injuries, schedule } = context;
  return (
    <section
      id="section-tonight"
      className={RAIL_CARD}
      style={{ scrollMarginTop: 'var(--matchup-scroll-offset, 9rem)' }}
      aria-labelledby="matchup-tonight-heading"
      data-injuries={injuries.status}
    >
      <div className={RAIL_HEADER}>
        <h2 id="matchup-tonight-heading" className="type-section-heading text-[#063f46]">
          Tonight
        </h2>
        {injuries.asOfLabel ? <span className="type-metadata">{injuries.asOfLabel}</span> : null}
      </div>
      <div className="space-y-3 p-3">
        <div className="min-w-0">
          <h3 className="type-secondary">Rest</h3>
          <p className="type-body mt-0.5 text-pretty text-[#063f46]">{schedule ?? 'Schedule context unavailable.'}</p>
        </div>
        <div className="min-w-0 border-t border-[#DCE9EA] pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="type-secondary">Key injuries</h3>
            {moreHref && injuries.status !== 'unavailable' ? (
              <a href={moreHref} className="type-metadata text-[#075B5C] hover:underline">
                Full report
              </a>
            ) : null}
          </div>
          {injuries.teams && injuries.status !== 'unavailable' ? (
            <div className="mt-1.5 space-y-2">
              {injuries.teams.map((team) => (
                <TeamInjuries key={team.abbr} team={team} moreHref={moreHref} />
              ))}
            </div>
          ) : (
            <p className="type-body mt-0.5 text-[#063f46]">{injuries.text}</p>
          )}
        </div>
      </div>
    </section>
  );
}
