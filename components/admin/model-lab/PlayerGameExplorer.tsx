'use client';

import { useEffect, useState } from 'react';
import { HISTORICAL_VALIDITY_NOTE, METRIC_COPY } from '@/lib/model-lab/metric-copy';
import type { ExperimentRecord, ExplorerDetail, ExplorerListResult } from '@/lib/model-lab/types';
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

const inputClass =
  'rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white';

export function PlayerGameExplorer({ catalog }: { catalog: ExperimentRecord[] }) {
  const explorers = catalog.filter((e) => e.rowExplorerAvailable);
  const fallback = catalog[0];
  const [experimentId, setExperimentId] = useState(explorers[0]?.id ?? fallback?.id ?? '');
  const [player, setPlayer] = useState('');
  const [date, setDate] = useState('');
  const [split, setSplit] = useState('');
  const [target, setTarget] = useState('points');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ExplorerListResult | null>(null);
  const [detail, setDetail] = useState<ExplorerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selected = catalog.find((e) => e.id === experimentId);

  useEffect(() => {
    if (!experimentId) return;
    if (!selected?.rowExplorerAvailable) {
      setList({
        available: false,
        reason:
          selected?.availabilityNotes.find((n) => n.toLowerCase().includes('row')) ??
          'Row-level artifacts are not on this host. Aggregate comparisons remain usable.',
        experimentId,
        page: 1,
        pageSize: 25,
        total: 0,
        hasMore: false,
        rows: [],
      });
      return;
    }
    const params = new URLSearchParams({
      experiment: experimentId,
      page: String(page),
      pageSize: '25',
      target,
      baseline: 'A',
      learned: 'C',
    });
    if (player.trim()) params.set('player', player.trim());
    if (date.trim()) params.set('date', date.trim());
    if (split.trim()) params.set('split', split === 'selection' ? 'validation' : split === 'historical_confirmation' ? 'test' : split === 'training' ? 'train' : split);
    setLoading(true);
    setError(null);
    fetch(`/api/admin/model-lab/explorer?${params.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as ExplorerListResult & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setList(body);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Explorer failed'))
      .finally(() => setLoading(false));
  }, [experimentId, player, date, split, target, page, selected?.rowExplorerAvailable, selected?.availabilityNotes]);

  function openRow(playerId: string, gameId: string) {
    const params = new URLSearchParams({ experiment: experimentId, player: playerId, game: gameId });
    fetch(`/api/admin/model-lab/explorer/row?${params.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as ExplorerDetail & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setDetail(body);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Detail failed'));
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        Baseline vs learned predictions for one player-game. {METRIC_COPY.mae.plain} Error = prediction − actual.{' '}
        {HISTORICAL_VALIDITY_NOTE} Full row files stay on the server.
      </p>
      <LabCard title="Filters">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-[11px] text-muted-foreground">
            Experiment
            <select
              className={`${inputClass} mt-1 w-full`}
              value={experimentId}
              onChange={(e) => {
                setExperimentId(e.target.value);
                setPage(1);
                setDetail(null);
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
            Player or game id
            <input
              className={`${inputClass} mt-1 w-full`}
              value={player}
              onChange={(e) => {
                setPlayer(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Game date (prefix)
            <input
              className={`${inputClass} mt-1 w-full`}
              placeholder="2024-12-01"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Split
            <select
              className={`${inputClass} mt-1 w-full`}
              value={split}
              onChange={(e) => {
                setSplit(e.target.value);
                setPage(1);
              }}
            >
              <option value="">all splits</option>
              <option value="training">training</option>
              <option value="selection">selection (2024)</option>
              <option value="historical_confirmation">historical confirmation (2025)</option>
            </select>
          </label>
          <label className="text-[11px] text-muted-foreground">
            Target
            <select
              className={`${inputClass} mt-1 w-full`}
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setPage(1);
              }}
            >
              {(selected?.targets ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </LabCard>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      {list && !list.available ? (
        <LabCard title="Explorer unavailable" badge="unavailable">
          <p className="text-sm text-amber-200">{list.reason}</p>
        </LabCard>
      ) : (
        <LabCard title="Player / game rows" badge={loading ? 'loading' : `${fmtInt(list?.total ?? 0)} rows`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead>Game date</TableHead>
                <TableHead>Split</TableHead>
                <TableHead className="text-right">Baseline</TableHead>
                <TableHead className="text-right">Learned</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list?.rows ?? []).map((row) => (
                <TableRow
                  key={`${row.playerId}|${row.gameId}`}
                  className="cursor-pointer"
                  onClick={() => openRow(row.playerId, row.gameId)}
                >
                  <TableCell className="font-mono text-[11px]">{row.playerId}</TableCell>
                  <TableCell className="font-mono text-[11px]">{row.gameDate ?? '—'}</TableCell>
                  <TableCell>{row.split}</TableCell>
                  <TableCell className="text-right font-mono text-[11px]">{fmtNum(row.baselinePrediction)}</TableCell>
                  <TableCell className="text-right font-mono text-[11px]">{fmtNum(row.learnedPrediction)}</TableCell>
                  <TableCell className="text-right font-mono text-[11px]">{fmtNum(row.actual, 2)}</TableCell>
                  <TableCell className="text-right font-mono text-[11px]">{fmtNum(row.error)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              className="rounded border border-white/15 px-2 py-1 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span>
              Page {page}
              {list?.hasMore ? ' · more available' : ''}
            </span>
            <button
              type="button"
              className="rounded border border-white/15 px-2 py-1 disabled:opacity-40"
              disabled={!list?.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </LabCard>
      )}
      {detail ? (
        <LabCard title={`Detail ${detail.playerId} @ ${detail.gameDate ?? detail.gameId}`} badge={detail.available ? 'row' : 'unavailable'}>
          {!detail.available ? (
            <p className="text-sm text-amber-200">{detail.reason}</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Split {detail.split} · common eligible {detail.commonEligible ? 'yes' : 'no'} · minutes{' '}
                {detail.minutesChangeBucket ?? '—'} · volume {detail.volumeBucket ?? '—'} · limited history{' '}
                {detail.limitedHistory ? 'yes' : 'no'}
              </p>
              <p className="text-xs text-muted-foreground">{detail.featureNote}</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="text-right">Prediction</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.predictions
                    .filter((p) => p.targetId === target)
                    .map((p) => (
                      <TableRow key={`${p.modelId}|${p.targetId}`}>
                        <TableCell>{p.label}</TableCell>
                        <TableCell>{p.targetId === 'pra' ? 'PRA (derived)' : p.targetId}</TableCell>
                        <TableCell className="text-right font-mono text-[11px]">{fmtNum(p.predicted)}</TableCell>
                        <TableCell className="text-right font-mono text-[11px]">{fmtNum(p.actual, 2)}</TableCell>
                        <TableCell className="text-right font-mono text-[11px]">{fmtNum(p.error)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              <div>
                <h3 className="text-xs font-medium text-white mb-2">Input features on this row</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1 max-h-64 overflow-auto">
                  {detail.features.map((f) => (
                    <p key={`${f.group}|${f.name}`} className="font-mono text-[11px] text-white/80">
                      {f.group} {f.name}: {fmtNum(f.value, 3)}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </LabCard>
      ) : null}
    </div>
  );
}
