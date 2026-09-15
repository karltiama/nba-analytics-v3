import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  explorerFixtureDir,
  loadExplorerDetailForEntry,
  queryExplorer,
  queryExplorerForEntry,
  resetExplorerCache,
} from '@/lib/model-lab/explorer';

const dir = join(tmpdir(), `model-lab-explorer-${process.pid}`);

function writeFixture() {
  mkdirSync(dir, { recursive: true });
  const rows = [
    {
      player_id: 'p1',
      game_id: 'g1',
      basketball_date: '2024-11-01',
      split: 'validation',
      common_eligible: true,
      pred_a_points: 20,
      actual_pts: 18,
      actual_reb: 5,
      actual_ast: 4,
      actual_pra: 27,
      features_c: { pts_l5: 19.2 },
    },
    {
      player_id: 'p2',
      game_id: 'g2',
      basketball_date: '2024-11-02',
      split: 'validation',
      common_eligible: true,
      pred_a_points: 10,
      actual_pts: 12,
    },
    {
      player_id: 'p3',
      game_id: 'g3',
      basketball_date: '2025-01-01',
      split: 'test',
      common_eligible: true,
      pred_a_points: 8,
      actual_pts: 9,
    },
  ];
  writeFileSync(join(dir, 'rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(
    join(dir, 'predictions.jsonl'),
    [
      JSON.stringify({ player_id: 'p1', game_id: 'g1', yhat_c_points: 19 }),
      JSON.stringify({ player_id: 'p2', game_id: 'g2', yhat_c_points: 11 }),
      JSON.stringify({ player_id: 'p3', game_id: 'g3', yhat_c_points: 7 }),
    ].join('\n') + '\n'
  );
}

describe('explorer pagination', () => {
  afterEach(() => {
    resetExplorerCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it('pages server-side and does not require the full dataset in the result', async () => {
    writeFixture();
    const entry = explorerFixtureDir(dir);
    const page1 = await queryExplorerForEntry(entry, {
      experimentId: 'fixture',
      page: 1,
      pageSize: 2,
      targetId: 'points',
    });
    expect(page1.available).toBe(true);
    expect(page1.total).toBe(3);
    expect(page1.rows).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.rows[0]?.learnedPrediction).toBe(19);
    expect(page1.rows[0]?.error).toBe(1);

    const page2 = await queryExplorerForEntry(entry, {
      experimentId: 'fixture',
      page: 2,
      pageSize: 2,
      targetId: 'points',
    });
    expect(page2.rows).toHaveLength(1);
    expect(page2.hasMore).toBe(false);

    const detail = await loadExplorerDetailForEntry(entry, {
      experimentId: 'fixture',
      playerId: 'p1',
      gameId: 'g1',
    });
    expect(detail.available).toBe(true);
    expect(detail.features.some((f) => f.name === 'pts_l5')).toBe(true);
  });

  it('filters by split and reports missing artifacts', async () => {
    writeFixture();
    const entry = explorerFixtureDir(dir);
    const val = await queryExplorerForEntry(entry, {
      experimentId: 'fixture',
      split: 'validation',
      pageSize: 50,
    });
    expect(val.total).toBe(2);

    const missing = await queryExplorer({ experimentId: 'shadow-pts-reb-c-r1' });
    expect(missing.available).toBe(false);
    expect(missing.reason).toMatch(/not on this host|rows\.jsonl/i);
  });
});
