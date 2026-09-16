/**
 * Canonical frontend contract for Parlay XRay.
 * Transient client state only — no persistence in this step.
 *
 * Field values are never silently filled. Missing screenshot data stays
 * unknown or needs_confirmation until the user verifies it.
 */

export const XRAY_PROP_KINDS = [
  'points',
  'rebounds',
  'assists',
  'threes',
  'points_rebounds_assists',
  'points_assists',
  'points_rebounds',
  'rebounds_assists',
  'other',
] as const;

export type XrayPropKind = (typeof XRAY_PROP_KINDS)[number];

export const XRAY_PROP_KIND_LABEL: Record<XrayPropKind, string> = {
  points: 'Points',
  rebounds: 'Rebounds',
  assists: 'Assists',
  threes: '3-Pointers Made',
  points_rebounds_assists: 'PRA',
  points_assists: 'PA',
  points_rebounds: 'PR',
  rebounds_assists: 'RA',
  other: 'Other',
};

export type FieldStatus = 'known' | 'unknown' | 'needs_confirmation';

export type XrayField<T> = {
  value: T | null;
  status: FieldStatus;
};

export type ParlayLegSide = 'over' | 'under';

export type ParlayLegResolution = 'resolved' | 'needs_confirmation' | 'unresolved';

export type ExtractionStatus =
  | 'idle'
  | 'unavailable'
  | 'pending'
  | 'partial'
  | 'complete'
  | 'failed'
  | 'no_legs';

export type AnalysisStatus =
  | 'idle'
  | 'unavailable'
  | 'pending'
  | 'ready'
  | 'failed'
  | 'insufficient_data';

export type UploadErrorCode =
  | 'unsupported_file'
  | 'file_too_large'
  | 'unreadable_screenshot'
  | 'no_recognizable_legs'
  | 'partial_extraction'
  | 'analysis_unavailable';

export type ContextReadLabel =
  | 'strong_support'
  | 'mixed_evidence'
  | 'limited_sample'
  | 'elevated_risk'
  | 'data_unavailable';

export type XrayLegOutlook =
  | 'favorable_context'
  | 'mixed'
  | 'elevated_risk'
  | 'limited_data'
  | 'unavailable';

export type CorrelationKind = 'structural' | 'measured_historical';

export type StructuralDependencyKind = 'same_player' | 'same_game' | 'same_team_scoring';

export type UploadedScreenshot = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  objectUrl: string;
};

export type ExtractedParlayLeg = {
  id: string;
  playerDisplayName: XrayField<string>;
  playerId: XrayField<string>;
  nbaPlayerId: XrayField<string>;
  teamAbbr: XrayField<string>;
  opponentAbbr: XrayField<string>;
  matchupLabel: XrayField<string>;
  propKind: XrayField<XrayPropKind>;
  propLabel: XrayField<string>;
  side: XrayField<ParlayLegSide>;
  line: XrayField<number>;
  oddsAmerican: XrayField<number>;
  sportsbookText: XrayField<string>;
  gameDate: XrayField<string>;
  extractionConfidence: XrayField<'high' | 'medium' | 'low'>;
  resolution: ParlayLegResolution;
  rawSnippet: string | null;
};

export type XRayParlay = {
  id: string;
  source: 'screenshot';
  uploadedImage: UploadedScreenshot | null;
  legs: ExtractedParlayLeg[];
  extractionStatus: ExtractionStatus;
  analysisStatus: AnalysisStatus;
  createdAt: string;
};

export type StructuralDependency = {
  kind: StructuralDependencyKind;
  legIds: string[];
  label: string;
};

export type XRayCorrelationWarning = {
  kind: CorrelationKind;
  dependency?: StructuralDependencyKind;
  title: string;
  detail: string;
  measuredCoefficient: number | null;
};

export type InsightCardId =
  | 'overall'
  | 'strongest'
  | 'riskiest'
  | 'correlation'
  | 'market_movement'
  | 'key_context';

export type XRayInsightCard = {
  id: InsightCardId;
  title: string;
  headline: string | null;
  detail: string | null;
  status: 'ready' | 'unavailable' | 'pending';
};

export type XRayLegAnalysis = {
  legId: string;
  outlook: XrayLegOutlook;
  analysisText: string | null;
  wowyNote: string | null;
  marketMovement: {
    window: '3h_pre_tip_to_close';
    summary: string | null;
    status: 'ready' | 'unavailable';
  } | null;
};

export type XRayFailureReason = {
  id: string;
  text: string;
  source: 'structural' | 'data_quality' | 'analysis';
};

export type XRayAnalysis = {
  status: AnalysisStatus;
  generatedAt: string | null;
  overallRead: XRayInsightCard;
  strongestLeg: XRayInsightCard;
  riskiestLeg: XRayInsightCard;
  correlation: XRayInsightCard;
  marketMovement: XRayInsightCard;
  keyContext: XRayInsightCard;
  legAnalyses: XRayLegAnalysis[];
  summary: {
    legCount: number;
    combinedOddsAmerican: number | null;
    strongestContext: string | null;
    majorRisk: string | null;
    correlationWarnings: XRayCorrelationWarning[];
    dataQualityWarnings: string[];
    favorableContextCount: number | null;
  };
  failureReasons: XRayFailureReason[];
};

/** Client never auto-calls the paid extractor on file select. Server kill switch is the safety boundary. */
export const SCREENSHOT_EXTRACTION_AVAILABLE = false;

export const XRAY_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const XRAY_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const XRAY_ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;
