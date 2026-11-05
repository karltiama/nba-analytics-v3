import type { OverviewFinding } from '@/lib/pregame-matchup/overview';
import { MatchupSection } from '@/components/matchup/MatchupSection';

/** In flow the column shares the row with the sidebar, so it splits later. */
function columns(count: number, flow: boolean): string {
  if (count >= 3) return flow ? 'md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-3' : 'lg:grid-cols-3';
  if (count === 2) return flow ? 'md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2' : 'lg:grid-cols-2';
  return '';
}

/** One sample label for the section when every finding shares it. */
function sharedSample(findings: OverviewFinding[]): string | null {
  const first = findings[0]?.sampleLabel;
  return first && findings.every((finding) => finding.sampleLabel === first) ? first : null;
}

/** Up to three findings already chosen by selectMatchupInsights. */
export function MatchupFindings({ findings, flow = false }: { findings: OverviewFinding[]; flow?: boolean }) {
  if (findings.length === 0) return null;
  const shared = flow ? sharedSample(findings) : null;
  return (
    <MatchupSection
      id="section-signals"
      headingId="matchup-findings-heading"
      title="Key findings"
      aside={shared}
      flow={flow}
      bodyClassName={`grid grid-cols-1 gap-4 ${columns(findings.length, flow)}`}
      data-finding-count={findings.length}
    >
      {findings.map((finding) => (
        <article key={finding.id} className="min-w-0 border-l-2 border-[#075B5C] pl-3" data-signal-id={finding.id}>
          {finding.trend ? (
            <p
              className={`type-badge mb-1 inline-block rounded-full border px-2 py-0.5 ${
                finding.trend === 'held'
                  ? 'border-[#BFE8D6] bg-[#EEFAF4] text-[#166534]'
                  : finding.trend === 'reversed'
                    ? 'border-[#F2C9C4] bg-[#FDF3F2] text-[#8A2A1F]'
                    : 'border-[#F3DDB5] bg-[#FFFBEB] text-[#7A4B05]'
              }`}
              data-finding-trend={finding.trend}
              title={
                finding.trend === 'held'
                  ? 'Last season showed the same contrast in the same direction.'
                  : finding.trend === 'reversed'
                    ? 'Last season showed this contrast running the other way. Early-season numbers can be noise.'
                    : 'Last season did not show this contrast. Early-season numbers can be noise.'
              }
            >
              {finding.trend === 'held'
                ? 'Held from 2025–26'
                : finding.trend === 'reversed'
                  ? 'Reversed from 2025–26'
                  : 'New this season'}
            </p>
          ) : null}
          <h3 className="type-card-data text-balance text-[#063f46]">{finding.title}</h3>
          <p className="type-secondary mt-1 text-pretty">{finding.evidence}</p>
          {finding.summary ? <p className="type-body mt-2 text-pretty text-[#063f46]">{finding.summary}</p> : null}
          {shared ? null : <p className="type-metadata mt-2">{finding.sampleLabel}</p>}
          <a
            href={finding.destination}
            className="type-interactive mt-2 inline-block rounded-lg text-[#075B5C] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075B5C]"
          >
            Team stats
          </a>
        </article>
      ))}
    </MatchupSection>
  );
}
