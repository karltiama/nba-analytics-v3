import { METRIC_COPY } from '@/lib/model-lab/metric-copy';
import type { ExperimentRecord, SliceRow } from '@/lib/model-lab/types';
import { LabCard } from '@/components/admin/model-lab/LabCard';
import { fmtInt, fmtNum } from '@/components/admin/model-lab/format';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const FAMILIES: Array<{ id: string; title: string }> = [
  { id: 'limited_history', title: 'Limited history' },
  { id: 'minutes_change', title: 'Changing minutes' },
  { id: 'minutes_volume', title: 'Historical minutes volume' },
];

function SliceTable({ rows }: { rows: SliceRow[] }) {
  const modelIds = Array.from(new Set(rows.flatMap((r) => Object.keys(r.metricsByModel))));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Slice</TableHead>
          <TableHead className="text-right">N</TableHead>
          {modelIds.map((id) => (
            <TableHead key={id} className="text-right">
              {id} MAE
            </TableHead>
          ))}
          <TableHead>Paired Δ (if stored)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.label}</TableCell>
            <TableCell className="text-right font-mono text-[11px]">{fmtInt(row.n)}</TableCell>
            {modelIds.map((id) => (
              <TableCell key={id} className="text-right font-mono text-[11px]">
                {fmtNum(row.metricsByModel[id]?.mae ?? null)}
              </TableCell>
            ))}
            <TableCell className="text-[11px] text-muted-foreground">
              {row.pairedDelta
                ? `${row.pairedDelta.leftModelId}→${row.pairedDelta.rightModelId} ${fmtNum(row.pairedDelta.delta)} [${fmtNum(row.pairedDelta.ciLow)}, ${fmtNum(row.pairedDelta.ciHigh)}]`
                : 'No paired interval on this slice'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function PerformanceSlices({ catalog }: { catalog: ExperimentRecord[] }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        {METRIC_COPY.mae.plain} Slices use pregame reconstructed features only. Realized target minutes are not used.
        Intervals appear only when they were computed on the paired slice rows.
      </p>
      {catalog.map((exp) => (
        <LabCard key={exp.id} title={exp.title} badge={exp.slicesAvailable ? 'slices' : 'no slices'}>
          {!exp.slicesAvailable ? (
            <p className="text-sm text-amber-200">
              No stored slice table for limited history, changing minutes, or minutes volume on this experiment.
            </p>
          ) : (
            <div className="space-y-4">
              {FAMILIES.map((family) => {
                const rows = exp.slices.filter((s) => s.family === family.id);
                if (!rows.length) {
                  return (
                    <div key={family.id}>
                      <h3 className="text-xs font-medium text-white mb-1">{family.title}</h3>
                      <p className="text-xs text-muted-foreground">Not stored on this experiment.</p>
                    </div>
                  );
                }
                return (
                  <div key={family.id}>
                    <h3 className="text-xs font-medium text-white mb-2">{family.title}</h3>
                    <SliceTable rows={rows} />
                  </div>
                );
              })}
            </div>
          )}
        </LabCard>
      ))}
    </div>
  );
}
