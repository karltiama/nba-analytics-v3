import type { OverviewFinding } from '@/lib/pregame-matchup/overview';

const scrollMargin = { scrollMarginTop: 'var(--matchup-scroll-offset, 9rem)' } as const;

function columns(count: number): string {
  if (count >= 3) return 'lg:grid-cols-3';
  if (count === 2) return 'lg:grid-cols-2';
  return '';
}

/** Up to three findings already chosen by selectMatchupInsights. */
export function MatchupFindings({ findings }: { findings: OverviewFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <section
      id="section-signals"
      className="overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm"
      style={scrollMargin}
      aria-labelledby="matchup-findings-heading"
      data-finding-count={findings.length}
    >
      <div className="border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
        <h2 id="matchup-findings-heading" className="type-section-heading text-[#063f46]">
          Key findings
        </h2>
      </div>
      <div className={`grid grid-cols-1 gap-4 p-3 ${columns(findings.length)}`}>
        {findings.map((finding) => (
          <article key={finding.id} className="min-w-0 border-l-2 border-[#075B5C] pl-3" data-signal-id={finding.id}>
            <h3 className="type-card-data text-balance text-[#063f46]">{finding.title}</h3>
            <p className="type-secondary mt-1 text-pretty">{finding.evidence}</p>
            {finding.summary ? <p className="type-body mt-2 text-pretty text-[#063f46]">{finding.summary}</p> : null}
            <p className="type-metadata mt-2">{finding.sampleLabel}</p>
            <a
              href={finding.destination}
              className="type-interactive mt-2 inline-block rounded-lg text-[#075B5C] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075B5C]"
            >
              Team stats
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
