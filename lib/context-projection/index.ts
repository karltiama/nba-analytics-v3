/**
 * Context Projection Layer — PTS production shadow (Phase 16B).
 */

export * from '@/lib/context-projection/protocol';
export * from '@/lib/context-projection/features';
export * from '@/lib/context-projection/baseline';
export * from '@/lib/context-projection/ridge';
export * from '@/lib/context-projection/predict';
export * from '@/lib/context-projection/store';
export * from '@/lib/context-projection/window';
export { buildProspectiveShadowRecord, loadFrozenBundle } from '@/lib/context-projection/arm';
export type { ArmShadowCandidate } from '@/lib/context-projection/arm';
// Auxiliary MIN (Phase 17) — import from '@/lib/context-projection/min' to avoid PTS coupling.
