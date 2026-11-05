import Link from 'next/link';
import type { GameRecap as GameRecapModel, RecapStarter } from '@/lib/pregame-matchup/recap';
import { MatchupSection } from '@/components/matchup/MatchupSection';
import { playerPageHref } from '@/lib/pregame-matchup/href';

function Names({ players }: { players: RecapStarter[] }) {
  return (
    <>
      {players.map((p, i) => (
        <span key={p.playerId}>
          {i > 0 ? ', ' : null}
          <Link href={playerPageHref(p.playerId)} className="hover:text-[#075B5C] hover:underline">
            {p.name}
          </Link>
        </span>
      ))}
    </>
  );
}

/** Final games: the result against the closing line, then who started against each team's previous five. */
export function GameRecap({ recap, flow = false }: { recap: GameRecapModel; flow?: boolean }) {
  return (
    <MatchupSection id="section-recap" headingId="game-recap" title="Game recap" aside="Final" flow={flow} data-game-recap>
      <p className="type-body font-semibold text-[#063f46]" data-recap-headline>
        {recap.headline}
      </p>

      <div className="mt-4">
        <h3 className="type-interactive text-[#063f46]">Against the closing line</h3>
        {recap.market.length > 0 ? (
          <>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5" data-recap-market>
              {recap.market.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="type-metadata pt-0.5">{row.label}</dt>
                  <dd className="type-secondary text-[#063f46]">{row.text}</dd>
                </div>
              ))}
            </dl>
            {recap.marketCaption ? <p className="type-metadata mt-2">{recap.marketCaption}</p> : null}
          </>
        ) : (
          <p className="type-secondary mt-2">{recap.marketNote}</p>
        )}
      </div>

      {recap.starters ? (
        <div className="mt-5">
          <h3 className="type-interactive text-[#063f46]">Who started</h3>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {recap.starters.map((team) => (
              <li key={team.abbr} className="rounded-xl border border-[#DCE9EA] bg-[#F8FBFA] p-3" data-recap-starters={team.abbr}>
                <p className="type-interactive text-[#063f46]">{team.abbr}</p>
                <p className="type-secondary mt-1 text-[#063f46]">
                  <Names players={team.actual} />
                </p>
                <p className="type-metadata mt-1">{team.summary}</p>
                {team.in.length > 0 ? (
                  <p className="type-metadata mt-0.5 text-[#7A4B05]">
                    New in the five: <Names players={team.in} />
                    {team.out.length > 0 ? (
                      <>
                        {' '}
                        · Dropped: <Names players={team.out} />
                      </>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </MatchupSection>
  );
}
