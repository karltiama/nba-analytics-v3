import type { ChecklistItemId, CoachmarkId, GuidanceLevel, PrimaryIntent } from './contract';

export const ONBOARDING_WELCOME = {
  title: 'Welcome to Court Context',
  body: 'Understand the context behind props, parlays, players, and games — then make your own decision.',
  research: 'Research a player prop',
  analyze: 'Review a parlay you assembled',
} as const;

export const INTENT_COPY: Record<PrimaryIntent, { title: string; desc: string }> = {
  research_props: {
    title: 'Research player props',
    desc: 'Browse exact offers, compare books, and add a leg to your parlay.',
  },
  analyze_parlay: {
    title: 'Analyze a parlay',
    desc: 'Review selected legs in Parlay Workspace — Court Context analysis runs there.',
  },
  research_players_games: {
    title: 'Research players and games',
    desc: 'Open team and player pages for basketball context.',
  },
  explore: {
    title: 'Explore Court Context',
    desc: 'Start on the dashboard and look around.',
  },
};

export const GUIDANCE_COPY: Record<GuidanceLevel, { title: string; desc: string }> = {
  getting_started: {
    title: "I'm just getting started",
    desc: 'Show a few short tips on the first screens.',
  },
  stats_researcher: {
    title: 'I check stats and trends',
    desc: 'Keep tips to the essentials.',
  },
  advanced: {
    title: 'I compare lines and deeper analytics',
    desc: 'Skip automatic tips. Help stays in the account menu.',
  },
};

export const COACHMARK_COPY: Record<CoachmarkId, { title: string; body: string }> = {
  'props-discover': {
    title: 'Find an offer',
    body: 'Filter by player, market, game, or sportsbook to research the exact prop you care about.',
  },
  'props-compare': {
    title: 'Compare books',
    body: 'Compare books and see 3-Hour Pre-Tip → Decision Close movement. This is not Opening line.',
  },
  'props-add-parlay': {
    title: 'Add to Parlay',
    body: 'Found a leg you like? Add the exact offer to your Parlay Workspace.',
  },
  'workspace-intro': {
    title: 'This is your Parlay Workspace',
    body: 'Court Context analyzes your selected or imported legs here. Edit the slip anytime; analysis refreshes for the current legs.',
  },
  'workspace-analyze': {
    title: 'Court Context analysis',
    body: 'Analysis runs automatically in Parlay Workspace when the slip is eligible. Use Edit Parlay to adjust legs.',
  },
  'why-fail': {
    title: 'Why this parlay could fail',
    body: 'Court Context looks for counter-signals, shared dependencies, line movement, and missing information — not just reasons a wager could work.',
  },
  'xray-flow': {
    title: 'Upload → Review → Confirm → Workspace',
    body: 'XRay imports a slip. Confirm is the trust boundary. Court Context analysis happens in Workspace, not on this page. This preview does not enable public screenshot reading.',
  },
};

export const CHECKLIST_COPY: Record<ChecklistItemId, string> = {
  explore_prop: 'Explore a prop',
  compare_opened: 'Compare market movement',
  parlay_leg_added: 'Add a prop to a parlay',
  workspace_analyzed: 'Analyze a parlay',
};

export const PRODUCT_MAP = [
  {
    href: '/betting/props-explorer',
    title: 'Props Explorer',
    body: 'Discover and compare props.',
  },
  {
    href: '/parlay-workspace',
    title: 'Parlay Workspace',
    body: 'Review and analyze the parlay as a whole.',
  },
  {
    href: '/teams',
    title: 'Players & Games',
    body: 'Research deeper basketball context.',
  },
] as const;

export const XRAY_MAP_UNAVAILABLE = {
  title: 'Parlay XRay',
  body: 'Import a slip you have already built. Screenshot reading is not available yet.',
} as const;

export const EXISTING_USER_PROMPT = {
  title: 'New: personalize Court Context',
  body: 'A short, optional setup routes you to Props, Workspace, or the dashboard.',
  cta: 'Take the quick tour',
  dismiss: 'Not now',
} as const;
