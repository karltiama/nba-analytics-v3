import { describe, expect, it } from 'vitest';
import {
  evaluateDestructivePruneGate,
  evaluateMaterializeGate,
  parseExplicitFlag,
  readPruneEnvSnapshot,
} from '@/lib/prune/env-gate';

function liveEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    PRUNE_ENABLED: '1',
    DATA_MODE: 'live_api',
    OFFSEASON_MODE: '0',
    CRON_DRY_RUN: '0',
    ...overrides,
  };
}

describe('parseExplicitFlag', () => {
  it('treats empty as missing', () => {
    expect(parseExplicitFlag(undefined)).toBe('missing');
    expect(parseExplicitFlag('')).toBe('missing');
    expect(parseExplicitFlag('  ')).toBe('missing');
  });

  it('accepts only 0/1', () => {
    expect(parseExplicitFlag('0')).toBe('0');
    expect(parseExplicitFlag('1')).toBe('1');
    expect(parseExplicitFlag('true')).toBe('invalid');
  });
});

describe('evaluateDestructivePruneGate', () => {
  it('blocks when PRUNE_ENABLED is missing', () => {
    const env = liveEnv({ PRUNE_ENABLED: undefined });
    const d = evaluateDestructivePruneGate(env);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/PRUNE_ENABLED/);
  });

  it('blocks when PRUNE_ENABLED=0', () => {
    const d = evaluateDestructivePruneGate(liveEnv({ PRUNE_ENABLED: '0' }));
    expect(d.allowed).toBe(false);
  });

  it('blocks when DATA_MODE is missing (no live_api default)', () => {
    const d = evaluateDestructivePruneGate(liveEnv({ DATA_MODE: undefined }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/DATA_MODE is missing/);
    expect(readPruneEnvSnapshot(liveEnv({ DATA_MODE: undefined })).dataMode).toBeNull();
  });

  it('blocks when DATA_MODE=replay', () => {
    const d = evaluateDestructivePruneGate(liveEnv({ DATA_MODE: 'replay' }));
    expect(d.allowed).toBe(false);
  });

  it('blocks offseason mode', () => {
    const d = evaluateDestructivePruneGate(liveEnv({ OFFSEASON_MODE: '1' }));
    expect(d.allowed).toBe(false);
  });

  it('blocks when OFFSEASON_MODE missing', () => {
    const d = evaluateDestructivePruneGate(liveEnv({ OFFSEASON_MODE: undefined }));
    expect(d.allowed).toBe(false);
  });

  it('blocks dry-run mode', () => {
    const d = evaluateDestructivePruneGate(liveEnv({ CRON_DRY_RUN: '1' }));
    expect(d.allowed).toBe(false);
  });

  it('allows only explicit valid live configuration', () => {
    const d = evaluateDestructivePruneGate(liveEnv());
    expect(d.allowed).toBe(true);
  });
});

describe('evaluateMaterializeGate', () => {
  it('allows materialize without PRUNE_ENABLED', () => {
    const d = evaluateMaterializeGate(liveEnv({ PRUNE_ENABLED: undefined }));
    expect(d.allowed).toBe(true);
  });

  it('blocks materialize when DATA_MODE missing', () => {
    const d = evaluateMaterializeGate(liveEnv({ DATA_MODE: undefined }));
    expect(d.allowed).toBe(false);
  });
});
