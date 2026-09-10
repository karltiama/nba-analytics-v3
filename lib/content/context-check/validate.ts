import type {
  ContextCheckType,
  ContextMarketType,
  ManualContextCheckInput,
} from './types';

const MARKET_TYPES: readonly ContextMarketType[] = [
  'points',
  'rebounds',
  'assists',
  'threes',
  'pra',
];

const CONTEXT_TYPES: readonly ContextCheckType[] = [
  'recent_form',
  'line_context',
  'role_change',
  'roster_change',
];

export type ManualFormField =
  | 'playerId'
  | 'marketType'
  | 'direction'
  | 'line'
  | 'contextType';

export type ManualFormErrors = Partial<Record<ManualFormField, string>>;

export interface ManualFormValues {
  playerId: string;
  marketType: string;
  direction: string;
  line: string;
  contextType: string;
}

export function isContextMarketType(value: string): value is ContextMarketType {
  return (MARKET_TYPES as readonly string[]).includes(value);
}

export function isContextCheckType(value: string): value is ContextCheckType {
  return (CONTEXT_TYPES as readonly string[]).includes(value);
}

/**
 * Validate the admin manual form. Empty / non-numeric / non-finite lines fail.
 * Does not query a database.
 */
export function validateManualContextCheckForm(
  values: ManualFormValues
): { ok: true; input: ManualContextCheckInput } | { ok: false; errors: ManualFormErrors } {
  const errors: ManualFormErrors = {};

  const playerId = values.playerId.trim();
  if (!playerId) {
    errors.playerId = 'Select a player.';
  }

  if (!isContextMarketType(values.marketType)) {
    errors.marketType = 'Select a market.';
  }

  if (values.direction !== 'over' && values.direction !== 'under') {
    errors.direction = 'Select Over or Under.';
  }

  const line = Number(values.line);
  if (values.line.trim() === '' || !Number.isFinite(line)) {
    errors.line = 'Enter a valid numeric line.';
  } else if (line < 0) {
    errors.line = 'Line must be zero or greater.';
  }

  if (!isContextCheckType(values.contextType)) {
    errors.contextType = 'Select a context type.';
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    input: {
      playerId,
      marketType: values.marketType as ContextMarketType,
      direction: values.direction as 'over' | 'under',
      line,
      contextType: values.contextType as ContextCheckType,
    },
  };
}
