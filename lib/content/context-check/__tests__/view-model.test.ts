import { describe, expect, it } from 'vitest';
import { resolvePlayerVisual, toContextCheckCardViewModel } from '../view-model';
import {
  MOCK_ACTION_LINE_MIXED,
  MOCK_INSUFFICIENT_ROSTER,
  MOCK_LINE_INFLATION,
  MOCK_LONG_NAME,
  MOCK_MISSING_IMAGE,
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
    expect(vm.primaryContext).toBeNull();
    expect(JSON.stringify(vm)).not.toContain('"score"');
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

  it('hides empty optional sections even if objects exist without values', () => {
    const emptyRole: ContextCheckData = {
      ...MOCK_INSUFFICIENT_ROSTER,
      roleContext: {},
    };
    const vm = toContextCheckCardViewModel(emptyRole);
    expect(vm.roleContextRows).toBeNull();
  });
});

describe('social Instagram view-model', () => {
  it('selects L5, L10, and Season — not L20', () => {
    const social = toContextCheckCardViewModel(MOCK_RECENT_FORM_DIVERGENCE, 'social');
    const web = toContextCheckCardViewModel(MOCK_RECENT_FORM_DIVERGENCE, 'web');
    expect(social.sampleRows.map((row) => row.label)).toEqual(['L5', 'L10', 'Season']);
    expect(web.sampleRows.map((row) => row.label)).toContain('L20');
    expect(social.sampleRows.map((row) => row.label)).not.toContain('L20');
  });

  it('prefers heroImageUrl over headshot', () => {
    const vm = toContextCheckCardViewModel(MOCK_ACTION_LINE_MIXED, 'social');
    expect(vm.visual.kind).toBe('hero');
    expect(vm.visual.src).toBe(MOCK_ACTION_LINE_MIXED.player.heroImageUrl);
    expect(vm.heroImageUrl).toBeTruthy();
    expect(vm.headshotUrl).toBeTruthy();
  });

  it('falls back to headshot when no hero image exists', () => {
    const vm = toContextCheckCardViewModel(MOCK_ROLE_CHANGE, 'social');
    expect(vm.visual.kind).toBe('headshot');
    expect(vm.visual.src).toBe(MOCK_ROLE_CHANGE.player.headshotUrl);
    expect(vm.heroImageUrl).toBeUndefined();
  });

  it('uses generic fallback when no images exist', () => {
    const vm = toContextCheckCardViewModel(MOCK_MISSING_IMAGE, 'social');
    expect(vm.visual.kind).toBe('fallback');
    expect(vm.visual.src).toBeUndefined();
    expect(vm.playerInitials).toBe('AE');
  });

  it('renders social verdict labels, not betting commands', () => {
    expect(toContextCheckCardViewModel(MOCK_ROLE_CHANGE, 'social').verdictLabel).toBe(
      'Context Supports'
    );
    expect(toContextCheckCardViewModel(MOCK_ACTION_LINE_MIXED, 'social').verdictLabel).toBe(
      'Mixed Context'
    );
    expect(toContextCheckCardViewModel(MOCK_LINE_INFLATION, 'social').verdictLabel).toBe(
      'Context Pushes Back'
    );
    expect(toContextCheckCardViewModel(MOCK_MISSING_IMAGE, 'social').verdictLabel).toBe(
      'Not Enough Context'
    );
  });

  it('shows line check only when line context exists', () => {
    const withLine = toContextCheckCardViewModel(MOCK_ACTION_LINE_MIXED, 'social');
    const withoutLine = toContextCheckCardViewModel(MOCK_ROLE_CHANGE, 'social');
    expect(withLine.primaryContext?.title).toBe('Line Check');
    expect(withLine.lineContextRows?.map((row) => row.label)).toEqual([
      'Recent avg',
      'Tonight',
      'Change',
    ]);
    expect(withoutLine.lineContextRows).toBeNull();
    expect(withoutLine.primaryContext?.title).toBe('Role Check');
  });

  it('shows role check only when role context exists', () => {
    const withRole = toContextCheckCardViewModel(MOCK_ROLE_CHANGE, 'social');
    const withoutRole = toContextCheckCardViewModel(MOCK_LINE_INFLATION, 'social');
    expect(withRole.roleContextRows?.map((row) => row.label)).toEqual([
      'Season MPG',
      'Recent MPG',
      'Change',
    ]);
    expect(withoutRole.roleContextRows).toBeNull();
  });

  it('keeps long player names in the view-model without dropping required fields', () => {
    const vm = toContextCheckCardViewModel(MOCK_LONG_NAME, 'social');
    expect(vm.playerName).toBe('Giannis Antetokounmpo');
    expect(vm.marketClaim).toBe('Over 42.5 PRA');
    expect(vm.sampleRows.length).toBeGreaterThan(0);
    expect(vm.verdictLabel).toBe('Mixed Context');
    expect(vm.visual.kind).toBe('hero');
  });

  it('keeps web and social intentionally distinct', () => {
    const web = toContextCheckCardViewModel(MOCK_RECENT_FORM_DIVERGENCE, 'web');
    const social = toContextCheckCardViewModel(MOCK_RECENT_FORM_DIVERGENCE, 'social');
    expect(web.verdictLabel).toBe('Mixed');
    expect(social.verdictLabel).toBe('Mixed Context');
    expect(web.sampleRows.length).toBeGreaterThan(social.sampleRows.length);
    expect(web.primaryContext).toBeNull();
    expect(social.primaryContext).not.toBeNull();
  });
});

describe('resolvePlayerVisual', () => {
  it('walks hero → headshot → fallback', () => {
    expect(
      resolvePlayerVisual({
        id: '1',
        name: 'A',
        heroImageUrl: 'hero.jpg',
        headshotUrl: 'head.jpg',
      })
    ).toEqual({ kind: 'hero', src: 'hero.jpg' });
    expect(resolvePlayerVisual({ id: '1', name: 'A', headshotUrl: 'head.jpg' })).toEqual({
      kind: 'headshot',
      src: 'head.jpg',
    });
    expect(resolvePlayerVisual({ id: '1', name: 'A' })).toEqual({ kind: 'fallback' });
  });
});
