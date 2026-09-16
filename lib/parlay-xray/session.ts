import { combinedAmericanOdds, knownLegOdds } from './combined-odds';
import { extractionCounts, withDerivedResolution } from './fields';
import { detectStructuralDependencies, structuralFailureNotes } from './structural';
import type {
  AnalysisStatus,
  ExtractedParlayLeg,
  ExtractionStatus,
  ParlayLegSide,
  UploadedScreenshot,
  UploadErrorCode,
  XRayAnalysis,
  XRayParlay,
  XrayPropKind,
} from './types';

export type XrayQuotaView = {
  used: number;
  limit: number;
  remaining: number;
};

export type XrayState = {
  parlay: XRayParlay;
  analysis: XRayAnalysis | null;
  uploadErrorCode: UploadErrorCode | null;
  editing: boolean;
  confirmed: boolean;
  designPreview: boolean;
  quota: XrayQuotaView | null;
  extractNotice: string | null;
};

export type LegEdits = {
  playerDisplayName?: string;
  propKind?: XrayPropKind;
  side?: ParlayLegSide;
  line?: number | null;
  oddsAmerican?: number | null;
};

export type XrayAction =
  | { type: 'FILE_REJECTED'; code: Extract<UploadErrorCode, 'unsupported_file' | 'file_too_large'> }
  | { type: 'FILE_SELECTED'; file: UploadedScreenshot }
  | { type: 'FILE_REMOVED' }
  | { type: 'TOGGLE_EDITING' }
  | { type: 'UPDATE_LEG'; legId: string; edits: LegEdits }
  | { type: 'ATTACH_HEADSHOTS'; ids: Record<string, string> }
  | { type: 'CONFIRM_LEGS' }
  | { type: 'LOAD_PREVIEW'; parlay: XRayParlay; analysis: XRayAnalysis | null; confirmed?: boolean }
  | { type: 'EXTRACT_STARTED' }
  | { type: 'SET_EXTRACTION'; status: ExtractionStatus; legs: ExtractedParlayLeg[]; notice?: string | null }
  | { type: 'SET_QUOTA'; quota: XrayQuotaView | null }
  | { type: 'SET_ANALYSIS'; analysis: XRayAnalysis | null };

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `xray-${Date.now()}`;
}

const EMPTY_PARLAY: XRayParlay = {
  id: 'xray-empty',
  source: 'screenshot',
  uploadedImage: null,
  legs: [],
  extractionStatus: 'idle',
  analysisStatus: 'idle',
  createdAt: '',
};

export function createEmptyParlay(): XRayParlay {
  return { ...EMPTY_PARLAY, legs: [] };
}

export function createInitialXrayState(): XrayState {
  return {
    parlay: createEmptyParlay(),
    analysis: null,
    uploadErrorCode: null,
    editing: false,
    confirmed: false,
    designPreview: false,
    quota: null,
    extractNotice: null,
  };
}

function applyEdits(leg: ExtractedParlayLeg, edits: LegEdits): ExtractedParlayLeg {
  const next: ExtractedParlayLeg = { ...leg };
  if (edits.playerDisplayName !== undefined) {
    const value = edits.playerDisplayName.trim();
    next.playerDisplayName = value
      ? { value, status: 'known' }
      : { value: null, status: 'unknown' };
    next.nbaPlayerId = { value: null, status: 'unknown' };
    next.playerId = { value: null, status: 'unknown' };
  }
  if (edits.propKind !== undefined) {
    next.propKind = { value: edits.propKind, status: 'known' };
    next.propLabel = { value: edits.propKind, status: 'known' };
  }
  if (edits.side !== undefined) {
    next.side = { value: edits.side, status: 'known' };
  }
  if (edits.line !== undefined) {
    next.line =
      edits.line == null || !Number.isFinite(edits.line)
        ? { value: null, status: 'unknown' }
        : { value: edits.line, status: 'known' };
  }
  if (edits.oddsAmerican !== undefined) {
    next.oddsAmerican =
      edits.oddsAmerican == null || !Number.isFinite(edits.oddsAmerican) || edits.oddsAmerican === 0
        ? { value: null, status: 'unknown' }
        : { value: edits.oddsAmerican, status: 'known' };
  }
  return withDerivedResolution(next);
}

export function reduceXrayState(state: XrayState, action: XrayAction): XrayState {
  switch (action.type) {
    case 'FILE_REJECTED':
      return {
        ...state,
        uploadErrorCode: action.code,
      };
    case 'FILE_SELECTED':
      return {
        ...state,
        uploadErrorCode: null,
        editing: false,
        confirmed: false,
        analysis: null,
        designPreview: false,
        extractNotice: null,
        parlay: {
          ...createEmptyParlay(),
          id: newId(),
          createdAt: new Date().toISOString(),
          uploadedImage: action.file,
          extractionStatus: 'idle',
          analysisStatus: 'unavailable',
        },
      };
    case 'FILE_REMOVED':
      return { ...createInitialXrayState(), quota: state.quota };
    case 'TOGGLE_EDITING':
      return { ...state, editing: !state.editing };
    case 'UPDATE_LEG': {
      const legs = state.parlay.legs.map((leg) =>
        leg.id === action.legId ? applyEdits(leg, action.edits) : leg
      );
      const counts = extractionCounts(legs);
      const extractionStatus: ExtractionStatus =
        counts.detected === 0
          ? state.parlay.extractionStatus
          : counts.needsConfirmation > 0 || counts.unresolved > 0
            ? 'partial'
            : 'complete';
      return {
        ...state,
        confirmed: false,
        analysis: null,
        parlay: {
          ...state.parlay,
          legs,
          extractionStatus,
          analysisStatus: 'unavailable',
        },
      };
    }
    case 'ATTACH_HEADSHOTS': {
      let changed = false;
      const legs = state.parlay.legs.map((leg) => {
        const nbaId = action.ids[leg.id];
        if (!nbaId || leg.nbaPlayerId.status === 'known') return leg;
        changed = true;
        return { ...leg, nbaPlayerId: { value: nbaId, status: 'known' as const } };
      });
      if (!changed) return state;
      return { ...state, parlay: { ...state.parlay, legs } };
    }
    case 'CONFIRM_LEGS': {
      const counts = extractionCounts(state.parlay.legs);
      if (counts.detected === 0 || counts.needsConfirmation > 0 || counts.unresolved > 0) {
        return state;
      }
      return {
        ...state,
        editing: false,
        confirmed: true,
      };
    }
    case 'LOAD_PREVIEW':
      return {
        ...state,
        parlay: action.parlay,
        analysis: action.analysis,
        uploadErrorCode: null,
        editing: false,
        confirmed: action.confirmed ?? action.analysis?.status === 'ready',
        designPreview: true,
        extractNotice: null,
      };
    case 'EXTRACT_STARTED':
      return {
        ...state,
        extractNotice: null,
        confirmed: false,
        analysis: null,
        parlay: {
          ...state.parlay,
          extractionStatus: 'pending',
          analysisStatus: 'unavailable',
        },
      };
    case 'SET_EXTRACTION': {
      const counts = extractionCounts(action.legs);
      return {
        ...state,
        confirmed: false,
        analysis: null,
        extractNotice: action.notice ?? null,
        parlay: {
          ...state.parlay,
          legs: action.legs.map(withDerivedResolution),
          extractionStatus: action.status,
          analysisStatus: counts.detected === 0 ? 'unavailable' : 'unavailable',
        },
      };
    }
    case 'SET_QUOTA':
      return { ...state, quota: action.quota };
    case 'SET_ANALYSIS':
      return {
        ...state,
        analysis: action.analysis,
        parlay: {
          ...state.parlay,
          analysisStatus: action.analysis?.status ?? 'unavailable',
        },
      };
    default:
      return state;
  }
}

export function canConfirmLegs(state: XrayState): boolean {
  const counts = extractionCounts(state.parlay.legs);
  return counts.detected > 0 && counts.needsConfirmation === 0 && counts.unresolved === 0;
}

export function hasRenderableAnalysis(analysis: XRayAnalysis | null): boolean {
  return analysis != null && analysis.status === 'ready';
}

export function selectAnalysisPresentation(state: XrayState): {
  visible: boolean;
  analysis: XRayAnalysis | null;
} {
  if (!hasRenderableAnalysis(state.analysis)) {
    return { visible: false, analysis: null };
  }
  return { visible: true, analysis: state.analysis };
}

export function liveCombinedOdds(legs: ExtractedParlayLeg[]): number | null {
  return combinedAmericanOdds(knownLegOdds(legs));
}

export function liveStructuralNotes(legs: ExtractedParlayLeg[]): ReturnType<typeof structuralFailureNotes> {
  return structuralFailureNotes(detectStructuralDependencies(legs));
}

export function analysisStageFor(state: XrayState): AnalysisStatus {
  if (hasRenderableAnalysis(state.analysis)) return 'ready';
  return state.parlay.analysisStatus;
}

export function extractionStatusFromResult(result: string): ExtractionStatus {
  if (result === 'SUCCESS') return 'complete';
  if (result === 'PARTIAL' || result === 'NEEDS_CONFIRMATION') return 'partial';
  if (result === 'NO_LEGS_FOUND') return 'no_legs';
  if (result === 'EXTRACTION_DISABLED') return 'unavailable';
  return 'failed';
}
