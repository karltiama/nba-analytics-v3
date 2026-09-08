import { describe, expect, it } from 'vitest';
import { toContextCheckCardViewModel } from '../view-model';
import {
  MOCK_INSUFFICIENT_ROSTER,
  MOCK_LINE_INFLATION,
  MOCK_RECENT_FORM_DIVERGENCE,
  MOCK_ROLE_CHANGE,
} from '../mocks';
import type { ContextCheckData } from '../types';

describe('toContextCheckCardViewModel', () => {
  it('renders a ContextCheckData snapshot into card fields', () => {
    const vm = toContextCheckCardViewModel(MOCK_RECENT_FORM_DIVERGENCE, 'web');
    expect(vm.playerName).toBe('Jalen Brunson');
    expect(vm.marketClaim).toBe('Over 27.5 Points');
    expect(vm.headlineRate).toBe('100%');
    expect(vm.headlineFraction).toBe('5/5');
    expect(vm.verdictLabel).toBe('Mixed');
    expect(vm.sampleRows.map((row) => row.label)).toEqual(['L5', 'L10', 'L20', 'Season']);
    expect(JSON.stringify(vm)).not.toContain('score');
    expect(JSON.stringify(vm)).not.toContain('91');
  });

  it('includes line context rows when present', () => {
    const vm = toContextCheckCardViewModel(MOCK_LINE_INFLATION);
    expect(vm.lineContextRows).not.toBeNull();
    expect(vm.lineContextRows?.some((row) => row.label === 'Current line')).toBe(true);
    expect(vm.lineContextRows?.some((row) => row.label === 'Difference')).toBe(true);
    expect(vm.roleContextRows).toBeNull();
  });

  it('omits line context when absent', () => {
    const vm = toContextCheckCardViewModel(MOCK_ROLE_CHANGE);
    expect(vm.lineContextRows).toBeNull();
  });

  it('includes role context rows when present', () => {
    const vm = toContextCheckCardViewModel(MOCK_ROLE_CHANGE);
    expect(vm.roleContextRows).not.toBeNull();
    expect(vm.roleContextRows?.map((row) => row.label)).toEqual([
      'Recent minutes',
      'Season minutes',
      'Change',
      'Role',
    ]);
  });

  it('omits role context when absent', () => {
    const vm = toContextCheckCardViewModel(MOCK_INSUFFICIENT_ROSTER);
    expect(vm.roleContextRows).toBeNull();
    expect(vm.lineContextRows).toBeNull();
    expect(vm.verdictLabel).toBe('Insufficient');
  });

  it('limits social variant to the strongest sample rows', () => {
    const vm = toContextCheckCardViewModel(MOCK_RECENT_FORM_DIVERGENCE, 'social');
    expect(vm.sampleRows.map((row) => row.label)).toEqual(['L5', 'Season']);
  });

  it('hides empty optional sections even if objects exist without values', () => {
    const emptyRole: ContextCheckData = {
      ...MOCK_INSUFFICIENT_ROSTER,
      roleContext: {},
    };
    const vm = toContextCheckCardViewModel(emptyRole);
    expect(vm.roleContextRows).toBeNull();
  });
});
