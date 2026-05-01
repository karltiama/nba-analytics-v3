import { describe, it, expect } from 'vitest';
import { buildSteps, parseArgs } from '../ingest-previous-season';

describe('ingest-previous-season smoke', () => {
  it('builds dry-run step sequence with no real-write flags', () => {
    const args = parseArgs(['--season=2024', '--dry-run']);
    const steps = buildSteps(args);

    expect(steps.length).toBe(4);
    expect(steps[0].args).toContain('--dry-run');
    expect(steps[1].args).toContain('--dry-run');
    expect(steps[2].args).toContain('--dry-run');
    expect(steps[3].args).toContain('--dry-run');
    expect(steps.flatMap((s) => s.args)).not.toContain('--overwrite');
  });

  it('builds real-run sequence with feature dry-run + real run', () => {
    const args = parseArgs(['--season=2024']);
    const steps = buildSteps(args);

    expect(steps.length).toBe(5);
    expect(steps[3].label).toContain('dry-run');
    expect(steps[3].args).toContain('--dry-run');
    expect(steps[4].label).toContain('real run');
    expect(steps[4].args).not.toContain('--dry-run');
  });
});
