import { asString, isRecord, readJsonIfExists } from '@/lib/model-lab/fs';
import type { ModelLabStatus } from '@/lib/model-lab/types';
import { MODEL_D } from '@/lib/model-lab/lifecycle-registry';
import {
  INJURY_COLLECTION_STATUS,
  PROVIDER_ENTITLEMENT,
  SHADOW_SCORING_STATUS,
} from '@/lib/model-lab/prospective-shadow-protocol';
import { CONTEXT_ENGINE_CONTRACT_VERSION } from '@/lib/context-engine/contract';

const MANIFEST = 'reports/modeling/shadow-pts-reb-c-r1/manifest.json';

export async function loadModelLabStatus(): Promise<ModelLabStatus> {
  const manifest = readJsonIfExists<unknown>(MANIFEST);
  const hashes = isRecord(manifest) && isRecord(manifest.model_sha256) ? manifest.model_sha256 : {};
  const featureSet = isRecord(manifest) ? asString(manifest.feature_set) ?? 'C' : 'C';
  const modelVersion = isRecord(manifest)
    ? asString(manifest.model_version) ?? 'player-projection-learned-r1-pts-reb-c'
    : 'player-projection-learned-r1-pts-reb-c';

  const status: ModelLabStatus = {
    production: {
      model: 'DNP-inclusive 70/30 last-10 / season average (`computeProjection`)',
      note: 'Production projections are unchanged. They are not learned C/D and not the played-only research Track A. Frozen shadow candidates are not serving.',
    },
    shadowCandidates: [
      {
        target: 'points',
        featureSet,
        modelVersion,
        sha256: asString(hashes.points),
        frozen: true,
      },
      {
        target: 'rebounds',
        featureSet,
        modelVersion,
        sha256: asString(hashes.rebounds),
        frozen: true,
      },
    ],
    deployment: {
      implementationComplete: true,
      deployed: false,
      running: false,
      terraformDefaults: 'shadow_create=false, shadow_execution_enabled=false (repo defaults; this page does not apply Terraform)',
      stateSummary: 'Implementation complete. Not deployed. Not running. Shadow stays paused.',
    },
    collection: {
      freshness: 'No prospective collection. Freshness is empty until shadow writes exist.',
      lastSuccessfulCollectionAt: null,
      schemaEnrichment: null,
    },
    prospectiveEvaluation: {
      started: false,
      note: 'Prospective 2026–27 evaluation has not started. Empty metrics are not a completed holdout.',
    },
    research: {
      productionControl: '70/30',
      frozenShadowCandidates: ['PTS C', 'REB C'],
      wowyAvailability: 'Inconclusive · awaiting prospective availability data',
      liveData: 'Blocked by provider entitlement',
      prospectiveEvaluation: 'Not started',
      contextEngineContract: CONTEXT_ENGINE_CONTRACT_VERSION,
      shadowScoring: SHADOW_SCORING_STATUS,
      injuryCollection: `${INJURY_COLLECTION_STATUS} · ${PROVIDER_ENTITLEMENT}`,
      modelD: MODEL_D.status,
    },
  };

  try {
    const { getCachedPlatformHealth } = await import('@/lib/ops/platform-health');
    const report = await getCachedPlatformHealth();
    const shadow = report.shadow;
    status.collection = {
      freshness: shadow.reason,
      lastSuccessfulCollectionAt: shadow.lastSuccessfulCollectionAt,
      schemaEnrichment: shadow.schemaEnrichment,
    };
    if (shadow.due + shadow.onTime + shadow.late + shadow.failed + shadow.missing > 0) {
      status.prospectiveEvaluation = {
        started: true,
        note: `Health observed due=${shadow.due} on-time=${shadow.onTime} late=${shadow.late} failed=${shadow.failed} missing=${shadow.missing}.`,
      };
    }
  } catch {
    status.collection.freshness =
      'Platform health was not queried (database or env unavailable). Freeze artifacts still say collection has not started.';
  }

  return status;
}
