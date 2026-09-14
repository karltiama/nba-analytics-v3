import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BackfillRun, CheckpointUnit, OwlsGameAcquisition, OwlsUnitStatus } from './types';

export type CheckpointStore = {
  load(runId: string): Promise<CheckpointState | null>;
  save(state: CheckpointState): Promise<void>;
};

export type CheckpointState = {
  run: BackfillRun;
  units: Record<string, CheckpointUnit>;
  game_acquisition?: Record<string, OwlsGameAcquisition>;
};

export class MemoryCheckpointStore implements CheckpointStore {
  readonly byRun = new Map<string, CheckpointState>();

  async load(runId: string): Promise<CheckpointState | null> {
    const state = this.byRun.get(runId);
    return state ? structuredClone(state) : null;
  }

  async save(state: CheckpointState): Promise<void> {
    this.byRun.set(state.run.run_id, structuredClone(state));
  }
}

export class FileCheckpointStore implements CheckpointStore {
  constructor(private readonly rootDir: string) {}

  private fileFor(runId: string): string {
    return path.join(this.rootDir, runId, 'checkpoint.json');
  }

  async load(runId: string): Promise<CheckpointState | null> {
    try {
      const text = await readFile(this.fileFor(runId), 'utf8');
      return JSON.parse(text) as CheckpointState;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(state: CheckpointState): Promise<void> {
    const file = this.fileFor(state.run.run_id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }
}

export function emptyRun(args: {
  runId: string;
  phase: number;
  mode: BackfillRun['mode'];
  targetSeasons: string[];
  endpoint: BackfillRun['endpoint'];
  startedAt?: string;
}): BackfillRun {
  return {
    run_id: args.runId,
    started_at: args.startedAt ?? new Date().toISOString(),
    completed_at: null,
    phase: args.phase,
    mode: args.mode,
    target_seasons: args.targetSeasons,
    endpoint: args.endpoint,
    games_attempted: 0,
    games_completed: 0,
    requests_attempted: 0,
    requests_successful: 0,
    requests_retried: 0,
    status_429: 0,
    status_503: 0,
    rows: 0,
    failures: 0,
    s3_objects: 0,
    mapping_matched: 0,
    mapping_ambiguous: 0,
    mapping_unmatched: 0,
  };
}

export function unitId(args: {
  endpoint: string;
  providerGameId: string | null;
  pageIndex: number;
  offset: number;
}): string {
  return `${args.endpoint}|${args.providerGameId ?? 'none'}|page=${args.pageIndex}|offset=${args.offset}`;
}

export function upsertUnit(state: CheckpointState, unit: CheckpointUnit): void {
  state.units[unit.unit_id] = unit;
}

export function isArchived(unit: CheckpointUnit | undefined): boolean {
  return unit?.status === 'ARCHIVED' || unit?.status === 'NORMALIZED';
}

export function makeUnit(partial: Omit<CheckpointUnit, 'updated_at'> & { updatedAt?: string }): CheckpointUnit {
  return { ...partial, updated_at: partial.updatedAt ?? new Date().toISOString() };
}

export const TERMINAL_SKIP_STATUSES: OwlsUnitStatus[] = ['ARCHIVED', 'NORMALIZED', 'SKIPPED'];
