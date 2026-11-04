import type { OverviewStory } from '@/lib/pregame-matchup/overview';
import { MatchupSection } from '@/components/matchup/MatchupSection';

/** Interpretation of the strongest existing finding. The cards below carry the numbers. */
export function MatchupStory({ story, flow = false }: { story: OverviewStory; flow?: boolean }) {
  return (
    <MatchupSection
      id="section-story"
      headingId="matchup-story-heading"
      title="Matchup story"
      flow={flow}
      bodyClassName={`space-y-2 ${flow ? 'max-w-3xl' : ''}`}
      data-matchup-story
    >
      <h3 className="type-card-data text-balance text-[#063f46]">{story.headline}</h3>
      <p className="type-body text-pretty text-[#063f46]">{story.lede}</p>
      {story.sampleLabel ? <p className="type-metadata">{story.sampleLabel}</p> : null}
      {story.caveat ? <p className="type-secondary text-pretty">{story.caveat}</p> : null}
    </MatchupSection>
  );
}
