import type { XRayWowyContext } from './types';

/**
 * Public /wowy is retrospective (no as-of control). The cutoff-safe model
 * adapter requires an explicit teammate pair that a slip does not provide.
 * X3C does not invent teammates or expand WOWY architecture.
 */
export function assembleWowyContext(): XRayWowyContext {
  return {
    status: 'UNAVAILABLE',
    reason: 'NO_AS_OF_SAFE_WOWY_SOURCE',
  };
}
