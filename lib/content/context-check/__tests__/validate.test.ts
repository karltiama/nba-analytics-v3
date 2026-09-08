import { describe, expect, it } from 'vitest';
import { validateManualContextCheckForm } from '../validate';

const valid = {
  playerId: 'mock-jalen-brunson',
  marketType: 'points',
  direction: 'over',
  line: '27.5',
  contextType: 'recent_form',
};

describe('validateManualContextCheckForm', () => {
  it('accepts a complete numeric form', () => {
    const result = validateManualContextCheckForm(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.line).toBe(27.5);
      expect(result.input.marketType).toBe('points');
    }
  });

  it('rejects a missing player', () => {
    const result = validateManualContextCheckForm({ ...valid, playerId: '  ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.playerId).toBeTruthy();
  });

  it('rejects empty, NaN, and negative lines', () => {
    expect(validateManualContextCheckForm({ ...valid, line: '' }).ok).toBe(false);
    expect(validateManualContextCheckForm({ ...valid, line: 'abc' }).ok).toBe(false);
    expect(validateManualContextCheckForm({ ...valid, line: 'Infinity' }).ok).toBe(false);
    expect(validateManualContextCheckForm({ ...valid, line: '-1' }).ok).toBe(false);
  });

  it('rejects invalid market, direction, and context type', () => {
    expect(validateManualContextCheckForm({ ...valid, marketType: 'blocks' }).ok).toBe(false);
    expect(validateManualContextCheckForm({ ...valid, direction: 'both' }).ok).toBe(false);
    expect(validateManualContextCheckForm({ ...valid, contextType: 'lock' }).ok).toBe(false);
  });
});
