import type { TeamSeasonSnapshot } from '@/lib/teams/team-season-snapshot';
import {
  formatMetric,
  formatNetRating,
} from '@/lib/teams/team-season-snapshot';
import type { TeamRosterContinuity } from '@/lib/teams/team-roster-continuity';
import { previewContinuityList } from '@/lib/teams/team-roster-continuity';
import type { PreviousSeasonBaseline } from '@/lib/teams/team-previous-season-baseline';
import { formatNbaSeasonLabel } from '@/lib/season';

type TeamSeasonSnapshotPanelProps = {
  season: string;
  seasonLabel: string;
  snapshot: TeamSeasonSnapshot;
  continuity: TeamRosterContinuity;
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
    <div className="min-w-[4.5rem]">
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

/** Shared metric grid for current + previous (same formatting, no deltas). */
function SnapshotMetricsGrid({
  snap,
  showSampleLabel,
}: {
  snap: TeamSeasonSnapshot;
  showSampleLabel: boolean;
}) {
  const record =
    snap.hasData && snap.wins != null && snap.losses != null
      ? `${snap.wins}–${snap.losses}`
      : '—';

  const netAccent =
    snap.netRating == null
      ? undefined
      : snap.netRating > 0
        ? '#39ff14'
        : snap.netRating < 0
          ? '#ff6b35'
          : undefined;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4">
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

function ContinuityNameList({
  title,
  prefix,
  players,
}: {
  title: string;
  prefix: '+' | '–';
  players: { playerEntityId: string; displayName: string }[];
}) {
  const { shown, more } = previewContinuityList(players);
  if (players.length === 0) {
    return (
      <div>
        <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          {title}
        </h4>
        <p className="text-xs text-muted-foreground">None</p>
      </div>
    );
  }
  return (
    <div>
      <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
        {title}
      </h4>
      <ul className="space-y-0.5">
        {shown.map((p) => (
          <li key={p.playerEntityId} className="text-xs text-white/90 truncate">
            <span className="text-muted-foreground mr-1">{prefix}</span>
            {p.displayName}
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="text-[10px] text-muted-foreground mt-1">+ {more} more</p>
      )}
    </div>
  );
}

export function TeamSeasonSnapshotPanel({
  season,
  seasonLabel,
  snapshot,
  continuity,
  previousBaseline,
}: TeamSeasonSnapshotPanelProps) {
  const continuityPrevLabel = formatNbaSeasonLabel(continuity.previousSeason);
  const baselineLabel = formatNbaSeasonLabel(previousBaseline.baselineSeason);

  return (
    <section
      className="glass-card rounded-xl p-4 space-y-4"
      data-analytics-season={season}
      aria-label={`${seasonLabel} team snapshot`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-white">Team Snapshot</h2>
        <span className="text-[10px] text-muted-foreground">{seasonLabel}</span>
      </div>

      <div data-snapshot-role="current" data-snapshot-season={season}>
        <h3 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
          Current Season — {seasonLabel}
        </h3>
        {!snapshot.hasData ? (
          <div className="space-y-1">
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
        <h3 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
          Roster Continuity
        </h3>
        {!continuity.available ? (
          <p className="text-xs text-muted-foreground">
            {continuity.unavailableReason ?? 'Roster continuity unavailable'}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-[10px] text-muted-foreground">
              {seasonLabel} vs {continuityPrevLabel} final roster
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted-foreground text-xs mr-1.5">
                  Returning
                </span>
                <span className="font-mono font-semibold text-white">
                  {continuity.returningCount}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs mr-1.5">Added</span>
                <span className="font-mono font-semibold text-[#39ff14]">
                  {continuity.addedCount}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs mr-1.5">
                  Departed
                </span>
                <span className="font-mono font-semibold text-[#ff6b35]">
                  {continuity.departedCount}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ContinuityNameList
                title="Added"
                prefix="+"
                players={continuity.added}
              />
              <ContinuityNameList
                title="Departed"
                prefix="–"
                players={continuity.departed}
              />
            </div>
          </div>
        )}
      </div>

      <div
        className="border-t border-white/5 pt-3"
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
          />
        )}
      </div>
    </section>
  );
}
