/**
 * Court Context — Context Center (foundation).
 *
 * FACTS + DERIVED CONTEXT only in this package surface.
 * Reuses court-context-engine-c1 layering principles; does not replace it.
 */

export * from './types';
export * from './registry';
export * from './role-expectation';
export * from './team-injury-burden';
export * from './availability-snapshot';
export * from './schedule-context';
export * from './opponent';
export * from './role';
export * from './form';
export * from './matchup';
export * from './interpretation';

export { CONTEXT_ENGINE_CONTRACT_ID, CONTEXT_LAYER } from '@/lib/context-engine/contract';
