'use client';

import { useMemo, useState } from 'react';
import { METRIC_COPY, SPLIT_KIND_COPY } from '@/lib/model-lab/metric-copy';
import { compareExperiments } from '@/lib/model-lab/compare';
import type { ComparePointer, ExperimentRecord } from '@/lib/model-lab/types';
import { LabCard } from '@/components/admin/model-lab/LabCard';
import { fmtInt, fmtNum } from '@/components/admin/model-lab/format';

const selectClass =
  'w-full rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white';

function firstPointer(catalog: ExperimentRecord[], preferModel?: string): ComparePointer | null {
  const exp = catalog.find((e) => e.metrics.length > 0) ?? catalog[0];
  if (!exp) return null;
  const split = exp.splits.find((s) => s.kind === 'selection') ?? exp.splits[0];
  const target = exp.targets.find((t) => t.id === 'points') ?? exp.targets[0];
  const model =
    exp.modelVersions.find((m) => m.id === preferModel) ??
    exp.modelVersions.find((m) => m.role === 'baseline') ??
    exp.modelVersions[0];
  if (!split || !target || !model) return null;
  return { experimentId: exp.id, modelId: model.id, splitId: split.id, targetId: target.id };
}

function SideFields({
  id,
  catalog,
  value,
  onChange,
}: {
  id: string;
  catalog: ExperimentRecord[];
  value: ComparePointer;
  onChange: (next: ComparePointer) => void;
}) {
  const exp = catalog.find((e) => e.id === value.experimentId) ?? catalog[0];
  return (
    <div className="grid gap-2">
      <label className="text-[11px] text-muted-foreground">
        Experiment
        <select
          className={`${selectClass} mt-1`}
          value={value.experimentId}
          onChange={(e) => {
            const next = catalog.find((x) => x.id === e.target.value);
            const split = next?.splits.find((s) => s.id === value.splitId) ?? next?.splits[0];
            const target = next?.targets.find((t) => t.id === value.targetId) ?? next?.targets[0];
            const model = next?.modelVersions.find((m) => m.id === value.modelId) ?? next?.modelVersions[0];
            if (!next || !split || !target || !model) return;
            onChange({ experimentId: next.id, splitId: split.id, targetId: target.id, modelId: model.id });
          }}
        >
          {catalog.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[11px] text-muted-foreground">
        Model version
        <select
          className={`${selectClass} mt-1`}
          value={value.modelId}
          onChange={(e) => onChange({ ...value, modelId: e.target.value })}
        >
          {(exp?.modelVersions ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[11px] text-muted-foreground">
        Split
        <select
          className={`${selectClass} mt-1`}
          value={value.splitId}
          onChange={(e) => onChange({ ...value, splitId: e.target.value })}
        >
          {(exp?.splits ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[11px] text-muted-foreground">
        Target
        <select
          className={`${selectClass} mt-1`}
          value={value.targetId}
          onChange={(e) => onChange({ ...value, targetId: e.target.value })}
        >
          {(exp?.targets ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
              {t.derived ? ' (derived)' : ''}
            </option>
          ))}
        </select>
      </label>
      <p className="sr-only">{id}</p>
    </div>
  );
}

function MetricBlock({
  title,
  n,
  mae,
  rmse,
  bias,
  coverage,
}: {
  title: string;
  n: number | null | undefined;
  mae: number | null | undefined;
  rmse: number | null | undefined;
  bias: number | null | undefined;
  coverage: number | null | undefined;
}) {
  return (
    <div className="rounded-md border border-white/10 p-3 space-y-1">
      <p className="text-xs font-medium text-white">{title}</p>
      <p className="text-xs text-white/80">
        {METRIC_COPY.mae.name} {fmtNum(mae)} · {METRIC_COPY.n.name} {fmtInt(n ?? null)}
      </p>
      <p className="text-xs text-white/80">
        {METRIC_COPY.rmse.name} {fmtNum(rmse)} · {METRIC_COPY.bias.name} {fmtNum(bias)} · coverage{' '}
        {fmtNum(coverage, 3)}
      </p>
    </div>
  );
}

export function ExperimentCompare({ catalog }: { catalog: ExperimentRecord[] }) {
  const leftDefault = firstPointer(catalog, 'A') ?? firstPointer(catalog);
  const rightDefault = firstPointer(catalog, 'C') ?? firstPointer(catalog);
  const [left, setLeft] = useState<ComparePointer | null>(leftDefault);
  const [right, setRight] = useState<ComparePointer | null>(rightDefault);

  const comparison = useMemo(() => {
    if (!left || !right) return null;
    return compareExperiments(catalog, left, right);
  }, [catalog, left, right]);

  if (!left || !right) {
    return <p className="text-sm text-muted-foreground">No comparable experiment records are loaded.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        {METRIC_COPY.mae.plain} {METRIC_COPY.rmse.plain} {METRIC_COPY.bias.plain} {METRIC_COPY.coverage.plain}{' '}
        {METRIC_COPY.pairedDelta.plain}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <LabCard title="Left">
          <SideFields id="left" catalog={catalog} value={left} onChange={setLeft} />
        </LabCard>
        <LabCard title="Right">
          <SideFields id="right" catalog={catalog} value={right} onChange={setRight} />
        </LabCard>
      </div>
      {comparison ? (
        <LabCard title="Result" badge={comparison.compatible ? 'comparable' : 'incompatible'}>
          <div className="space-y-2">
            {comparison.flags.map((f) => (
              <p
                key={f.message}
                className={
                  f.level === 'incompatible'
                    ? 'text-xs text-red-300'
                    : f.level === 'warning'
                      ? 'text-xs text-amber-200'
                      : 'text-xs text-muted-foreground'
                }
              >
                {f.level}: {f.message}
              </p>
            ))}
          </div>
          {comparison.left && comparison.right ? (
            <div className="grid gap-3 md:grid-cols-2 mt-2">
              <MetricBlock
                title={`${comparison.left.modelLabel} · ${comparison.left.split.label} · ${comparison.left.target.label}`}
                n={comparison.left.metrics?.n}
                mae={comparison.left.metrics?.mae}
                rmse={comparison.left.metrics?.rmse}
                bias={comparison.left.metrics?.bias}
                coverage={comparison.left.metrics?.coverage}
              />
              <MetricBlock
                title={`${comparison.right.modelLabel} · ${comparison.right.split.label} · ${comparison.right.target.label}`}
                n={comparison.right.metrics?.n}
                mae={comparison.right.metrics?.mae}
                rmse={comparison.right.metrics?.rmse}
                bias={comparison.right.metrics?.bias}
                coverage={comparison.right.metrics?.coverage}
              />
            </div>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            Units: {comparison.left?.target.units ?? '—'} · {SPLIT_KIND_COPY[comparison.left?.split.kind ?? ''] ?? ''}
          </p>
          {comparison.compatible && comparison.pairedDelta ? (
            <p className="text-xs text-white/90">
              Paired ΔMAE {fmtNum(comparison.pairedDelta.delta)} (95% CI {fmtNum(comparison.pairedDelta.ciLow)},{' '}
              {fmtNum(comparison.pairedDelta.ciHigh)}) on n={fmtInt(comparison.pairedDelta.n)} paired observations
              {comparison.pairedDelta.nGroups != null ? ` · ${comparison.pairedDelta.nGroups} date groups` : ''}.
            </p>
          ) : comparison.compatible && comparison.unpairedMaeDifference != null ? (
            <p className="text-xs text-amber-200">
              Unpaired MAE difference {fmtNum(comparison.unpairedMaeDifference)} (right − left). No paired interval —
              this was not computed from corresponding paired observations.
            </p>
          ) : comparison.compatible ? (
            <p className="text-xs text-muted-foreground">No numeric MAE on both sides to compare.</p>
          ) : (
            <p className="text-xs text-red-300">
              Differences are shown for inspection only. They are not an apples-to-apples result.
            </p>
          )}
        </LabCard>
      ) : null}
    </div>
  );
}
