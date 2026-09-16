import { HISTORICAL_VALIDITY_NOTE, SPLIT_KIND_COPY } from '@/lib/model-lab/metric-copy';
import type { ExperimentRecord } from '@/lib/model-lab/types';
import { LabCard } from '@/components/admin/model-lab/LabCard';
import { fmtInt, hashTitle, shortHash } from '@/components/admin/model-lab/format';

export function ExperimentHistory({ catalog }: { catalog: ExperimentRecord[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground max-w-3xl">{HISTORICAL_VALIDITY_NOTE}</p>
      {catalog.map((exp) => {
        const decision = exp.decisions[0]?.label;
        const exploratory = exp.id.includes('wowy');
        const badge = [exp.status, exploratory ? 'exploratory' : null, decision]
          .filter(Boolean)
          .join(' · ');
        return (
        <LabCard key={exp.id} title={exp.title} badge={badge}>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-mono text-white/90">{exp.version}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Dataset hash</dt>
              <dd className="font-mono text-white/90" title={hashTitle(exp.datasetHash)}>
                {shortHash(exp.datasetHash)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Feature spec</dt>
              <dd className="font-mono text-white/90">{exp.featureSpecVersion ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Validity class</dt>
              <dd className="text-white/90">{exp.historicalValidityClass ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Eligibility</dt>
              <dd className="text-white/80">{exp.eligibility || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Train / val / test / prospective</dt>
              <dd className="text-white/80">
                {exp.periods.train ?? '—'} · {exp.periods.validation ?? '—'} · {exp.periods.test ?? '—'} ·{' '}
                {exp.periods.prospective ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Targets</dt>
              <dd className="text-white/80">
                {exp.targets.length
                  ? exp.targets.map((t) => (t.derived ? `${t.label}` : t.label)).join(', ')
                  : '—'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Feature groups / model versions</dt>
              <dd className="text-white/80">
                {exp.featureGroups.map((g) => g.label).join(' · ') || '—'}
                {exp.modelVersions.length ? (
                  <span className="block font-mono text-[11px] mt-1">
                    {exp.modelVersions.map((m) => `${m.id} (${m.role})`).join(', ')}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
          <ul className="text-xs text-muted-foreground space-y-1">
            {exp.splits.map((s) => (
              <li key={s.id}>
                <span className="text-white/80">{s.label}</span>
                {s.n != null ? ` · n=${fmtInt(s.n)}` : ''} —{' '}
                {s.kind === 'prospective_shadow' && (s.n ?? 0) === 0
                  ? 'Not started.'
                  : (SPLIT_KIND_COPY[s.kind] ?? s.note)}
              </li>
            ))}
          </ul>
          {exp.decisions.length ? (
            <div className="space-y-2">
              {exp.decisions.map((d) => (
                <div key={`${d.label}:${d.source}`} className="rounded-md border border-white/10 p-3">
                  <p className="text-xs font-medium text-white">{d.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{d.note}</p>
                  <p className="text-[11px] font-mono text-muted-foreground mt-1">{d.source}</p>
                </div>
              ))}
            </div>
          ) : null}
          {exp.historicalValidityClass === 'reconstructed_historical' ? (
            <p className="text-xs text-amber-200/90">
              Historical with/without scenarios are reconstructed. They are not predictive claims and are
              distinct from hypothetical scenario files.
            </p>
          ) : null}
          {exp.notesMarkdown ? (
            <pre className="whitespace-pre-wrap text-xs text-white/80 bg-black/20 rounded-md p-3 overflow-x-auto">
              {exp.notesMarkdown}
            </pre>
          ) : null}
          {exp.availabilityNotes.map((note) => (
            <p key={note} className="text-xs text-amber-200/90">
              {note}
            </p>
          ))}
        </LabCard>
        );
      })}
    </div>
  );
}
