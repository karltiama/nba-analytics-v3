/**
 * Temporary Instagram typography variants.
 * None of these is the locked Court Context social typeface yet.
 */

export const INSTAGRAM_TYPE_VARIANTS = [
  {
    id: 'archivo-manrope',
    label: 'Archivo Black + Manrope',
    display: 'Archivo Black',
    body: 'Manrope',
  },
  {
    id: 'league-inter',
    label: 'League Spartan + Inter',
    display: 'League Spartan',
    body: 'Inter',
  },
  {
    id: 'barlow-manrope',
    label: 'Barlow Condensed + Manrope',
    display: 'Barlow Condensed',
    body: 'Manrope',
  },
] as const;

export type InstagramTypeVariantId = (typeof INSTAGRAM_TYPE_VARIANTS)[number]['id'];

export const DEFAULT_INSTAGRAM_TYPE_VARIANT: InstagramTypeVariantId = 'archivo-manrope';

export function isInstagramTypeVariantId(value: string): value is InstagramTypeVariantId {
  return INSTAGRAM_TYPE_VARIANTS.some((variant) => variant.id === value);
}
