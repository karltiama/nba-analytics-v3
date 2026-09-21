import { formatNbaSeasonLabel } from '@/lib/season';
import {
  formatMetric,
  type TeamSeasonSnapshot,
} from '@/lib/teams/team-season-snapshot';
import type {
  PreviewSnapshotField,
  TeamPreseasonPreviewContent,
} from './types';

export function buildSnapshotFields(
  snap: TeamSeasonSnapshot,
  content: TeamPreseasonPreviewContent
): PreviewSnapshotField[] {
  if (!snap.hasData) return [];

  const fields: PreviewSnapshotField[] = [];
  if (snap.wins != null && snap.losses != null) {
    fields.push({
      label: `${formatNbaSeasonLabel(snap.season)} Record`,
      value: `${snap.wins}–${snap.losses}`,
    });
  }

  const playoff = content.snapshotNotes?.playoffResult?.trim();
  if (playoff) {
    fields.push({ label: 'Playoff Result', value: playoff });
  }

  if (snap.ortg != null) {
    fields.push({ label: 'Offensive Rating', value: formatMetric(snap.ortg) });
  }
  if (snap.drtg != null) {
    fields.push({ label: 'Defensive Rating', value: formatMetric(snap.drtg) });
  }
  if (snap.pace != null) {
    fields.push({ label: 'Pace', value: formatMetric(snap.pace) });
  }

  return fields;
}
