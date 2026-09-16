'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { PropsExplorerOfferInput } from './adapt-props-explorer-offer';
import {
  addExplorerOfferToSelection,
  clearSelectedLegs,
  removeSelectedLeg,
  type AddExplorerOfferResult,
} from './selection';
import {
  emptyParlaySelectionSnapshot,
  getExplorerReturnHref,
  getParlaySelectionLegs,
  getWorkspaceAnalysisRecord,
  isXrayImportEdited,
  rememberExplorerReturnHref,
  replaceParlaySelectionLegs,
  setWorkspaceAnalysisRecord,
  subscribeParlaySelection,
} from './selection-store';

export function useParlaySelection() {
  const legs = useSyncExternalStore(
    subscribeParlaySelection,
    getParlaySelectionLegs,
    emptyParlaySelectionSnapshot
  );

  const analysis = useSyncExternalStore(
    subscribeParlaySelection,
    getWorkspaceAnalysisRecord,
    () => null
  );

  const editedAfterXrayImport = useSyncExternalStore(
    subscribeParlaySelection,
    isXrayImportEdited,
    () => false
  );

  const addExplorerOffer = useCallback(
    (
      input: PropsExplorerOfferInput,
      display?: { gameLabel?: string | null }
    ): AddExplorerOfferResult => {
      const result = addExplorerOfferToSelection(getParlaySelectionLegs(), input, display);
      if (result.status === 'added') replaceParlaySelectionLegs(result.legs);
      return result;
    },
    []
  );

  const removeLeg = useCallback((offerIdentity: string) => {
    replaceParlaySelectionLegs(removeSelectedLeg(getParlaySelectionLegs(), offerIdentity));
  }, []);

  const clear = useCallback(() => {
    replaceParlaySelectionLegs(clearSelectedLegs());
  }, []);

  return {
    legs,
    analysis,
    editedAfterXrayImport,
    explorerReturnHref: getExplorerReturnHref(),
    addExplorerOffer,
    removeLeg,
    clear,
    rememberExplorerReturnHref,
    setAnalysis: setWorkspaceAnalysisRecord,
  };
}
