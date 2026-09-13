import { describe, expect, it } from 'vitest';
import { nbaCdnHeadshotUrl } from '@/lib/nba/headshots';

describe('nbaCdnHeadshotUrl', () => {
  it('uses the NBA.com CDN path already used by the trending strip', () => {
    expect(nbaCdnHeadshotUrl('1628368')).toBe(
      'https://cdn.nba.com/headshots/nba/latest/1040x760/1628368.png'
    );
  });
});
