import { formatDirectionLabel } from './format';
import type {
  ContextCheckData,
  ContextCheckSample,
  ContextCheckType,
  ContextCheckVerdict,
} from './types';

const DATA_AS_OF = '2026-09-08T16:00:00.000Z';

function sample(label: string, hits: number, games: number): ContextCheckSample {
  return { label, hits, games, hitRate: games === 0 ? 0 : hits / games };
}

function headlineFromL5(
  l5: ContextCheckSample,
  direction: ContextCheckData['market']['direction']
): ContextCheckData['headline'] {
  return {
    text: `${l5.hits} of last ${l5.games} ${formatDirectionLabel(direction).toUpperCase()}`,
    hits: l5.hits,
    games: l5.games,
    hitRate: l5.hitRate,
  };
}

const MIXED_FORM_VERDICT: ContextCheckVerdict = {
  type: 'mixed',
  title: 'Mixed Context',
  explanation:
    'Recent form is strong, but the season-long hit rate is closer to a coin flip. The headline is real; it is also a short sample.',
};

/**
 * Example 1 — recent-form divergence: L5 perfect, season mediocre.
 */
export const MOCK_RECENT_FORM_DIVERGENCE: ContextCheckData = {
  id: 'mock-cc-brunson-points-over',
  player: {
    id: 'mock-jalen-brunson',
    name: 'Jalen Brunson',
    teamAbbreviation: 'NYK',
    teamName: 'New York Knicks',
  },
  market: { type: 'points', direction: 'over', line: 27.5 },
  headline: headlineFromL5(sample('L5', 5, 5), 'over'),
  samples: [sample('L5', 5, 5), sample('L10', 7, 10), sample('L20', 11, 20), sample('Season', 22, 46)],
  lineContext: {
    currentLine: 27.5,
    last5AverageLine: 26.1,
    difference: 1.4,
  },
  verdict: MIXED_FORM_VERDICT,
  contextType: 'recent_form',
  dataAsOf: DATA_AS_OF,
  source: 'automatic',
};

/**
 * Example 2 — line inflation: recent production vs a materially higher current line.
 */
export const MOCK_LINE_INFLATION: ContextCheckData = {
  id: 'mock-cc-jokic-points-over',
  player: {
    id: 'mock-nikola-jokic',
    name: 'Nikola Jokic',
    teamAbbreviation: 'DEN',
    teamName: 'Denver Nuggets',
  },
  market: { type: 'points', direction: 'over', line: 29.5 },
  headline: headlineFromL5(sample('L5', 4, 5), 'over'),
  samples: [sample('L5', 4, 5), sample('L10', 8, 10), sample('L20', 13, 20), sample('Season', 31, 52)],
  lineContext: {
    currentLine: 29.5,
    last5AverageLine: 26.8,
    last10AverageLine: 26.4,
    difference: 2.7,
  },
  verdict: {
    type: 'pushes_back',
    title: 'Line Has Already Moved',
    explanation:
      'Recent scoring has been strong, but the current line sits well above the recent average. The market has already adjusted for the same form the headline cites.',
  },
  contextType: 'line_context',
  dataAsOf: DATA_AS_OF,
  source: 'automatic',
};

/**
 * Example 3 — role change: recent minutes materially above season average.
 */
export const MOCK_ROLE_CHANGE: ContextCheckData = {
  id: 'mock-cc-haliburton-assists-over',
  player: {
    id: 'mock-tyrese-haliburton',
    name: 'Tyrese Haliburton',
    teamAbbreviation: 'IND',
    teamName: 'Indiana Pacers',
  },
  market: { type: 'assists', direction: 'over', line: 8.5 },
  headline: headlineFromL5(sample('L5', 4, 5), 'over'),
  samples: [sample('L5', 4, 5), sample('L10', 7, 10), sample('L20', 12, 20), sample('Season', 28, 48)],
  roleContext: {
    seasonMinutes: 29.2,
    recentMinutes: 35.7,
    minutesChange: 6.5,
    starterStatus: 'Starter',
  },
  verdict: {
    type: 'supports',
    title: 'Role Context Supports the Claim',
    explanation:
      'Recent minutes are well above the season average, which is consistent with a larger playmaking workload. Broader hit rates are solid rather than extreme.',
  },
  contextType: 'role_change',
  dataAsOf: DATA_AS_OF,
  source: 'automatic',
};

/** Extra fixture: roster-change / insufficient evidence. */
export const MOCK_INSUFFICIENT_ROSTER: ContextCheckData = {
  id: 'mock-cc-edwards-threes-over',
  player: {
    id: 'mock-anthony-edwards',
    name: 'Anthony Edwards',
    teamAbbreviation: 'MIN',
    teamName: 'Minnesota Timberwolves',
  },
  market: { type: 'threes', direction: 'over', line: 3.5 },
  headline: headlineFromL5(sample('L5', 3, 5), 'over'),
  samples: [sample('L5', 3, 5), sample('L10', 5, 10), sample('Season', 18, 40)],
  verdict: {
    type: 'insufficient',
    title: 'Not Enough Stable Evidence',
    explanation:
      'A roster-change story needs confirmed availability and usage data. Those inputs are not wired in v1, so this check stops at the short sample rather than interpreting it.',
  },
  contextType: 'roster_change',
  dataAsOf: DATA_AS_OF,
  source: 'manual',
};

export const MOCK_CONTEXT_CHECKS: readonly ContextCheckData[] = [
  MOCK_RECENT_FORM_DIVERGENCE,
  MOCK_LINE_INFLATION,
  MOCK_ROLE_CHANGE,
  MOCK_INSUFFICIENT_ROSTER,
];

export { DATA_AS_OF as MOCK_DATA_AS_OF };

function contextTypeReason(type: ContextCheckType): string {
  switch (type) {
    case 'recent_form':
      return 'Recent Form Divergence';
    case 'line_context':
      return 'Line Inflation';
    case 'role_change':
      return 'Role Change';
    case 'roster_change':
      return 'Roster Change';
  }
}

export const MOCK_CANDIDATES = [
  {
    id: 'candidate-brunson-points',
    score: 91,
    reason: contextTypeReason('recent_form'),
    contextType: 'recent_form' as const,
    summary: 'L5: 5/5 · Season: 48%',
    data: MOCK_RECENT_FORM_DIVERGENCE,
  },
  {
    id: 'candidate-haliburton-assists',
    score: 84,
    reason: contextTypeReason('role_change'),
    contextType: 'role_change' as const,
    summary: 'Season minutes: 29.2 · Recent minutes: 35.7',
    data: MOCK_ROLE_CHANGE,
  },
  {
    id: 'candidate-jokic-points',
    score: 78,
    reason: contextTypeReason('line_context'),
    contextType: 'line_context' as const,
    summary: 'Current 29.5 vs recent avg 26.8',
    data: MOCK_LINE_INFLATION,
  },
];
