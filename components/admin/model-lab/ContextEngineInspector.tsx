import { LabCard } from '@/components/admin/model-lab/LabCard';
import { CONTEXT_ENGINE_INSPECTOR_FIXTURE } from '@/lib/context-engine/fixtures';

export function ContextEngineInspector() {
  const fixture = CONTEXT_ENGINE_INSPECTOR_FIXTURE;
  return (
    <LabCard title="Context Engine inspector" badge="dev fixture · not production-certified">
      <p className="text-xs text-muted-foreground">
        Shared contract {fixture.contractVersion}. Facts, signals, reliability, and model-feature eligibility are
        separate layers. This example is historical/dev only.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 text-xs">
        <div>
          <h3 className="text-white/90 font-medium mb-1">Facts</h3>
          <ul className="space-y-1 text-white/80">
            {fixture.facts.map((fact) => (
              <li key={fact.key}>
                {fact.category} · {fact.key} = {fact.value == null ? 'missing' : String(fact.value)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-white/90 font-medium mb-1">Signals</h3>
          <ul className="space-y-1 text-white/80">
            {fixture.signals.map((row) => (
              <li key={row.definition.id}>
                {row.definition.id} · {row.definition.status} · present={String(row.present)} ·{' '}
                {row.reliability.state}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-white/90 font-medium mb-1">Reliability</h3>
          <p className="text-white/80">
            Opaque confidence percentages are forbidden. Thresholds not already certified stay THRESHOLD_NOT_CERTIFIED.
          </p>
        </div>
        <div>
          <h3 className="text-white/90 font-medium mb-1">Model feature eligibility</h3>
          <ul className="space-y-1 text-white/80">
            {fixture.modelFeatureEligibility.map((row) => (
              <li key={row.featureName}>
                {row.featureName}: {row.eligible ? 'eligible' : 'not eligible'}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </LabCard>
  );
}
