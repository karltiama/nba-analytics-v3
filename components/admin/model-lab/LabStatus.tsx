import type { ModelLabStatus } from '@/lib/model-lab/types';
import { LabCard } from '@/components/admin/model-lab/LabCard';
import { shortHash } from '@/components/admin/model-lab/format';

export function LabStatus({ status }: { status: ModelLabStatus }) {
  return (
    <div className="space-y-4">
      <LabCard title="Production model">
        <p className="text-sm text-white/90">{status.production.model}</p>
        <p className="text-xs text-muted-foreground">{status.production.note}</p>
      </LabCard>
      <LabCard title="Frozen shadow candidates">
        <ul className="text-xs text-white/80 space-y-1">
          {status.shadowCandidates.map((c) => (
            <li key={c.target}>
              {c.target} · feature set {c.featureSet} · {c.modelVersion} · sha {shortHash(c.sha256)} ·{' '}
              {c.frozen ? 'frozen' : 'not frozen'}
            </li>
          ))}
        </ul>
      </LabCard>
      <LabCard
        title="Deployment state"
        badge={status.deployment.running ? 'running' : status.deployment.deployed ? 'deployed' : 'paused'}
      >
        <p className="text-sm text-white/90">{status.deployment.stateSummary}</p>
        <p className="text-xs text-muted-foreground mt-1">{status.deployment.terraformDefaults}</p>
        <p className="text-xs text-muted-foreground">
          Implementation complete: {status.deployment.implementationComplete ? 'yes' : 'no'}. Deployed:{' '}
          {status.deployment.deployed ? 'yes' : 'no'}. Running: {status.deployment.running ? 'yes' : 'no'}.
        </p>
      </LabCard>
      <LabCard title="Collection freshness">
        <p className="text-sm text-white/90">{status.collection.freshness}</p>
        <p className="text-xs text-muted-foreground">
          Last successful collection: {status.collection.lastSuccessfulCollectionAt ?? 'none'} · schema enrichment:{' '}
          {status.collection.schemaEnrichment ?? 'not queried'}
        </p>
      </LabCard>
      <LabCard title="Prospective evaluation" badge={status.prospectiveEvaluation.started ? 'started' : 'not started'}>
        <p className="text-sm text-white/90">{status.prospectiveEvaluation.note}</p>
      </LabCard>
    </div>
  );
}
