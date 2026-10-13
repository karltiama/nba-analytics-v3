import type { MatchupInsight } from '@/lib/pregame-matchup/signals';

export function ContextSignals({ insights }: { insights: MatchupInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <section id="section-signals" className="scroll-mt-36 overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm" aria-labelledby="matchup-context">
      <div className="border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
        <h2 id="matchup-context" className="type-section-heading text-[#063f46]">
          What Matters in This Matchup
        </h2>
      </div>
      <div className="space-y-4 p-3">
        {insights.map((insight) => (
          <article key={insight.id} className="border-l-2 border-[#075B5C] pl-3" data-signal-id={insight.id}>
            <h3 className="type-card-data text-[#063f46]">{insight.headline}</h3>
            <p className="type-secondary mt-1">{insight.evidence}</p>
            <p className="type-body mt-2 text-[#063f46]">{insight.body}</p>
            <p className="type-metadata mt-2">{insight.limitation}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
