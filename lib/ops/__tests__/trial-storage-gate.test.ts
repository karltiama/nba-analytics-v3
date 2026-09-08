import { describe, expect, it } from 'vitest';
import { evaluateTrialStorageGate } from '../trial-storage-gate';

describe('trial storage gate', () => {
  const previous = { postgres: { mb: 304, bytes: 318_767_104 } };

  it('fails after-2024 when DB > 340 MB', () => {
    const r = evaluateTrialStorageGate({
      phase: 'after-2024',
      previous,
      current: { postgres: { mb: 341 } },
    });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.includes('340'))).toBe(true);
  });

  it('fails after-2024 when delta > 35 MB', () => {
    const r = evaluateTrialStorageGate({
      phase: 'after-2024',
      previous,
      current: { postgres: { mb: 340 } },
    });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.includes('delta'))).toBe(true);
  });

  it('passes after-2024 under both caps', () => {
    const r = evaluateTrialStorageGate({
      phase: 'after-2024',
      previous,
      current: { postgres: { mb: 320 } },
    });
    expect(r.ok).toBe(true);
  });

  it('fails global at 450 MB', () => {
    const r = evaluateTrialStorageGate({
      phase: 'global',
      previous: null,
      current: { postgres: { mb: 450 } },
    });
    expect(r.ok).toBe(false);
  });

  it('prohibits 2022 materialization by default', () => {
    const r = evaluateTrialStorageGate({
      phase: 'materialize-2022',
      previous: null,
      current: { postgres: { mb: 200 } },
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/2022/);
  });
});
