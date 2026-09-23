/**
 * Parlay XRay product events. Surface only.
 * Never send filenames, OCR text, player names, lines, or odds.
 */

import { XRAY_EXTRACT_RESULTS, type XrayExtractResult } from '@/lib/parlay-xray/extraction/result-codes';
import {
  PRODUCT_EVENTS,
  type ParlayXrayExtractProperties,
  type ParlayXraySurfaceProperties,
} from '@/lib/product-analytics/track-event';

export const PARLAY_XRAY_VIEWED = PRODUCT_EVENTS.PARLAY_XRAY_VIEWED;
export const PARLAY_XRAY_UPLOAD_STARTED = PRODUCT_EVENTS.PARLAY_XRAY_UPLOAD_STARTED;
export const PARLAY_XRAY_UPLOAD_SELECTED = PRODUCT_EVENTS.PARLAY_XRAY_UPLOAD_SELECTED;
export const PARLAY_XRAY_EXTRACT_STARTED = PRODUCT_EVENTS.PARLAY_XRAY_EXTRACT_STARTED;
export const PARLAY_XRAY_EXTRACT_COMPLETED = PRODUCT_EVENTS.PARLAY_XRAY_EXTRACT_COMPLETED;
export const PARLAY_XRAY_EXTRACT_FAILED = PRODUCT_EVENTS.PARLAY_XRAY_EXTRACT_FAILED;
export const PARLAY_XRAY_OPEN_WORKSPACE = PRODUCT_EVENTS.PARLAY_XRAY_OPEN_WORKSPACE;
export const PARLAY_WORKSPACE_ANALYSIS_STARTED = PRODUCT_EVENTS.PARLAY_WORKSPACE_ANALYSIS_STARTED;

export type { ParlayXrayExtractProperties };

export const parlayXraySurfaceProperties: ParlayXraySurfaceProperties = {
  surface: 'parlay_xray',
};

const CANONICAL_XRAY_RESULTS = new Set<string>(XRAY_EXTRACT_RESULTS);

export type ClosedXrayResultCategory = XrayExtractResult | 'UNKNOWN';

/** Analytics-only. Unknown API strings become UNKNOWN and are never forwarded. */
export function closedXrayResultCategory(value: unknown): ClosedXrayResultCategory {
  if (typeof value === 'string' && CANONICAL_XRAY_RESULTS.has(value)) {
    return value as XrayExtractResult;
  }
  return 'UNKNOWN';
}
