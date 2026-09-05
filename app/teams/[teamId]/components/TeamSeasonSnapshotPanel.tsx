import type { TeamSeasonSnapshot } from '@/lib/teams/team-season-snapshot';
import {
  formatMetric,
  formatNetRating,
} from '@/lib/teams/team-season-snapshot';
import type { TeamRosterContinuity } from '@/lib/teams/team-roster-continuity';
import type { PreviousSeasonBaseline } from '@/lib/teams/team-previous-season-baseline';
import type { RosterChangeStory } from '@/lib/teams/roster-change-story';
import {
  formatChangeContextLine,
  type RosterChangePlayerStory,
} from '@/lib/teams/roster-change-story';
import { formatNbaSeasonLabel } from '@/lib/season';

type TeamSeasonSnapshotPanelProps = {
  season: string;
  seasonLabel: string;
  snapshot: TeamSeasonSnapshot;
  continuity: TeamRosterContinuity;
  rosterChangeStory: RosterChangeStory;
  previousBaseline: PreviousSeasonBaseline;
};

function StatCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="min-w-18">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className="text-sm font-bold font-mono text-white"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function SnapshotMetricsGrid({
  snap,
  showSampleLabel,
  muted,
}: {
  snap: TeamSeasonSnapshot;
  showSampleLabel: boolean;
  muted?: boolean;
}) {
  const record =
    snap.hasData && snap.wins != null && snap.losses != null
      ? `${snap.wins}–${snap.losses}`
      : '—';

  const netAccent =
    muted || snap.netRating == null
      ? undefined
      : snap.netRating > 0
        ? '#39ff14'
        : snap.netRating < 0
          ? '#ff6b35'
          : undefined;

  return (
    <div className={`space-y-2 ${muted ? 'opacity-90' : ''}`}>
      <div className="flex flex-wrap gap-3 sm:gap-4">
        <StatCell label="Record" value={record} />
        <StatCell label="PPG" value={formatMetric(snap.ppg)} />
        <StatCell label="ORTG" value={formatMetric(snap.ortg)} />
        <StatCell label="DRTG" value={formatMetric(snap.drtg)} />
        <StatCell
          label="Net"
          value={formatNetRating(snap.netRating)}
          accent={netAccent}
        />
        <StatCell label="Pace" value={formatMetric(snap.pace)} />
        <StatCell label="Games" value={String(snap.gamesPlayed)} />
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {showSampleLabel && snap.sampleLabel && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-muted-foreground">
            {snap.sampleLabel}
          </span>
        )}
        {snap.scopeNote && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-200/90">
            {snap.scopeNote}
          </span>
        )}
        {!snap.scopeNote && snap.hasData && (
          <span className="text-[10px] text-muted-foreground">
            All games this season
          </span>
        )}
      </div>
    </div>
  );
}

function KeyChangeRow({
  story,
  teamPrefix,
}: {
  story: RosterChangePlayerStory;
  teamPrefix: 'From' | 'Now';
}) {
  return (
    <li className="py-1.5 border-b border-white/5 last:border-0">
      <div className="text-sm text-white font-medium truncate">
        {story.displayName}
      </div>
      <div className="text-[10px] text-muted-foreground leading-snug">
        {formatChangeContextLine(story)}
        {story.otherTeamAbbr && (
          <span>
            {' · '}
            {teamPrefix} {story.otherTeamAbbr}
          </span>
        )}
      </div>
    </li>
  );
}

function OtherNames({
  players,
}: {
  players: { playerEntityId: string; displayName: string }[];
}) {
  if (players.length === 0) return null;
  const shown = players.slice(0, 4);
  const more = players.length - shown.length;
  return (
    <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
      <span className="uppercase tracking-wide">Other</span>
      {' · '}
      {shown.map((p) => p.displayName).join(' · ')}
      {more > 0 && <span> · +{more} more</span>}
    </p>
  );
}

export function TeamSeasonSnapshotPanel({
  season,
  seasonLabel,
  snapshot,
  continuity,
  rosterChangeStory,
  previousBaseline,
}: TeamSeasonSnapshotPanelProps) {
  const continuityPrevLabel = formatNbaSeasonLabel(continuity.previousSeason);
  const baselineLabel = formatNbaSeasonLabel(previousBaseline.baselineSeason);
  const story = rosterChangeStory.available ? rosterChangeStory : null;

  return (
    <section
      className="glass-card rounded-xl p-4 space-y-4"
      data-analytics-season={season}
      aria-label={`${seasonLabel} team snapshot`}
    >
      <h2 className="text-sm font-semibold text-white">Team Snapshot</h2>

      <div data-snapshot-role="current" data-snapshot-season={season}>
        <h3 className="text-xs font-semibold text-white mb-2">
          Current Season — {seasonLabel}
        </h3>
        {!snapshot.hasData ? (
          <div className="space-y-0.5">
            <p className="text-sm text-muted-foreground">
              Not enough season data yet
            </p>
            <p className="text-xs text-muted-foreground">0 GP</p>
          </div>
        ) : (
          <SnapshotMetricsGrid snap={snapshot} showSampleLabel />
        )}
      </div>

      <div className="border-t border-white/5 pt-3">
        <h3 className="text-xs font-semibold text-white mb-2">Roster Changes</h3>
        {!continuity.available ? (
          <p className="text-xs text-muted-foreground">
            {continuity.unavailableReason ?? 'Roster continuity unavailable'}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-[10px] text-muted-foreground">
              vs {continuityPrevLabel} roster
            </p>
            <p className="text-sm text-white/90">
              <span className="font-mono font-semibold">
                {continuity.returningCount}
              </span>
              <span className="text-muted-foreground text-xs ml-1 mr-3">
                Returning
              </span>
              <span className="font-mono font-semibold text-[#39ff14]">
                {continuity.addedCount}
              </span>
              <span className="text-muted-foreground text-xs ml-1 mr-3">
                Added
              </span>
              <span className="font-mono font-semibold text-[#ff6b35]">
                {continuity.departedCount}
              </span>
              <span className="text-muted-foreground text-xs ml-1">
                Departed
              </span>
            </p>

            {story && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    Key Additions
                  </h4>
                  {story.addedKey.length === 0 ? (
                    <p className="text-xs text-muted-foreground">None</p>
                  ) : (
                    <ul>
                      {story.addedKey.map((s) => (
                        <KeyChangeRow
                          key={s.playerEntityId}
                          story={s}
                          teamPrefix="From"
                        />
                      ))}
                    </ul>
                  )}
                  <OtherNames players={story.addedOther} />
                </div>
                <div>
                  <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    Key Departures
                  </h4>
                  {story.departedKey.length === 0 ? (
                    <p className="text-xs text-muted-foreground">None</p>
                  ) : (
                    <ul>
                      {story.departedKey.map((s) => (
                        <KeyChangeRow
                          key={s.playerEntityId}
                          story={s}
                          teamPrefix="Now"
                        />
                      ))}
                    </ul>
                  )}
                  <OtherNames players={story.departedOther} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="rounded-lg border border-white/5 bg-white/[0.02] p-3"
        data-snapshot-role="previous"
        data-snapshot-season={previousBaseline.baselineSeason}
      >
        <h3 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
          Previous Season — {baselineLabel}
        </h3>
        {!previousBaseline.available ? (
          <p className="text-xs text-muted-foreground">
            {previousBaseline.unavailableReason ??
              'Previous season baseline unavailable'}
          </p>
        ) : (
          <SnapshotMetricsGrid
            snap={previousBaseline.snapshot}
            showSampleLabel={false}
            muted
          />
        )}
      </div>
    </section>
  );
}
