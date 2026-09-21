/**
 * Curated Team Preseason Preview content model.
 *
 * Presentation is shared; each team supplies one typed module.
 * Editorial fields are analysis/context — not model predictions.
 */

/** Qualitative role-watch signal (editorial, not a projection). */
export type RoleWatchSignal =
  | 'Stable'
  | 'Opportunity ↑'
  | 'Minutes ↑'
  | 'Competition ↑'
  | 'Role TBD'
  | 'Development ↑';

export type PreviewPosition = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export type PreviewPlayerRef = {
  /** Display name. */
  name: string;
  /** NBA.com player id for headshots / player research links when known. */
  nbaPlayerId?: string | null;
  position?: string | null;
};

export type PreviewRosterChange = PreviewPlayerRef & {
  /** One-line context (role / impact framing). */
  context: string;
};

export type PreviewKeyQuestion = {
  headline: string;
  detail: string;
};

export type PreviewPlayerToWatch = PreviewPlayerRef & {
  jerseyNumber?: string | null;
  /** Physical / meta line e.g. "PG · 6'6\" · Age 25" */
  meta?: string | null;
  /** 2–3 sentences: what Court Context is watching. */
  watching: string;
};

export type PreviewRoleWatchRow = {
  player: PreviewPlayerRef;
  previousRole: string;
  watch: RoleWatchSignal;
};

export type PreviewProjectedRotation = {
  starters: Record<PreviewPosition, PreviewPlayerRef | null>;
  keyBench: PreviewPlayerRef[];
};

export type PreviewWowyContextItem = {
  title: string;
  /** Honest framing — historical / monitoring, not causal prediction. */
  detail: string;
};

export type TeamPreseasonPreviewContent = {
  /** Analytics season start year for this preview (e.g. "2026" → 2026–27). */
  season: string;
  /** Stable content key — team abbreviation uppercase (e.g. "DET"). */
  slug: string;
  /** Optional analytics team_id when known; resolver also matches by abbr. */
  teamId?: string | null;

  headline: string;
  dek: string;

  bigPicture: string[];

  keyQuestions: PreviewKeyQuestion[];

  additions: PreviewRosterChange[];
  departures: PreviewRosterChange[];
  /** Draft picks / incoming rookies for this preview season. */
  draftPicks: PreviewRosterChange[];

  /** Curated projected rotation — never labeled as official lineup. */
  projectedRotation: PreviewProjectedRotation | null;

  playersToWatch: PreviewPlayerToWatch[];
  roleWatch: PreviewRoleWatchRow[];

  /**
   * Conservatively framed monitoring notes.
   * Prefer empty + UI placeholder over invented possession WOWY.
   */
  wowyContext: PreviewWowyContextItem[];

  outlook: string;

  /**
   * Optional curated snapshot overrides when DB baseline is missing.
   * Prefer live previous-season baseline; only use these as last resort.
   */
  snapshotNotes?: {
    playoffResult?: string | null;
  };
};

export type PreviewSnapshotField = {
  label: string;
  value: string;
};

/** Resolved page model: curated content + live team/snapshot/schedule. */
export type TeamPreseasonPreviewPageModel = {
  content: TeamPreseasonPreviewContent;
  /** curated = registry module; research_draft = editable homework scaffold. */
  contentSource: 'curated' | 'research_draft';
  /** Absolute or repo-relative path when contentSource is research_draft. */
  draftPath: string | null;
  team: {
    team_id: string;
    abbreviation: string;
    full_name: string;
    conference: string | null;
    division: string | null;
    city: string | null;
  };
  seasonLabel: string;
  /** Prior season label used for snapshot (e.g. 2025–26 when preview is 2026–27). */
  priorSeasonLabel: string;
  snapshotFields: PreviewSnapshotField[];
  snapshotUnavailableReason: string | null;
  schedule: {
    dateLabel: string;
    opponentAbbr: string;
    isHome: boolean;
    timeLabel: string | null;
    href: string | null;
  }[];
  scheduleUnavailableReason: string | null;
};

export const PREVIEW_SECTION_IDS = [
  'overview',
  'roster-changes',
  'players',
  'role-usage',
  'wowy-context',
  'preseason-questions',
  'outlook',
] as const;

export type PreviewSectionId = (typeof PREVIEW_SECTION_IDS)[number];

export const PREVIEW_SUBNAV: { id: PreviewSectionId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'roster-changes', label: 'Roster & Changes' },
  { id: 'players', label: 'Players' },
  { id: 'role-usage', label: 'Role & Usage' },
  { id: 'wowy-context', label: 'WOWY Context' },
  { id: 'preseason-questions', label: 'Preseason Questions' },
  { id: 'outlook', label: 'Outlook' },
];
