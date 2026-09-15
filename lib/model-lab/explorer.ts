import { createReadStream, existsSync, openSync, readSync, closeSync, statSync } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';
import { artifactFile } from '@/lib/model-lab/adapters/common';
import { asNumber, asString, isRecord } from '@/lib/model-lab/fs';
import { getRegistryEntry } from '@/lib/model-lab/registry';
import { HISTORICAL_VALIDITY_NOTE } from '@/lib/model-lab/metric-copy';
import type { ExplorerDetail, ExplorerListResult, RegistryEntry } from '@/lib/model-lab/types';

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 25;

type IndexEntry = {
  playerId: string;
  gameId: string;
  gameDate: string | null;
  split: string;
  rowOffset: number;
  predOffset: number | null;
};

type IndexCache = {
  key: string;
  mtime: number;
  rows: IndexEntry[];
};

let cache: IndexCache | null = null;

function num(v: unknown): number | null {
  return asNumber(v);
}

function actualForTarget(row: Record<string, unknown>, targetId: string): number | null {
  if (targetId === 'points') return num(row.actual_pts);
  if (targetId === 'rebounds') return num(row.actual_reb);
  if (targetId === 'assists') return num(row.actual_ast);
  if (targetId === 'threes') return num(row.actual_threes);
  if (targetId === 'pra') return num(row.actual_pra);
  return null;
}

function predForTarget(row: Record<string, unknown>, modelId: string, targetId: string): number | null {
  const suffix =
    targetId === 'points'
      ? 'points'
      : targetId === 'rebounds'
        ? 'rebounds'
        : targetId === 'assists'
          ? 'assists'
          : targetId === 'threes'
            ? 'threes'
            : null;
  if (targetId === 'pra') {
    const p = predForTarget(row, modelId, 'points');
    const r = predForTarget(row, modelId, 'rebounds');
    const a = predForTarget(row, modelId, 'assists');
    if (p == null || r == null || a == null) return null;
    return p + r + a;
  }
  if (!suffix) return null;
  const mid = modelId.toLowerCase();
  if (mid === 'a') return num(row[`pred_a_${suffix}`]);
  if (mid === 'b') return num(row[`pred_b_${suffix}`]);
  if (mid === 'c') return num(row[`yhat_c_${suffix}`]);
  if (mid === 'd') return num(row[`yhat_d_${suffix}`]);
  return num(row[`yhat_${mid}_${suffix}`]) ?? num(row[`pred_${mid}_${suffix}`]);
}

function readLineAt(path: string, offset: number): string | null {
  const fd = openSync(path, 'r');
  try {
    const chunks: Buffer[] = [];
    let pos = offset;
    const buf = Buffer.alloc(4096);
    while (true) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      const slice = buf.subarray(0, n);
      const nl = slice.indexOf(0x0a);
      if (nl >= 0) {
        chunks.push(slice.subarray(0, nl));
        break;
      }
      chunks.push(Buffer.from(slice));
      pos += n;
    }
    if (!chunks.length) return null;
    return Buffer.concat(chunks).toString('utf8').replace(/\r$/, '');
  } finally {
    closeSync(fd);
  }
}

function parseLine(path: string, offset: number): Record<string, unknown> | null {
  const line = readLineAt(path, offset);
  if (!line?.trim()) return null;
  try {
    const v = JSON.parse(line) as unknown;
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

async function buildOffsetIndex(path: string): Promise<Map<string, number> | IndexEntry[]> {
  const isRows = path.endsWith('rows.jsonl');
  const predMap = new Map<string, number>();
  const rows: IndexEntry[] = [];
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let offset = 0;
  for await (const line of rl) {
    const start = offset;
    offset += Buffer.byteLength(line, 'utf8') + 1;
    if (!line.trim()) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const playerId = asString(parsed.player_id);
    const gameId = asString(parsed.game_id);
    if (!playerId || !gameId) continue;
    if (isRows) {
      if (parsed.common_eligible === false) continue;
      rows.push({
        playerId,
        gameId,
        gameDate: asString(parsed.basketball_date) ?? asString(parsed.start_time),
        split: asString(parsed.split) ?? '',
        rowOffset: start,
        predOffset: null,
      });
    } else {
      predMap.set(`${playerId}|${gameId}`, start);
    }
  }
  return isRows ? rows : predMap;
}

async function loadIndex(entry: RegistryEntry): Promise<{
  available: boolean;
  reason: string | null;
  rowsPath: string;
  predPath: string | null;
  rows: IndexEntry[];
}> {
  const rowsRel = artifactFile(entry, entry.rowsFile);
  if (!rowsRel || !existsSync(rowsRel)) {
    return {
      available: false,
      reason: 'Row-level artifacts are not on this host (rows.jsonl missing). Aggregate comparisons remain usable.',
      rowsPath: rowsRel ?? '',
      predPath: null,
      rows: [],
    };
  }
  const predRel = artifactFile(entry, entry.predictionsFile);
  const predPath = predRel && existsSync(predRel) ? predRel : null;
  const mtime = statSync(rowsRel).mtimeMs + (predPath ? statSync(predPath).mtimeMs : 0);
  const key = `${rowsRel}|${predPath ?? ''}`;
  if (cache && cache.key === key && cache.mtime === mtime) {
    return { available: true, reason: predPath ? null : 'predictions.jsonl missing; C/D predictions unavailable.', rowsPath: rowsRel, predPath, rows: cache.rows };
  }

  const rows = (await buildOffsetIndex(rowsRel)) as IndexEntry[];
  if (predPath) {
    const predMap = (await buildOffsetIndex(predPath)) as Map<string, number>;
    for (const row of rows) {
      row.predOffset = predMap.get(`${row.playerId}|${row.gameId}`) ?? null;
    }
  }
  cache = { key, mtime, rows };
  return {
    available: true,
    reason: predPath ? null : 'predictions.jsonl missing; C/D predictions unavailable.',
    rowsPath: rowsRel,
    predPath,
    rows,
  };
}

export type ExplorerQuery = {
  experimentId: string;
  playerId?: string;
  gameDate?: string;
  split?: string;
  targetId?: string;
  baselineModelId?: string;
  learnedModelId?: string;
  page?: number;
  pageSize?: number;
};

export async function queryExplorer(q: ExplorerQuery): Promise<ExplorerListResult> {
  const entry = getRegistryEntry(q.experimentId);
  if (!entry) {
    return {
      available: false,
      reason: 'Unknown experiment.',
      experimentId: q.experimentId,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      total: 0,
      hasMore: false,
      rows: [],
    };
  }
  return queryExplorerForEntry(entry, q);
}

export async function queryExplorerForEntry(
  entry: RegistryEntry,
  q: ExplorerQuery
): Promise<ExplorerListResult> {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, q.pageSize ?? DEFAULT_PAGE_SIZE));
  const page = Math.max(1, q.page ?? 1);
  const index = await loadIndex(entry);
  if (!index.available) {
    return {
      available: false,
      reason: index.reason,
      experimentId: q.experimentId,
      page,
      pageSize,
      total: 0,
      hasMore: false,
      rows: [],
    };
  }

  const playerQ = q.playerId?.trim().toLowerCase() ?? '';
  const dateQ = q.gameDate?.trim() ?? '';
  const splitQ = q.split?.trim() ?? '';
  const targetId = q.targetId?.trim() || 'points';
  const baselineModelId = q.baselineModelId?.trim() || 'A';
  const learnedModelId = q.learnedModelId?.trim() || 'C';

  const filtered = index.rows.filter((row) => {
    if (playerQ && !row.playerId.toLowerCase().includes(playerQ) && !row.gameId.toLowerCase().includes(playerQ)) {
      return false;
    }
    if (dateQ && !(row.gameDate ?? '').startsWith(dateQ)) return false;
    if (splitQ && row.split !== splitQ) return false;
    return true;
  });

  const start = (page - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);
  const outRows = slice.map((entryRow) => {
    const raw = parseLine(index.rowsPath, entryRow.rowOffset) ?? {};
    const pred =
      index.predPath && entryRow.predOffset != null ? parseLine(index.predPath, entryRow.predOffset) : null;
    const merged = pred ? { ...raw, ...pred } : raw;
    const baselinePrediction = predForTarget(merged, baselineModelId, targetId);
    const learnedPrediction = predForTarget(merged, learnedModelId, targetId);
    const actual = actualForTarget(merged, targetId);
    return {
      playerId: entryRow.playerId,
      gameId: entryRow.gameId,
      gameDate: entryRow.gameDate,
      split: entryRow.split,
      targetId,
      baselineModelId,
      learnedModelId,
      baselinePrediction,
      learnedPrediction,
      actual,
      error: learnedPrediction != null && actual != null ? learnedPrediction - actual : null,
    };
  });

  return {
    available: true,
    reason: index.reason,
    experimentId: q.experimentId,
    page,
    pageSize,
    total: filtered.length,
    hasMore: start + pageSize < filtered.length,
    rows: outRows,
  };
}

export async function loadExplorerDetail(args: {
  experimentId: string;
  playerId: string;
  gameId: string;
}): Promise<ExplorerDetail> {
  const unavailable = (reason: string): ExplorerDetail => ({
    available: false,
    reason,
    playerId: args.playerId,
    gameId: args.gameId,
    gameDate: null,
    split: '',
    historicalValidityClass: null,
    commonEligible: null,
    minutesChangeBucket: null,
    volumeBucket: null,
    limitedHistory: null,
    predictions: [],
    features: [],
    featureNote: HISTORICAL_VALIDITY_NOTE,
  });

  const entry = getRegistryEntry(args.experimentId);
  if (!entry) return unavailable('Unknown experiment.');
  return loadExplorerDetailForEntry(entry, args);
}

export async function loadExplorerDetailForEntry(
  entry: RegistryEntry,
  args: { experimentId: string; playerId: string; gameId: string }
): Promise<ExplorerDetail> {
  const unavailable = (reason: string): ExplorerDetail => ({
    available: false,
    reason,
    playerId: args.playerId,
    gameId: args.gameId,
    gameDate: null,
    split: '',
    historicalValidityClass: null,
    commonEligible: null,
    minutesChangeBucket: null,
    volumeBucket: null,
    limitedHistory: null,
    predictions: [],
    features: [],
    featureNote: HISTORICAL_VALIDITY_NOTE,
  });
  const index = await loadIndex(entry);
  if (!index.available) return unavailable(index.reason ?? 'Row artifacts unavailable.');

  const hit = index.rows.find((r) => r.playerId === args.playerId && r.gameId === args.gameId);
  if (!hit) return unavailable('No matching player-game in the local row file.');

  const raw = parseLine(index.rowsPath, hit.rowOffset);
  if (!raw) return unavailable('Could not read the selected row.');
  const pred =
    index.predPath && hit.predOffset != null ? parseLine(index.predPath, hit.predOffset) : null;
  const merged = pred ? { ...raw, ...pred } : raw;

  const targets = ['points', 'rebounds', 'assists', 'threes', 'pra'] as const;
  const models = [
    { id: 'A', label: 'A (Track A baseline)' },
    { id: 'B', label: 'B (minutes baseline)' },
    { id: 'C', label: 'C (learned)' },
    { id: 'D', label: 'D (learned + context)' },
  ];
  const predictions = [];
  for (const model of models) {
    for (const targetId of targets) {
      const predicted = predForTarget(merged, model.id, targetId);
      const actual = actualForTarget(merged, targetId);
      predictions.push({
        modelId: model.id,
        label: model.label,
        targetId,
        predicted,
        actual,
        error: predicted != null && actual != null ? predicted - actual : null,
      });
    }
  }

  const features: ExplorerDetail['features'] = [];
  if (isRecord(raw.features_c)) {
    for (const [name, value] of Object.entries(raw.features_c)) {
      features.push({ name, value: num(value), group: 'C' });
    }
  }
  if (isRecord(raw.features_d_extra)) {
    for (const [name, value] of Object.entries(raw.features_d_extra)) {
      features.push({ name, value: num(value), group: 'D extra' });
    }
  }

  return {
    available: true,
    reason: index.reason,
    playerId: hit.playerId,
    gameId: hit.gameId,
    gameDate: hit.gameDate,
    split: hit.split,
    historicalValidityClass: asString(raw.historical_validity_class),
    commonEligible: raw.common_eligible === true,
    minutesChangeBucket: asString(raw.minutes_change_bucket),
    volumeBucket: asString(raw.volume_bucket),
    limitedHistory: raw.limited_history === 1 || raw.limited_history === true,
    predictions,
    features,
    featureNote: HISTORICAL_VALIDITY_NOTE,
  };
}

export function explorerMaxPageSize(): number {
  return MAX_PAGE_SIZE;
}

export function resetExplorerCache(): void {
  cache = null;
}

export function explorerFixtureDir(dir: string): RegistryEntry {
  return {
    id: 'fixture',
    adapter: 'learned-r1',
    title: 'fixture',
    artifactDir: dir,
    notesRelPath: join(dir, 'notes.md'),
    rowsFile: 'rows.jsonl',
    predictionsFile: 'predictions.jsonl',
  };
}
