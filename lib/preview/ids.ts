/**
 * Preview records use an explicit prefix or a numeric floor above any NBA id.
 * NBA person ids and BDL game ids in this app are well below the floor.
 */

export const PREVIEW_ID_PREFIX = 'ccpreview:';

/** 9.8e9. Real NBA person ids and game ids used here are 7–8 digits. */
export const PREVIEW_NUMERIC_ID_FLOOR = 9_800_000_000;

export function previewId(slug: string): string {
  return `${PREVIEW_ID_PREFIX}${slug}`;
}

export function previewNumericId(offset: number): number {
  return PREVIEW_NUMERIC_ID_FLOOR + offset;
}

export function isPreviewScopedId(value: string | number | null | undefined): boolean {
  if (value == null) return false;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= PREVIEW_NUMERIC_ID_FLOOR;
  }
  const text = value.trim();
  if (!text) return false;
  if (text.startsWith(PREVIEW_ID_PREFIX)) return true;
  if (/^\d+$/.test(text)) return Number(text) >= PREVIEW_NUMERIC_ID_FLOOR;
  return false;
}
