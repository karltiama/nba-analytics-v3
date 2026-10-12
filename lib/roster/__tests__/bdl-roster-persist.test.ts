import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CURRENT_NBA_ABBREVIATIONS, type ActiveRosterPlayer } from '@/lib/roster/bdl-active-roster';
import {
  decideBdlRosterPersistence,
  persistBdlRosterObservation,
  plannedBdlWriteTargets,
  previewBdlRosterWrite,
  type RosterQueryClient,
} from '@/lib/roster/bdl-roster-persist';

function league(): ActiveRosterPlayer[] {
  const players: ActiveRosterPlayer[] = [];
  let id = 1;
  CURRENT_NBA_ABBREVIATIONS.forEach((abbreviation, index) => {
    for (let slot = 0; slot < 15; slot += 1) {
      players.push({
        providerPlayerId: String(id),
        providerTeamId: String(100 + index),
        teamAbbreviation: abbreviation,
      });
      id += 1;
    }
  });
  return players;
}

type StoredBatch = { collectedAt: string; batchId: string; players: ActiveRosterPlayer[] };

function memoryClient(options?: { failMembers?: boolean }): RosterQueryClient & { batches: StoredBatch[]; sql: string[] } {
  const batches: StoredBatch[] = [];
  const sql: string[] = [];
  let pending: StoredBatch | null = null;
  let open = false;
  return {
    batches,
    sql,
    async query(text: string, params?: unknown[]) {
      const head = text.trim().split(/\s+/)[0] ?? text;
      sql.push(head);
      if (text === 'BEGIN') {
        open = true;
        pending = null;
        return { rows: [] };
      }
      if (text === 'ROLLBACK') {
        open = false;
        pending = null;
        return { rows: [] };
      }
      if (text === 'COMMIT') {
        if (pending) batches.push(pending);
        pending = null;
        open = false;
        return { rows: [] };
      }
      if (text.startsWith('SELECT batch_id')) {
        const collectedAt = String(params?.[1]);
        const found = batches.find((batch) => batch.collectedAt === collectedAt);
        return { rows: found ? [{ batch_id: found.batchId }] : [] };
      }
      if (text.startsWith('SELECT provider_player_id')) {
        const batch = batches.find((item) => item.batchId === params?.[0]);
        return {
          rows: (batch?.players ?? []).map((player) => ({
            provider_player_id: player.providerPlayerId,
            provider_team_id: player.providerTeamId,
            team_abbreviation: player.teamAbbreviation,
          })),
        };
      }
      if (text.startsWith('INSERT INTO raw.roster_observation_batches')) {
        pending = {
          collectedAt: String(params?.[3]),
          batchId: String(params?.[0]),
          players: [],
        };
        return { rows: [] };
      }
      if (text.startsWith('INSERT INTO raw.roster_observation_members')) {
        if (options?.failMembers) throw new Error('member insert failed');
        const ids = params?.[2] as string[];
        const teams = params?.[3] as string[];
        const abbreviations = params?.[4] as string[];
        if (!pending) throw new Error('members inserted outside a batch');
        pending.players = ids.map((playerId, index) => ({
          providerPlayerId: playerId,
          providerTeamId: teams[index]!,
          teamAbbreviation: abbreviations[index]!,
        }));
        return { rows: [] };
      }
      if (!open && head !== 'SELECT') throw new Error(`unexpected sql ${head}`);
      throw new Error(`unhandled sql ${head}`);
    },
  };
}

const collectedAt = '2026-10-12T00:27:56.640Z';
const laterSameDay = '2026-10-12T00:46:08.747Z';

function writeInput(players: ActiveRosterPlayer[], at = collectedAt) {
  const sizes = CURRENT_NBA_ABBREVIATIONS.map((abbreviation) => players.filter((player) => player.teamAbbreviation === abbreviation).length);
  return {
    collectedAt: at,
    seasonLabel: '2026-27',
    requestCount: 5,
    pageCount: 5,
    players,
    minTeamSize: Math.min(...sizes),
    maxTeamSize: Math.max(...sizes),
  };
}

describe('BallDontLie roster persistence', () => {
  it('does not call the database on a dry-run', async () => {
    const decision = decideBdlRosterPersistence({ apply: false, validationOk: true });
    expect(plannedBdlWriteTargets(decision)).toEqual([]);
    const client = memoryClient();
    client.query = async () => {
      throw new Error('dry-run queried the database');
    };
    const result = await persistBdlRosterObservation(client, decision, writeInput(league()));
    expect(result).toMatchObject({ written: false, reason: 'dry_run' });
    expect(previewBdlRosterWrite({ collectedAt, players: league(), decision })?.targets).toEqual([]);
  });

  it('blocks apply when validation failed', async () => {
    const decision = decideBdlRosterPersistence({ apply: true, validationOk: false });
    expect(decision.reason).toBe('blocked');
    const client = memoryClient();
    client.query = async () => {
      throw new Error('blocked apply queried the database');
    };
    const result = await persistBdlRosterObservation(client, decision, writeInput(league()));
    expect(result).toMatchObject({ written: false, reason: 'blocked' });
  });

  it('rolls back when a member insert fails and leaves no completed batch', async () => {
    const client = memoryClient({ failMembers: true });
    const decision = decideBdlRosterPersistence({ apply: true, validationOk: true });
    await expect(persistBdlRosterObservation(client, decision, writeInput(league()))).rejects.toThrow('member insert failed');
    expect(client.sql).toContain('ROLLBACK');
    expect(client.batches).toHaveLength(0);
  });

  it('stores a validated batch once and treats the same observation as already stored', async () => {
    const client = memoryClient();
    const decision = decideBdlRosterPersistence({ apply: true, validationOk: true });
    const players = league();
    const first = await persistBdlRosterObservation(client, decision, writeInput(players));
    const second = await persistBdlRosterObservation(client, decision, writeInput(players));
    expect(first).toMatchObject({ written: true, reason: 'apply' });
    expect(second).toMatchObject({ written: false, reason: 'already_stored', batchId: first.written ? first.batchId : '' });
    expect(client.batches).toHaveLength(1);
    expect(client.batches[0]?.players).toHaveLength(450);
  });

  it('keeps two observations from the same UTC date and does not change the earlier one', async () => {
    const client = memoryClient();
    const decision = decideBdlRosterPersistence({ apply: true, validationOk: true });
    const firstPlayers = league();
    const secondPlayers = league().map((player) => ({ ...player, providerPlayerId: String(Number(player.providerPlayerId) + 1000) }));
    const first = await persistBdlRosterObservation(client, decision, writeInput(firstPlayers, collectedAt));
    const second = await persistBdlRosterObservation(client, decision, writeInput(secondPlayers, laterSameDay));
    expect(first.written).toBe(true);
    expect(second.written).toBe(true);
    expect(client.batches.map((batch) => batch.collectedAt)).toEqual([collectedAt, laterSameDay]);
    expect(client.batches[0]?.players[0]?.providerPlayerId).toBe('1');
    expect(client.sql.join('\n')).not.toMatch(/DELETE|UPDATE/i);
  });

  it('refuses to replace an existing observation with different membership', async () => {
    const client = memoryClient();
    const decision = decideBdlRosterPersistence({ apply: true, validationOk: true });
    await persistBdlRosterObservation(client, decision, writeInput(league()));
    const other = league().map((player) => ({ ...player, providerPlayerId: String(Number(player.providerPlayerId) + 5000) }));
    const result = await persistBdlRosterObservation(client, decision, writeInput(other));
    expect(result).toMatchObject({ written: false, reason: 'conflict_existing' });
    expect(client.batches).toHaveLength(1);
    expect(client.batches[0]?.players[0]?.providerPlayerId).toBe('1');
  });

  it('does not mention stint, analytics, or NBA.com snapshot writes', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/roster/bdl-roster-persist.ts'), 'utf8');
    expect(source).not.toMatch(/INSERT INTO analytics\./);
    expect(source).not.toMatch(/UPDATE analytics\./);
    expect(source).not.toMatch(/DELETE FROM analytics\./);
    expect(source).not.toMatch(/INSERT INTO raw\.nba_roster_snapshots/);
    expect(source).not.toMatch(/INSERT INTO analytics\.player_team_stints/);
    expect(source).not.toMatch(/UPDATE analytics\.player_team_stints/);
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts/roster/collect-bdl-active-rosters.ts'), 'utf8');
    expect(script).toContain('fetchBdlLive');
    expect(script).toContain("BDL_RATE_LIMIT_MAX_RETRIES: '0'");
    expect(script).not.toMatch(/INSERT INTO analytics\./);
  });
});
