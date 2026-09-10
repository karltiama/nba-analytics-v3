import { formatDirectionLabel } from './format';
import { findStudioPlayer } from './players';
import type {
  ContextCheckData,
  ContextCheckSample,
  ContextCheckType,
  ContextCheckVerdict,
  ManualContextCheckInput,
} from './types';

function sample(label: string, hits: number, games: number): ContextCheckSample {
  return { label, hits, games, hitRate: games === 0 ? 0 : hits / games };
}

function headlineFrom(
  l5: ContextCheckSample,
  direction: ManualContextCheckInput['direction']
): ContextCheckData['headline'] {
  return {
    text: `${l5.hits} of last ${l5.games} ${formatDirectionLabel(direction).toUpperCase()}`,
    hits: l5.hits,
    games: l5.games,
    hitRate: l5.hitRate,
  };
}

function samplesForType(type: ContextCheckType): ContextCheckSample[] {
  switch (type) {
    case 'recent_form':
      return [sample('L5', 5, 5), sample('L10', 7, 10), sample('L20', 11, 20), sample('Season', 22, 46)];
    case 'line_context':
      return [sample('L5', 4, 5), sample('L10', 8, 10), sample('L20', 13, 20), sample('Season', 31, 52)];
    case 'role_change':
      return [sample('L5', 4, 5), sample('L10', 7, 10), sample('L20', 12, 20), sample('Season', 28, 48)];
    case 'roster_change':
      return [sample('L5', 3, 5), sample('L10', 5, 10), sample('Season', 18, 40)];
  }
}

function verdictForType(type: ContextCheckType): ContextCheckVerdict {
  switch (type) {
    case 'recent_form':
      return {
        type: 'mixed',
        title: 'Mixed Context',
        explanation:
          'Recent form is strong, but the season-long hit rate is closer to even. Treat the headline as a short-sample observation, not a full-season pattern.',
      };
    case 'line_context':
      return {
        type: 'pushes_back',
        title: 'Line Has Already Moved',
        explanation:
          'Recent production looks strong, but the current line is materially higher than recent lines. The market has already priced in much of the same form.',
      };
    case 'role_change':
      return {
        type: 'supports',
        title: 'Role Context Supports the Claim',
        explanation:
          'Recent minutes are well above the season average, which is consistent with a larger role. Hit rates are supportive without being extreme.',
      };
    case 'roster_change':
      return {
        type: 'insufficient',
        title: 'Not Enough Stable Evidence',
        explanation:
          'Roster-change interpretation needs confirmed teammate availability. That input is not connected in v1, so this preview stops short of a strong reading.',
      };
  }
}

/**
 * Temporary data layer for the admin manual flow.
 *
 * Manual Input → this generator → ContextCheckData → ContextCheckCard.
 * Replace with a read-only analytics snapshot builder later. Do not call this
 * from ingestion, identity, or serving write paths.
 */
export function generateContextCheckFromManual(
  input: ManualContextCheckInput,
  options?: { dataAsOf?: string; id?: string }
): ContextCheckData | { error: string } {
  const player = findStudioPlayer(input.playerId);
  if (!player) {
    return { error: 'Unknown player. Choose a player from the studio list.' };
  }

  const samples = samplesForType(input.contextType);
  const l5 = samples[0];
  const dataAsOf = options?.dataAsOf ?? new Date().toISOString();

  const data: ContextCheckData = {
    id: options?.id ?? `manual-${player.id}-${input.marketType}-${input.direction}-${input.line}`,
    player: {
      id: player.id,
      name: player.name,
      teamAbbreviation: player.teamAbbreviation,
      teamName: player.teamName,
    },
    market: {
      type: input.marketType,
      direction: input.direction,
      line: input.line,
    },
    headline: headlineFrom(l5, input.direction),
    samples,
    verdict: verdictForType(input.contextType),
    contextType: input.contextType,
    dataAsOf,
    source: 'manual',
  };

  if (input.contextType === 'line_context' || input.contextType === 'recent_form') {
    const recentAvg = Math.max(0, input.line - (input.contextType === 'line_context' ? 2.4 : 1.1));
    data.lineContext = {
      currentLine: input.line,
      last5AverageLine: Number(recentAvg.toFixed(1)),
      difference: Number((input.line - recentAvg).toFixed(1)),
    };
  }

  if (input.contextType === 'role_change') {
    data.roleContext = {
      seasonMinutes: 29.2,
      recentMinutes: 35.7,
      minutesChange: 6.5,
      starterStatus: 'Starter',
    };
  }

  return data;
}

export function isGeneratedContextCheck(
  result: ContextCheckData | { error: string }
): result is ContextCheckData {
  return !('error' in result);
}
