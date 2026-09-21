import type { TeamPreseasonPreviewPageModel } from '@/lib/teams/preseason-preview/types';
import { PreviewHero } from './PreviewHero';
import { PreviewSubnav } from './PreviewSubnav';
import { OverviewSection } from './OverviewSection';
import { PlayersToWatchSection } from './PlayersToWatchSection';
import { RoleWatchSection } from './RoleWatchSection';
import {
  ScheduleSection,
  WowyContextSection,
} from './ContextSections';

export function TeamPreseasonPreviewView({
  model,
  routeTeamId,
}: {
  model: TeamPreseasonPreviewPageModel;
  routeTeamId: string;
}) {
  const { content, team } = model;

  return (
    <div className="space-y-5">
      {model.contentSource === 'research_draft' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">Editable research draft — not published copy</p>
          <p className="mt-1 text-amber-900/90">
            Scaffolded from the research packet. Replace every{' '}
            <span className="font-mono text-xs">[EDIT]</span> marker, then promote
            into the curated registry when ready.
          </p>
          {model.draftPath ? (
            <p className="mt-1 font-mono text-xs break-all text-amber-900/80">
              Edit:{' '}
              {(() => {
                const norm = model.draftPath.replace(/\\/g, '/');
                const idx = norm.lastIndexOf('/content/');
                return idx >= 0 ? norm.slice(idx + 1) : norm;
              })()}
            </p>
          ) : null}
        </div>
      ) : null}

      <PreviewHero
        teamAbbr={team.abbreviation}
        teamName={team.full_name}
        conference={team.conference}
        seasonLabel={model.seasonLabel}
        dek={content.dek}
        routeTeamId={routeTeamId}
      />

      <PreviewSubnav />

      <OverviewSection
        bigPicture={content.bigPicture}
        snapshotFields={model.snapshotFields}
        snapshotUnavailableReason={model.snapshotUnavailableReason}
        priorSeasonLabel={model.priorSeasonLabel}
        keyQuestions={content.keyQuestions}
        additions={content.additions}
        departures={content.departures}
        draftPicks={content.draftPicks}
        projectedRotation={content.projectedRotation}
      />

      <PlayersToWatchSection players={content.playersToWatch} />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)] gap-4">
        <RoleWatchSection
          rows={content.roleWatch}
          seasonLabel={model.seasonLabel}
        />
        <ScheduleSection
          schedule={model.schedule}
          unavailableReason={model.scheduleUnavailableReason}
          teamScheduleHref={`/teams/${routeTeamId}/schedule`}
        />
      </div>

      <WowyContextSection
        items={content.wowyContext}
        outlook={content.outlook}
      />
    </div>
  );
}
