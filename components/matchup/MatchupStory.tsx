import type { OverviewStory } from '@/lib/pregame-matchup/overview';

const scrollMargin = { scrollMarginTop: 'var(--matchup-scroll-offset, 9rem)' } as const;

/** Interpretation of the strongest existing finding. The cards below carry the numbers. */
export function MatchupStory({ story }: { story: OverviewStory }) {
  return (
    <section
      id="section-story"
      className="overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm"
      style={scrollMargin}
      aria-labelledby="matchup-story-heading"
      data-matchup-story
    >
      <div className="border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
        <h2 id="matchup-story-heading" className="type-section-heading text-[#063f46]">
          Matchup story
        </h2>
      </div>
      <div className="space-y-2 p-3">
        <h3 className="type-card-data text-balance text-[#063f46]">{story.headline}</h3>
        <p className="type-body text-pretty text-[#063f46]">{story.lede}</p>
        {story.sampleLabel ? <p className="type-metadata">{story.sampleLabel}</p> : null}
        {story.caveat ? <p className="type-secondary text-pretty">{story.caveat}</p> : null}
      </div>
    </section>
  );
}
