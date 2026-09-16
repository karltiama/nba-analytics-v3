/**
 * Parlay XRay product events. Surface only.
 * Never send filenames, OCR text, player names, lines, or odds.
 */

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
