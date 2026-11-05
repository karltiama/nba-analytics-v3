import type { InjuryReport as InjuryReportModel, InjuryReportPlayer, InjurySeverity } from '@/lib/pregame-matchup/injury-report';
import { lastName, timeOutLabel } from '@/lib/pregame-matchup/injury-report';
import { MatchupSection } from '@/components/matchup/MatchupSection';
import Link from 'next/link';

const STATUS_STYLE: Record<InjurySeverity, string> = {
  out: 'border-[#F2C9C4] bg-[#FDF3F2] text-[#8A2A1F]',
  doubtful: 'border-[#F3DDB5] bg-[#FDF8EE] text-[#7A4B05]',
  questionable: 'border-[#F3DDB5] bg-[#FFFBEB] text-[#7A4B05]',
  day_to_day: 'border-[#DCE9EA] bg-[#F8FBFA] text-[#4a6366]',
  probable: 'border-[#BFE8D6] bg-[#EEFAF4] text-[#166534]',
  other: 'border-[#DCE9EA] bg-[#F8FBFA] text-[#4a6366]',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-24" → "Oct 24". Read as a calendar date, never shifted by time zone. */
export function shortDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function asOfLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `as of ${new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)} ET`;
}

function PlayerRow({ p, abbr }: { p: InjuryReportPlayer; abbr: string }) {
  const facts: string[] = [];
  if (p.teamGames > 0) facts.push(`Played ${p.playedThisSeason} of ${p.teamGames} ${abbr} games this season`);
  if (p.baselineMinutes != null) facts.push(`${p.baselineMinutes.toFixed(1)} min/g (${p.baselineSeason})`);
  const dates: string[] = [];
  if (p.reportedOn) dates.push(`Reported ${shortDate(p.reportedOn)}`);
  if (p.expectedReturn) dates.push(`Est. return ${shortDate(p.expectedReturn)}`);
  return (
    <li className="py-2.5" data-injury-player={p.playerId}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-[#063f46]">{p.name}</span>
        <span className={`type-badge rounded-full border px-2 py-0.5 ${STATUS_STYLE[p.severity]}`}>{p.status}</span>
        {p.injury ? <span className="type-secondary">{p.injury}</span> : null}
      </div>
      <p className="type-body mt-1 text-[#063f46]">{timeOutLabel(p, abbr, shortDate)}</p>
      {facts.length > 0 ? <p className="type-metadata mt-0.5">{facts.join(' · ')}</p> : null}
      {dates.length > 0 ? <p className="type-metadata mt-0.5">{dates.join(' · ')}</p> : null}
      {p.wowy ? (
        <p className="type-metadata mt-1" data-injury-wowy={p.wowy.season}>
          <span>WOWY without {lastName(p.name)} ({p.wowy.seasonLabel}): </span>
          {p.wowy.links.map((link, i) => (
            <span key={link.playerId}>
              {i > 0 ? ' · ' : null}
              <Link
                href={link.href}
                className="text-[#075B5C] hover:underline"
                title={`${link.name}'s stats with and without ${p.name}, ${p.wowy!.seasonLabel}`}
              >
                {link.name}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
      {p.note ? (
        <details className="mt-1">
          <summary className="type-metadata cursor-pointer text-[#075B5C] hover:underline">Report</summary>
          <p className="type-secondary mt-1 text-pretty">{p.note}</p>
        </details>
      ) : null}
    </li>
  );
}

/** Every listed injury on both teams, with how long each player has been out. */
export function InjuryReport({ report, flow = false }: { report: InjuryReportModel; flow?: boolean }) {
  const asOf = asOfLabel(report.asOf);
  return (
    <MatchupSection
      id="section-injuries"
      headingId="injury-report"
      title="Injury report"
      aside={asOf}
      flow={flow}
      bodyClassName="space-y-4"
      data-injury-report={report.status}
    >
      {report.status === 'unavailable' ? (
        <p className="type-secondary">The injury report is unavailable right now.</p>
      ) : (
        <>
          <p className="type-metadata">
            Time out comes from game logs: the last game each player played and how many of his team&apos;s{' '}
            {report.seasonLabel} games he has missed since. Players who missed games are not in the {report.seasonLabel}{' '}
            team numbers for those games. Return dates are the feed&apos;s estimates. WOWY links open a healthy
            teammate&apos;s stats with and without the injured player, using last season when this season has too
            few games on either side.
          </p>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {report.teams.map((team) => (
              <div key={team.teamId} className="min-w-0 rounded-xl border border-[#DCE9EA] px-3 py-2" data-injury-team={team.abbr}>
                <div className="flex items-baseline justify-between gap-2 border-b border-[#DCE9EA] pb-1.5">
                  <h3 className="type-section-heading text-[#063f46]">{team.abbr}</h3>
                  <span className="type-metadata">
                    {team.players.length === 0 ? 'No injuries listed' : `${team.players.length} listed`}
                  </span>
                </div>
                {team.sampleNote ? <p className="type-metadata mt-1.5 text-[#7A4B05]">{team.sampleNote}</p> : null}
                {team.players.length > 0 ? (
                  <ul className="divide-y divide-[#EEF4F3]">
                    {team.players.map((p) => (
                      <PlayerRow key={p.playerId} p={p} abbr={team.abbr} />
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}
    </MatchupSection>
  );
}
