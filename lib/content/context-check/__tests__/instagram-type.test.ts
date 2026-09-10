import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSTAGRAM_TYPE_VARIANT,
  INSTAGRAM_TYPE_VARIANTS,
  isInstagramTypeVariantId,
} from '../instagram-type';

describe('instagram type variants', () => {
  it('exposes exactly three comparison variants and does not lock a final face', () => {
    expect(INSTAGRAM_TYPE_VARIANTS.map((v) => v.id)).toEqual([
      'archivo-manrope',
      'league-inter',
      'barlow-manrope',
    ]);
    expect(DEFAULT_INSTAGRAM_TYPE_VARIANT).toBe('archivo-manrope');
    expect(isInstagramTypeVariantId('archivo-manrope')).toBe(true);
    expect(isInstagramTypeVariantId('comic-sans')).toBe(false);
  });
});
