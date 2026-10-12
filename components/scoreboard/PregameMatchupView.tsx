import Link from 'next/link';
import { TeamLogo } from '@/components/nba/TeamLogo';
import type { HistoricalContributor } from '@/lib/pregame-matchup/aggregate';
import type { PregameMatchupModel } from '@/lib/pregame-matchup/compose';
import { formatRosterObservationLabel, type TeamContinuity } from '@/lib/pregame-matchup/roster';
import type { MatchupInsight } from '@/lib/pregame-matchup/signals';

function TeamMark({ abbr, name }: { abbr: string; name: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
      <TeamLogo team={abbr} size="lg" decorative />
      <div className="min-w-0">
        <div className="type-metadata">{abbr}</div>
        <div className="type-card-data truncate text-[#063F46]">{name}</div>
      </div>
    </div>
  );
}

function ContributorList({ players }: { players: HistoricalContributor[] }) {
  if (players.length === 0) {
    return <p className="type-secondary">No positive-minute games in the 2025–26 regular season.</p>;
  }
  return (
    <ul className="space-y-3">
      {players.map((player) => (
        <li key={player.playerId} className="min-w-0">
          <div className="type-card-data truncate text-[#063F46]">{player.name}</div>
          <p className="type-secondary tabular-nums">
            {player.minutesPerGame.toFixed(1)} mpg · {player.pointsPerGame.toFixed(1)} ppg · {player.fgaPerGame.toFixed(1)} fga
            {player.usage != null ? ` · ${(player.usage * 100).toFixed(1)}% usg` : ''} · {player.games} gp
          </p>
        </li>
      ))}
    </ul>
  );
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function RosterTeam({ team, date, source }: { team: TeamContinuity; date: string; source?: 'balldontlie' }) {
  const minutes = team.minutesShare ?? 0;
  const fga = team.fgaShare ?? 0;
  const fta = team.ftaShare ?? 0;
  const label = source === 'balldontlie' ? formatRosterObservationLabel(date) : date;
  const listed = source === 'balldontlie'
    ? `Players listed by BALLDONTLIE for ${team.abbr} on ${label}`
    : `Players listed on the ${team.abbr} roster as of ${date}`;
  return (
    <div className="min-w-0">
      <h3 className="type-secondary mb-2">{team.abbr}</h3>
      <p className="type-body text-[#063F46]">
        {listed} accounted for {pct(minutes)} of the team&apos;s 2025–26 regular-season minutes ({Math.round(team.minutesNumerator)} of {Math.round(team.minutesDenominator)}) and {pct(fga)} of its field-goal attempts ({Math.round(team.fgaNumerator)} of {Math.round(team.fgaDenominator)}).
      </p>
      <p className="type-secondary mt-2">
        Historical production not represented among players on the roster observed as of {date}: {pct(1 - minutes)} of minutes and {pct(1 - fga)} of field-goal attempts. Free-throw attempts represented: {pct(fta)}.
      </p>
      <p className="type-secondary mt-2">
        Of the resolved players on that list, {team.returning} played for {team.abbr} in the 2025–26 regular season, {team.otherTeam} played only for another team, and {team.noPriorHistory} have no verified regular-season games in that window.
      </p>
      {team.concentration ? <p className="type-secondary mt-2">{team.concentration}</p> : null}
    </div>
  );
}

function Insight({ insight }: { insight: MatchupInsight }) {
  return (
    <article className="border-l-2 border-[#075B5C] pl-4">
      <h3 className="type-card-data text-[#063F46]">{insight.headline}</h3>
      <p className="type-body mt-1 text-[#063F46]">{insight.body}</p>
      <p className="type-secondary mt-2">{insight.evidence}</p>
      <p className="type-metadata mt-1">{insight.limitation}</p>
    </article>
  );
}

export function PregameMatchupView({ model }: { model: PregameMatchupModel }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link href={model.returnHref} className="type-interactive text-[#075B5C] hover:underline">
        Today&apos;s Games
      </Link>

      <header className="mt-5">
        <div className="flex items-center gap-3">
          <TeamMark abbr={model.awayAbbr} name={model.awayName} />
          <div className="type-metadata shrink-0">at</div>
          <TeamMark abbr={model.homeAbbr} name={model.homeName} />
        </div>
        <p className="type-secondary mt-4 text-center">
          {model.seasonLabel} · {model.statusLabel} · {model.tipLabel}
        </p>
        <p className="type-metadata mt-1 text-center">{model.updatedLabel}</p>
      </header>

      <section className="mt-10" aria-labelledby="team-identity">
        <h2 id="team-identity" className="type-section-heading text-[#063F46]">
          2025–26 Team Identity
        </h2>
        {model.history ? (
          <>
            <p className="type-metadata mt-1">{model.history.label}</p>
            <p className="type-secondary mt-2">{model.history.possessionNote}</p>
            <div className="mt-4 border-y border-[#DCE9EA]">
              <div className="grid grid-cols-[1fr_minmax(7rem,9.5rem)_1fr] gap-2 py-2">
                <div className="type-metadata text-right">{model.awayAbbr}</div>
                <div />
                <div className="type-metadata">{model.homeAbbr}</div>
              </div>
              {model.history.rows.map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-[1fr_minmax(7rem,9.5rem)_1fr] gap-2 border-t border-[#DCE9EA] py-2.5"
                >
                  <div className="type-card-data text-right tabular-nums text-[#063F46]">{row.away}</div>
                  <div className="type-secondary text-center">{row.label}</div>
                  <div className="type-card-data tabular-nums text-[#063F46]">{row.home}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="type-secondary mt-2">{model.historyNote}</p>
        )}
      </section>

      {model.insights.length > 0 ? (
        <section className="mt-10" aria-labelledby="matchup-context">
          <h2 id="matchup-context" className="type-section-heading text-[#063F46]">
            What Matters in This Matchup
          </h2>
          <div className="mt-4 space-y-6">
            {model.insights.map((insight) => (
              <Insight key={insight.id} insight={insight} />
            ))}
          </div>
        </section>
      ) : null}

      {model.contributors ? (
        <section className="mt-10" aria-labelledby="contributors">
          <h2 id="contributors" className="type-section-heading text-[#063F46]">
            Last Season&apos;s Key Contributors
          </h2>
          <p className="type-metadata mt-1">{model.contributors.label}</p>
          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <h3 className="type-secondary mb-3">{model.awayAbbr}</h3>
              <ContributorList players={model.contributors.away} />
            </div>
            <div>
              <h3 className="type-secondary mb-3">{model.homeAbbr}</h3>
              <ContributorList players={model.contributors.home} />
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-10" aria-labelledby="roster-continuity">
        <h2 id="roster-continuity" className="type-section-heading text-[#063F46]">
          Roster Continuity
        </h2>
        <p className="type-secondary mt-2">{model.roster.note}</p>
        {model.roster.status === 'shown' && model.roster.teams && model.roster.observationDate ? (
          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {model.roster.teams.map((team) => (
              <RosterTeam
                key={team.teamId}
                team={team}
                date={model.roster.observationDate ?? ''}
                source={model.roster.source}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-10" aria-labelledby="sportsbook">
        <h2 id="sportsbook" className="type-section-heading text-[#063F46]">
          Sportsbook quote
        </h2>
        {model.quote ? (
          <>
            <p className="type-metadata mt-1">{model.quote.caption ?? model.quote.vendorLabel}</p>
            <p className="type-secondary mt-2">One current pregame quote. Not a prediction.</p>
            <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-[#DCE9EA] bg-[#DCE9EA] sm:grid-cols-3">
              <div className="bg-white px-3 py-3 text-center">
                <div className="type-secondary mb-1.5">Market spread</div>
                <div className="type-card-data text-[#063F46]">{model.quote.spreadAway}</div>
                <div className="type-card-data text-[#063F46]">{model.quote.spreadHome}</div>
              </div>
              <div className="bg-white px-3 py-3 text-center">
                <div className="type-secondary mb-1.5">Market total</div>
                <div className="type-card-data text-[#168DD8]">{model.quote.total}</div>
                <div className="type-secondary mt-0.5">{model.quote.totalPrices}</div>
              </div>
              <div className="bg-white px-3 py-3 text-center">
                <div className="type-secondary mb-1.5">Market ML</div>
                <div className="type-card-data text-[#063F46]">{model.quote.moneylineAway}</div>
                <div className="type-card-data text-[#063F46]">{model.quote.moneylineHome}</div>
              </div>
            </div>
            {model.quote.implied ? <p className="type-secondary mt-3 text-center">{model.quote.implied}</p> : null}
          </>
        ) : (
          <p className="type-secondary mt-2">{model.quoteNote}</p>
        )}
      </section>
    </main>
  );
}

export function PregameMatchupMissing({ returnHref }: { returnHref: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="type-page-title text-[#063F46]">Game not found</h1>
      <p className="type-body mt-3 text-[#063F46]">That game is not on the scoreboard.</p>
      <Link href={returnHref} className="type-interactive mt-6 inline-block text-[#075B5C] hover:underline">
        Today&apos;s Games
      </Link>
    </main>
  );
}
