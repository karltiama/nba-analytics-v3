import type { ModelLabStatus } from '@/lib/model-lab/types';
import { LabCard } from '@/components/admin/model-lab/LabCard';
import { shortHash } from '@/components/admin/model-lab/format';
import { ContextEngineInspector } from '@/components/admin/model-lab/ContextEngineInspector';

export function LabStatus({ status }: { status: ModelLabStatus }) {
  return (
    <div className="space-y-4">
      <LabCard title="Research status" badge="not production">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Production Control</dt>
            <dd className="text-white/90">{status.research.productionControl}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Frozen Shadow Candidates</dt>
            <dd className="text-white/90">{status.research.frozenShadowCandidates.join(' · ')}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">WOWY Availability Candidate</dt>
            <dd className="text-white/90">{status.research.wowyAvailability}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Live Data</dt>
            <dd className="text-white/90">{status.research.liveData}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Prospective Evaluation</dt>
            <dd className="text-white/90">{status.research.prospectiveEvaluation}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Model D</dt>
            <dd className="text-white/90">{status.research.modelD.replaceAll('_', ' ')}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          PTS C and REB C are frozen shadow candidates, not production models. Shadow scoring:{' '}
          {status.research.shadowScoring}. Injury collection: {status.research.injuryCollection}.
        </p>
      </LabCard>
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
      <LabCard title="Prospective evaluation" badge={status.prospectiveEvaluation.started ? 'started' : 'Not started.'}>
        <p className="text-sm text-white/90">{status.prospectiveEvaluation.note}</p>
      </LabCard>
      <ContextEngineInspector />
    </div>
  );
}
