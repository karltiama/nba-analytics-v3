import { formatDirectionLabel } from './format';
import type {
  ContextCheckData,
  ContextCheckSample,
  ContextCheckType,
  ContextCheckVerdict,
} from './types';

const DATA_AS_OF = '2026-09-08T16:00:00.000Z';

/** Mock editorial action photos — layout assets only, not production identity. */
const HERO_ACTION_A =
  'https://images.unsplash.com/photo-1504450758481-7338eba7524a?auto=format&fit=crop&w=1200&q=80';
const HERO_ACTION_C =
  'https://images.unsplash.com/photo-1515523110800-9415d6dd807c?auto=format&fit=crop&w=1200&q=80';

const HEADSHOT_CURRY = 'https://cdn.nba.com/headshots/nba/latest/1040x760/201939.png';
const HEADSHOT_BRUNSON = 'https://cdn.nba.com/headshots/nba/latest/1040x760/1628973.png';
const HEADSHOT_JOKIC = 'https://cdn.nba.com/headshots/nba/latest/1040x760/203999.png';
const HEADSHOT_HALIBURTON = 'https://cdn.nba.com/headshots/nba/latest/1040x760/1630169.png';

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
  explanation: 'The streak is real. The line has moved too.',
};

/**
 * Mock A — action image + line context, mixed verdict.
 */
export const MOCK_ACTION_LINE_MIXED: ContextCheckData = {
  id: 'mock-cc-curry-threes-over',
  player: {
    id: 'mock-stephen-curry',
    name: 'Stephen Curry',
    teamAbbreviation: 'GSW',
    teamName: 'Golden State Warriors',
    heroImageUrl: HERO_ACTION_A,
    headshotUrl: HEADSHOT_CURRY,
  },
  market: { type: 'threes', direction: 'over', line: 4.5 },
  headline: headlineFromL5(sample('L5', 4, 5), 'over'),
  samples: [sample('L5', 4, 5), sample('L10', 6, 10), sample('L20', 11, 20), sample('Season', 41, 79)],
  lineContext: {
    currentLine: 4.5,
    last5AverageLine: 3.9,
    difference: 0.6,
  },
  verdict: MIXED_FORM_VERDICT,
  contextType: 'line_context',
  dataAsOf: DATA_AS_OF,
  source: 'automatic',
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
    heroImageUrl: HERO_ACTION_A,
    headshotUrl: HEADSHOT_BRUNSON,
  },
  market: { type: 'points', direction: 'over', line: 27.5 },
  headline: headlineFromL5(sample('L5', 5, 5), 'over'),
  samples: [sample('L5', 5, 5), sample('L10', 7, 10), sample('L20', 11, 20), sample('Season', 22, 46)],
  lineContext: {
    currentLine: 27.5,
    last5AverageLine: 26.1,
    difference: 1.4,
  },
  verdict: {
    type: 'mixed',
    title: 'Mixed Context',
    explanation: 'Recent form is strong, but the season-long hit rate is closer to a coin flip.',
  },
  contextType: 'recent_form',
  dataAsOf: DATA_AS_OF,
  source: 'automatic',
};

/**
 * Mock C — action image, larger sample weakens the claim.
 */
export const MOCK_LINE_INFLATION: ContextCheckData = {
  id: 'mock-cc-jokic-points-over',
  player: {
    id: 'mock-nikola-jokic',
    name: 'Nikola Jokic',
    teamAbbreviation: 'DEN',
    teamName: 'Denver Nuggets',
    heroImageUrl: HERO_ACTION_C,
    headshotUrl: HEADSHOT_JOKIC,
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
    explanation: 'The headline trend looks weaker in the larger sample.',
  },
  contextType: 'line_context',
  dataAsOf: DATA_AS_OF,
  source: 'automatic',
};

/**
 * Mock B — no action image, headshot fallback, role context.
 */
export const MOCK_ROLE_CHANGE: ContextCheckData = {
  id: 'mock-cc-haliburton-assists-over',
  player: {
    id: 'mock-tyrese-haliburton',
    name: 'Tyrese Haliburton',
    teamAbbreviation: 'IND',
    teamName: 'Indiana Pacers',
    headshotUrl: HEADSHOT_HALIBURTON,
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
    explanation: 'Recent production improved, but the role may still be settling.',
  },
  contextType: 'role_change',
  dataAsOf: DATA_AS_OF,
  source: 'automatic',
};

/**
 * Mock D — no hero and no headshot; generic fallback must still look intentional.
 */
export const MOCK_MISSING_IMAGE: ContextCheckData = {
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
    explanation: 'There is not enough stable evidence to interpret this claim yet.',
  },
  contextType: 'roster_change',
  dataAsOf: DATA_AS_OF,
  source: 'manual',
};

/** Extra fixture kept for insufficient/roster coverage. */
export const MOCK_INSUFFICIENT_ROSTER = MOCK_MISSING_IMAGE;

/**
 * Mock E — long player name must wrap without breaking the poster.
 */
export const MOCK_LONG_NAME: ContextCheckData = {
  id: 'mock-cc-giannis-pra-over',
  player: {
    id: 'mock-giannis-antetokounmpo',
    name: 'Giannis Antetokounmpo',
    teamAbbreviation: 'MIL',
    teamName: 'Milwaukee Bucks',
    heroImageUrl: HERO_ACTION_C,
  },
  market: { type: 'pra', direction: 'over', line: 42.5 },
  headline: headlineFromL5(sample('L5', 4, 5), 'over'),
  samples: [sample('L5', 4, 5), sample('L10', 7, 10), sample('L20', 13, 20), sample('Season', 33, 62)],
  lineContext: {
    currentLine: 42.5,
    last5AverageLine: 41.2,
    difference: 1.3,
  },
  verdict: {
    type: 'mixed',
    title: 'Mixed Context',
    explanation: 'The short sample is strong. The season rate is closer to even.',
  },
  contextType: 'recent_form',
  dataAsOf: DATA_AS_OF,
  source: 'automatic',
};

export const MOCK_CONTEXT_CHECKS: readonly ContextCheckData[] = [
  MOCK_ACTION_LINE_MIXED,
  MOCK_RECENT_FORM_DIVERGENCE,
  MOCK_LINE_INFLATION,
  MOCK_ROLE_CHANGE,
  MOCK_MISSING_IMAGE,
  MOCK_LONG_NAME,
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
    id: 'candidate-curry-threes',
    score: 93,
    reason: contextTypeReason('line_context'),
    contextType: 'line_context' as const,
    summary: 'L5: 4/5 · Season: 52%',
    data: MOCK_ACTION_LINE_MIXED,
  },
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
  {
    id: 'candidate-edwards-fallback',
    score: 61,
    reason: contextTypeReason('roster_change'),
    contextType: 'roster_change' as const,
    summary: 'No player visual — fallback test',
    data: MOCK_MISSING_IMAGE,
  },
  {
    id: 'candidate-giannis-long-name',
    score: 74,
    reason: contextTypeReason('recent_form'),
    contextType: 'recent_form' as const,
    summary: 'Long-name layout check',
    data: MOCK_LONG_NAME,
  },
];
