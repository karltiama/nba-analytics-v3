export type {
  ContextCheckCardVariant,
  ContextCheckCandidate,
  ContextCheckData,
  ContextCheckDirection,
  ContextCheckHeadline,
  ContextCheckLineContext,
  ContextCheckMarket,
  ContextCheckPlayer,
  ContextCheckRoleContext,
  ContextCheckSample,
  ContextCheckSource,
  ContextCheckStudioPlayer,
  ContextCheckType,
  ContextCheckVerdict,
  ContextMarketType,
  ContextVerdictType,
  ManualContextCheckInput,
  PlayerVisualKind,
} from './types';

export {
  formatContextTypeLabel,
  formatDataAsOf,
  formatDirectionLabel,
  formatHitFraction,
  formatHitRate,
  formatLine,
  formatMarketClaim,
  formatMarketLabel,
  formatMinutes,
  formatSignedNumber,
  formatSocialVerdictLabel,
  formatVerdictLabel,
  playerInitials,
} from './format';

export { toContextCheckCardViewModel, resolvePlayerVisual } from './view-model';
export type {
  CardStatRow,
  ContextCheckCardViewModel,
  ContextCheckPrimaryContext,
  ResolvedPlayerVisual,
} from './view-model';

export {
  isContextCheckType,
  isContextMarketType,
  validateManualContextCheckForm,
} from './validate';
export type { ManualFormErrors, ManualFormField, ManualFormValues } from './validate';

export {
  generateContextCheckFromManual,
  isGeneratedContextCheck,
} from './generate-from-manual';

export {
  MOCK_ACTION_LINE_MIXED,
  MOCK_CANDIDATES,
  MOCK_CONTEXT_CHECKS,
  MOCK_DATA_AS_OF,
  MOCK_INSUFFICIENT_ROSTER,
  MOCK_LINE_INFLATION,
  MOCK_LONG_NAME,
  MOCK_MISSING_IMAGE,
  MOCK_RECENT_FORM_DIVERGENCE,
  MOCK_ROLE_CHANGE,
} from './mocks';

export { STUDIO_PLAYERS, findStudioPlayer, searchStudioPlayers } from './players';

export {
  DEFAULT_INSTAGRAM_TYPE_VARIANT,
  INSTAGRAM_TYPE_VARIANTS,
  isInstagramTypeVariantId,
} from './instagram-type';
export type { InstagramTypeVariantId } from './instagram-type';

export {
  DISCOVERY_RULES,
  MockContextCheckDiscovery,
  defaultContextCheckDiscovery,
  evaluateDiscoverySignals,
  findContextCheckCandidates,
} from './discovery';
export type {
  ContextCheckDiscoverySource,
  DiscoverySignalInput,
  DiscoverySignalKind,
} from './discovery';
