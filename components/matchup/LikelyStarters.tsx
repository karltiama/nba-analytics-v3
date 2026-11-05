import type { LikelyStarter, StartersModel, StartersTeam } from '@/lib/pregame-matchup/starters';
import { MatchupSection } from '@/components/matchup/MatchupSection';
import { shortDate } from '@/components/matchup/InjuryReport';

function StatusTag({ p }: { p: LikelyStarter }) {
  if (!p.status) return null;
  const tone =
    p.severity === 'questionable' || p.severity === 'day_to_day'
      ? 'border-[#F3DDB5] bg-[#FFFBEB] text-[#7A4B05]'
      : 'border-[#DCE9EA] bg-[#F8FBFA] text-[#4a6366]';
  return <span className={`type-badge rounded-full border px-2 py-0.5 ${tone}`}>{p.status}</span>;
}

function Row({ p, games }: { p: LikelyStarter; games: number }) {
  return (
    <li className="py-2" data-likely-starter={p.playerId}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="type-metadata w-4 shrink-0 text-center">{p.position ?? '–'}</span>
        <span className="text-sm font-semibold text-[#063f46]">{p.name}</span>
        <StatusTag p={p} />
        <span className="type-metadata ml-auto">
          Started {p.starts} of {games}
        </span>
      </div>
      {p.replaces ? (
        <p className="type-metadata mt-0.5 pl-6 text-[#7A4B05]" data-starter-replaces={p.replaces.playerId}>
          In for {p.replaces.name} ({p.replaces.status})
        </p>
      ) : null}
    </li>
  );
}

function TeamCard({ team }: { team: StartersTeam }) {
  const changed = team.likely?.some((p) => p.replaces) || team.unfilled.length > 0;
  return (
    <div className="min-w-0 rounded-xl border border-[#DCE9EA] px-3 py-2" data-starters-team={team.abbr}>
      <div className="flex items-baseline justify-between gap-2 border-b border-[#DCE9EA] pb-1.5">
        <h3 className="type-section-heading text-[#063f46]">{team.abbr}</h3>
        <span className="type-metadata">
          {team.lastGameDate ? `${changed ? 'Last lineup, adjusted' : 'Same as last game'} · ${shortDate(team.lastGameDate)}` : 'No starts yet'}
        </span>
      </div>
      {team.likely ? (
        <ul className="divide-y divide-[#EEF4F3]">
          {team.likely.map((p) => (
            <Row key={p.playerId} p={p} games={team.games} />
          ))}
        </ul>
      ) : null}
      {team.unfilled.length > 0 ? (
        <p className="type-metadata mt-1 text-[#8A2A1F]">
          No healthy fill-in found for {team.unfilled.map((u) => `${u.name} (${u.status})`).join(', ')}.
        </p>
      ) : null}
      {team.regularsBack.length > 0 ? (
        <p className="type-metadata mt-1.5" data-starters-regulars>
          Also a regular starter, not in the last lineup:{' '}
          {team.regularsBack.map((p) => `${p.name} (${p.starts} of ${team.games}${p.status ? `, ${p.status}` : ''})`).join(', ')}.
        </p>
      ) : null}
    </div>
  );
}

/** Each team's last starting five, with Out/Doubtful starters swapped for the most frequent healthy starter. */
export function LikelyStarters({ starters, flow = false }: { starters: StartersModel; flow?: boolean }) {
  return (
    <MatchupSection
      id="section-starters"
      headingId="likely-starters"
      title="Likely starters"
      aside="Not confirmed"
      flow={flow}
      bodyClassName="space-y-4"
      data-likely-starters={starters.injuryAdjusted ? 'adjusted' : 'unadjusted'}
    >
      <p className="type-metadata">
        Each team&apos;s last starting five
        {starters.injuryAdjusted
          ? ', with anyone listed Out or Doubtful swapped for the healthy player who has started most this season'
          : '. The injury report is unavailable, so no one has been swapped out'}
        . Starts count {starters.seasonLabel} games. Teams announce lineups about 30 minutes before tip.
      </p>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {starters.teams.map((team) => (
          <TeamCard key={team.teamId} team={team} />
        ))}
      </div>
    </MatchupSection>
  );
}
