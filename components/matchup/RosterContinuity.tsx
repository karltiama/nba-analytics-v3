import type { RosterPresentation, TeamContinuity } from '@/lib/pregame-matchup/roster';

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ShareRow({
  label,
  teams,
  value,
  emphasize = false,
}: {
  label: string;
  teams: TeamContinuity[];
  value: (team: TeamContinuity) => number | null;
  emphasize?: boolean;
}) {
  return (
    <div>
      <p className="type-secondary mb-2">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {teams.map((team) => {
          const share = value(team);
          if (share == null || !Number.isFinite(share)) return null;
          const width = `${Math.max(0, Math.min(100, share * 100))}%`;
          return (
            <div key={`${label}-${team.teamId}`} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="type-metadata">{team.abbr}</span>
                <span className="type-card-data tabular-nums text-[#063f46]">{pct(share)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#F3F8F8]" aria-hidden>
                <div
                  className={`h-1.5 rounded-full bg-[#075B5C] ${emphasize ? '' : 'opacity-70'}`}
                  style={{ width }}
                  data-continuity-bar={label}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RosterContinuity({ roster }: { roster: RosterPresentation }) {
  const teams = roster.status === 'shown' ? roster.teams : null;
  return (
    <section
      id="section-roster"
      className="overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm"
      style={{ scrollMarginTop: 'var(--matchup-scroll-offset, 9rem)' }}
      aria-labelledby="roster-continuity"
      data-continuity={roster.status}
    >
      <div className="border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
        <h2 id="roster-continuity" className="type-section-heading text-[#063f46]">
          Roster Continuity
        </h2>
      </div>
      <div className="space-y-4 p-3">
        {teams && teams.length > 0 ? (
          <>
            <ShareRow emphasize label="Returning minutes" teams={teams} value={(team) => team.minutesShare} />
            <ShareRow label="Returning FGA" teams={teams} value={(team) => team.fgaShare} />
            <ShareRow label="Returning FTA" teams={teams} value={(team) => team.ftaShare} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {teams.map((team) => (
                <p key={team.teamId} className="type-secondary min-w-0">
                  {team.abbr}: {Math.round(team.minutesNumerator)} of {Math.round(team.minutesDenominator)} minutes,{' '}
                  {Math.round(team.fgaNumerator)} of {Math.round(team.fgaDenominator)} field-goal attempts,{' '}
                  {Math.round(team.ftaNumerator)} of {Math.round(team.ftaDenominator)} free-throw attempts.{' '}
                  {team.returning} played for {team.abbr} in the 2025–26 regular season, {team.otherTeam} played only for another team, and{' '}
                  {team.noPriorHistory} have no verified regular-season games in that window.
                  {team.concentration ? ` ${team.concentration}` : ''}
                </p>
              ))}
            </div>
          </>
        ) : null}
        <p className="type-secondary">{roster.note}</p>
      </div>
    </section>
  );
}
