import { describe, expect, it } from 'vitest';
import { overlayPruneCliEnv } from '@/lib/prune/cli-env';
import { evaluateDestructivePruneGate, evaluateMaterializeGate } from '@/lib/prune/env-gate';

const livePruneEnv = {
  PRUNE_ENABLED: '1',
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
};

describe('overlayPruneCliEnv', () => {
  it('forces no-delete without --execute even if shell env is live', () => {
    const env = overlayPruneCliEnv(livePruneEnv, false);
    expect(env.PRUNE_ENABLED).toBe('0');
    expect(env.CRON_DRY_RUN).toBe('1');
    expect(evaluateDestructivePruneGate(env).allowed).toBe(false);
    expect(evaluateMaterializeGate(env).allowed).toBe(false);
  });

  it('does not grant deletes with --execute when prune env is missing', () => {
    const env = overlayPruneCliEnv({}, true);
    expect(evaluateDestructivePruneGate(env).allowed).toBe(false);
  });

  it('does not grant deletes with --execute when DATA_MODE is missing', () => {
    const env = overlayPruneCliEnv(
      { PRUNE_ENABLED: '1', OFFSEASON_MODE: '0', CRON_DRY_RUN: '0' },
      true
    );
    expect(evaluateDestructivePruneGate(env).allowed).toBe(false);
  });

  it('leaves cron gates intact with --execute so live+enabled can pass the env gate', () => {
    const env = overlayPruneCliEnv(livePruneEnv, true);
    expect(evaluateDestructivePruneGate(env).allowed).toBe(true);
  });
});
