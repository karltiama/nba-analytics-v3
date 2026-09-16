/**
 * Session-memory parlay selection. Survives client-side App Router navigations
 * across /betting/*, /parlay-xray, and /parlay-workspace layouts. Clears on hard reload.
 * No localStorage, sessionStorage, cookies, or URL serialization.
 */

import type { HistoricalXrayReplayResult } from '@/lib/parlay-xray/e2e/types';
import {
  PROPS_EXPLORER_HREF,
  canonicalParlaySelectionFromLegs,
  dedupeSelectedLegs,
  emptyParlaySelection,
  type CanonicalParlaySelection,
  type SelectedParlayLeg,
} from './selection';
import { selectionFingerprint } from './workspace-analysis';

const EMPTY_LEGS: SelectedParlayLeg[] = emptyParlaySelection();

let legs: SelectedParlayLeg[] = EMPTY_LEGS;
let explorerReturnHref = PROPS_EXPLORER_HREF;
let analysis: WorkspaceAnalysisRecord | null = null;
let xrayImportFingerprint: string | null = null;
const listeners = new Set<() => void>();

export type WorkspaceAnalysisRecord = {
  fingerprint: string;
  result: HistoricalXrayReplayResult;
};

function emit(): void {
  for (const listener of listeners) listener();
}

export function getParlaySelectionLegs(): SelectedParlayLeg[] {
  return legs;
}

export function getCanonicalParlaySelection(): CanonicalParlaySelection {
  return canonicalParlaySelectionFromLegs(legs);
}

export function getExplorerReturnHref(): string {
  return explorerReturnHref;
}

export function subscribeParlaySelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function replaceParlaySelectionLegs(next: SelectedParlayLeg[]): SelectedParlayLeg[] {
  const unique = dedupeSelectedLegs(next);
  legs = unique.length === 0 ? EMPTY_LEGS : unique;
  if (unique.length === 0) xrayImportFingerprint = null;
  const nextFingerprint = selectionFingerprint(legs);
  if (!analysis || analysis.fingerprint !== nextFingerprint) {
    analysis = null;
  }
  emit();
  return legs;
}

/** Populate Workspace from confirmed XRay canonical legs. Does not run analysis. */
export function importConfirmedXrayLegsToStore(next: SelectedParlayLeg[]): SelectedParlayLeg[] {
  const imported = replaceParlaySelectionLegs(next);
  xrayImportFingerprint = imported.length === 0 ? null : selectionFingerprint(imported);
  emit();
  return imported;
}

export function isXrayImportEdited(): boolean {
  if (!xrayImportFingerprint || legs.length === 0) return false;
  return selectionFingerprint(legs) !== xrayImportFingerprint;
}

export function getWorkspaceAnalysisRecord(): WorkspaceAnalysisRecord | null {
  if (!analysis) return null;
  if (analysis.fingerprint !== selectionFingerprint(legs)) return null;
  return analysis;
}

export function setWorkspaceAnalysisRecord(record: WorkspaceAnalysisRecord | null): void {
  analysis = record;
  emit();
}

export function rememberExplorerReturnHref(href: string): void {
  const trimmed = href.trim();
  const next = trimmed.startsWith(PROPS_EXPLORER_HREF) ? trimmed : PROPS_EXPLORER_HREF;
  if (next === explorerReturnHref) return;
  explorerReturnHref = next;
  emit();
}

export function emptyParlaySelectionSnapshot(): SelectedParlayLeg[] {
  return EMPTY_LEGS;
}

/** Test-only. Not a product reset. */
export function resetParlaySelectionStoreForTests(): void {
  legs = EMPTY_LEGS;
  explorerReturnHref = PROPS_EXPLORER_HREF;
  analysis = null;
  xrayImportFingerprint = null;
  emit();
}
