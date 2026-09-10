import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entityIdForNbaPlayer } from '../../roster/class-c-onboarding';
import {
  buildPlayerIdentityIndex,
  requireAnalyticsPlayerId,
  resolvePlayerIdentity,
} from '../player-identity-resolve';

const certified = JSON.parse(
  readFileSync(
    join(process.cwd(), 'reports/operations/2026-27-class-c-certified-set.json'),
    'utf8'
  )
) as {
  count: number;
  classC: Array<{ nba_player_id: string; display_name: string }>;
};

const FLEMINGS_NBA = '1643412';

describe('Class C canonical identity (no fabricated BDL)', () => {
  it('certified set still has 81 NBA-only rookies', () => {
    expect(certified.count).toBe(81);
    expect(certified.classC).toHaveLength(81);
    expect(certified.classC.some((r) => r.nba_player_id === FLEMINGS_NBA)).toBe(true);
  });

  it('representative Class C resolves via NBA id with null analytics projection', () => {
    const entityId = entityIdForNbaPlayer(FLEMINGS_NBA);
    const index = buildPlayerIdentityIndex({
      bridges: [
        { playerEntityId: entityId, provider: 'nba', providerPlayerId: FLEMINGS_NBA },
      ],
      projections: [],
    });
    const r = resolvePlayerIdentity('nba', FLEMINGS_NBA, index);
    expect(r.status).toBe('resolved');
    if (r.status !== 'resolved') return;
    expect(r.playerEntityId).toBe(entityId);
    expect(r.analyticsPlayerId).toBeNull();
    expect(requireAnalyticsPlayerId(r).status).toBe('not_serving_yet');
    expect(index.entityIdsByProviderKey.has(`balldontlie\0${FLEMINGS_NBA}`)).toBe(
      false
    );
  });

  it('does not invent a BDL id from the NBA id', () => {
    const entityId = entityIdForNbaPlayer(FLEMINGS_NBA);
    const index = buildPlayerIdentityIndex({
      bridges: [
        { playerEntityId: entityId, provider: 'nba', providerPlayerId: FLEMINGS_NBA },
      ],
      projections: [],
    });
    const bdlGuess = resolvePlayerIdentity('balldontlie', FLEMINGS_NBA, index);
    expect(bdlGuess.status).toBe('unresolved');
  });
});
