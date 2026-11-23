import {
  PLAYER_PROP_SNAPSHOT_ARCHIVE_VERSION,
  PLAYER_PROP_SNAPSHOT_SOURCE,
  checksumCanonical,
  type PlayerPropArchiveEnvelope,
} from '../player-prop-snapshot-archive';
import type { PageEvidence } from './pages';

export const PUBLICATION_MANIFEST_VERSION = 'player_prop_publication_manifest.v1';

export type PublicationStatus = 'complete' | 'incomplete' | 'post_tip' | 'empty';

export type PublicationManifest = {
  manifestVersion: typeof PUBLICATION_MANIFEST_VERSION;
  archiveKey: string;
  archiveVersion: typeof PLAYER_PROP_SNAPSHOT_ARCHIVE_VERSION;
  gameId: string;
  gameDate: string;
  pullRunId: number;
  source: typeof PLAYER_PROP_SNAPSHOT_SOURCE;
  rowCount: number;
  rowsFetched: number;
  pages: PageEvidence;
  observedAt: string;
  controllerEnqueuedAt: string;
  envelopeChecksum: string;
  status: PublicationStatus;
  eligible: boolean;
  manifestChecksum: string;
};

export type ManifestBody = Omit<PublicationManifest, 'manifestChecksum'>;

export function manifestChecksum(body: ManifestBody): string {
  return checksumCanonical(body);
}

export function sealManifest(body: ManifestBody): PublicationManifest {
  return { ...body, manifestChecksum: manifestChecksum(body) };
}

export function manifestProblem(manifest: PublicationManifest): string | null {
  const { manifestChecksum: recorded, ...body } = manifest;
  if (manifest.manifestVersion !== PUBLICATION_MANIFEST_VERSION) return 'manifest version is not supported';
  if (manifest.archiveVersion !== PLAYER_PROP_SNAPSHOT_ARCHIVE_VERSION) return 'manifest archive version is not supported';
  if (manifest.source !== PLAYER_PROP_SNAPSHOT_SOURCE) return 'manifest source is not supported';
  if (!manifest.archiveKey || !manifest.gameId || !manifest.gameDate) return 'manifest identity is incomplete';
  if (!Number.isInteger(manifest.pullRunId) || manifest.pullRunId < 0) return 'manifest pull run is invalid';
  if (!Number.isInteger(manifest.rowCount) || manifest.rowCount < 0) return 'manifest row count is invalid';
  if (!Number.isInteger(manifest.rowsFetched) || manifest.rowsFetched < 0) return 'manifest fetched count is invalid';
  if (!Number.isFinite(Date.parse(manifest.observedAt))) return 'manifest observed_at is invalid';
  if (!Number.isFinite(Date.parse(manifest.controllerEnqueuedAt))) return 'manifest controller clock is invalid';
  if (!/^[a-f0-9]{64}$/.test(manifest.envelopeChecksum)) return 'manifest envelope checksum is invalid';
  if (recorded !== manifestChecksum(body)) return 'manifest checksum does not match its body';
  return null;
}

export function publicationEvidenceProblem(
  manifest: PublicationManifest,
  envelope: PlayerPropArchiveEnvelope
): string | null {
  const own = manifestProblem(manifest);
  if (own) return own;
  if (manifest.archiveVersion !== envelope.archiveVersion) return 'manifest archive version does not match the envelope';
  if (manifest.gameId !== envelope.game_id) return 'manifest game does not match the envelope';
  if (manifest.gameDate !== envelope.game_date) return 'manifest game date does not match the envelope';
  if (manifest.pullRunId !== envelope.pull_run_id) return 'manifest pull run does not match the envelope';
  if (manifest.source !== envelope.source) return 'manifest source does not match the envelope';
  if (manifest.rowCount !== envelope.row_count || manifest.rowCount !== envelope.rows.length) {
    return 'manifest row count does not match the envelope';
  }
  if (manifest.envelopeChecksum !== envelope.checksum) return 'manifest envelope checksum does not match the envelope';
  if (manifest.observedAt !== envelope.observed_at) return 'manifest observed_at does not match the envelope';
  if (manifest.controllerEnqueuedAt !== envelope.controller_enqueued_at) {
    return 'manifest controller clock does not match the envelope';
  }
  if (!manifest.pages.cursorClosed || manifest.pages.badPage || manifest.pages.malformed || manifest.pages.foreignGame || manifest.pages.repeatedCursor || manifest.pages.truncatedAtCap) {
    return 'manifest page evidence is incomplete';
  }
  if (manifest.status !== 'complete' || manifest.eligible !== true) return 'manifest is not an eligible publication';
  if (manifest.rowCount < 1 || manifest.rowsFetched < 1) return 'manifest snapshot is empty';
  return null;
}
