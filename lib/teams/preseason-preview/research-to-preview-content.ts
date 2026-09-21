/**
 * Map a V1.2 research packet → editable TeamPreseasonPreviewContent scaffold.
 *
 * Output is homework-shaped prose with [EDIT] markers — not publishable copy.
 * Humans edit the draft JSON, then promote into curated registry modules.
 */

import type { PreseasonResearchPacket } from './automation/research-packet-types';
import type {
  RoleWatchSignal,
  TeamPreseasonPreviewContent,
} from './types';

const EDIT = '[EDIT]';

function roleWatchFromKind(kind: string): RoleWatchSignal {
  switch (kind) {
    case 'VACATED_MINUTES':
    case 'NEW_HIGH_MINUTE_ADDITION':
      return 'Opportunity ↑';
    case 'RECENT_COMPETITIVE_MINUTES_INCREASE':
      return 'Minutes ↑';
    case 'HIGH_USAGE_RETURNER':
    case 'TOP_USAGE_RETURNER':
    case 'RETURNING_HIGH_MINUTE_PLAYER':
      return 'Stable';
    default:
      return 'Role TBD';
  }
}

function reviewNote(p: {
  requiresHumanRosterReview?: boolean;
  reviewReasons?: string[];
  otherTeamAbbr?: string | null;
  status: string;
}): string {
  const bits: string[] = [];
  if (p.otherTeamAbbr) bits.push(`↔ ${p.otherTeamAbbr}`);
  if (p.requiresHumanRosterReview && p.reviewReasons?.length) {
    bits.push(`review: ${p.reviewReasons.join(', ')}`);
  }
  bits.push(`${EDIT} add role/impact context`);
  return bits.join(' · ');
}

/**
 * Build preview content from research packet.
 * Does not invent WOWY metrics, starters, or speculative claims.
 *
 * `nbaIdsByEntity` maps player_entity_id → NBA.com id for headshots.
 * Analytics/BDL `playerId` must never be written to nbaPlayerId.
 */
export function researchPacketToPreviewContent(
  research: PreseasonResearchPacket,
  nbaIdsByEntity: Map<string, string> = new Map()
): TeamPreseasonPreviewContent {
  const rs = research.snapshot.regularSeason;
  const teamName = research.team.name;
  const record =
    rs.available && rs.record
      ? `${rs.record} regular-season (${rs.gamesPlayed} GP)`
      : 'prior regular-season record unavailable';

  const nbaId = (entityId: string): string | null =>
    nbaIdsByEntity.get(entityId) ?? null;

  const flagged = [
    ...research.roster.departures,
    ...research.roster.additions,
  ].filter((p) => p.requiresHumanRosterReview);

  const bigPicture: string[] = [
    `${EDIT} ${teamName} — opening framing. Prior season public snapshot: ${record}. Replace this paragraph with your big-picture thesis.`,
    research.roster.unresolved.length > 0
      ? `${EDIT} Unresolved roster statuses (do not treat as confirmed departures): ${research.roster.unresolved.map((u) => u.displayName).join(', ')}.`
      : `${EDIT} Optional second paragraph: continuity vs change, vacated minutes, or usage questions from the research packet.`,
  ];

  if (flagged.length > 0) {
    bigPicture.push(
      `${EDIT} High-impact moves flagged for human review: ${flagged
        .map(
          (p) =>
            `${p.displayName} [${p.status}]${p.otherTeamAbbr ? `→${p.otherTeamAbbr}` : ''}`
        )
        .join('; ')}. Verify against open-roster sources before publishing.`
    );
  }

  const keyQuestions = research.researchQuestions.slice(0, 6).map((q) => ({
    headline: q.text,
    detail: `${EDIT} Expand using evidence: ${q.evidence.join(' · ') || 'none listed'}.`,
  }));

  if (keyQuestions.length === 0) {
    keyQuestions.push({
      headline: `${EDIT} Add a preseason question`,
      detail: `${EDIT} Use research packet questions / unresolved items as prompts.`,
    });
  }

  const additions = research.roster.additions.map((p) => ({
    name: p.displayName,
    nbaPlayerId: nbaId(p.playerEntityId),
    position: p.position,
    context: reviewNote(p),
  }));

  const departures = research.roster.departures.map((p) => ({
    name: p.displayName,
    nbaPlayerId: nbaId(p.playerEntityId),
    position: p.position,
    context: reviewNote(p),
  }));

  const playersToWatch = research.playersToWatchCandidates
    .slice(0, 8)
    .map((c) => ({
      name: c.displayName,
      nbaPlayerId: nbaId(c.playerEntityId),
      position: null,
      meta:
        c.relevantStats.mpg != null
          ? `Prior ~${c.relevantStats.mpg.toFixed(1)} MPG` +
            (c.relevantStats.ppg != null
              ? ` · ${c.relevantStats.ppg.toFixed(1)} PPG`
              : '')
          : null,
      watching: `${EDIT} Candidate reasons: ${c.reasons.join(', ')}. Rewrite as 2–3 sentences of what Court Context is watching — not a projection.`,
    }));

  const roleWatch = research.roleUsageShiftCandidates.slice(0, 12).map((r) => ({
    player: {
      name: r.displayName,
      nbaPlayerId: nbaId(r.playerEntityId),
      position: null,
    },
    previousRole: r.claim.text,
    watch: roleWatchFromKind(r.kind),
  }));

  const wowyContext = research.wowyCandidates
    .filter((w) => w.status === 'CANDIDATE_FOR_REVIEW' || w.status === 'HAS_DATA')
    .slice(0, 6)
    .map((w) => ({
      title: w.label,
      detail:
        w.status === 'HAS_DATA' && w.sampleSize
          ? `${EDIT} Has sample (with=${w.sampleSize.withGames}, without=${w.sampleSize.withoutGames}). Frame as historical monitoring only — ${w.reason}`
          : `${EDIT} Candidate for review only — ${w.reason}. Do not invent possession splits.`,
    }));

  const notable =
    research.notableStats.length > 0
      ? research.notableStats
          .slice(0, 4)
          .map((s) => `${s.label}: ${s.value}`)
          .join('; ')
      : null;

  return {
    season: research.season,
    slug: research.team.slug.toUpperCase(),
    teamId: research.team.teamId,

    headline: teamName,
    dek: `${EDIT} One-line dek for ${teamName} (${research.season}–${String(Number(research.season) + 1).slice(-2)}). Prior RS: ${record}.`,

    bigPicture,

    keyQuestions,

    additions,
    departures,
    draftPicks: [],

    projectedRotation: null,

    playersToWatch,
    roleWatch,

    wowyContext,

    outlook: notable
      ? `${EDIT} Outlook draft seed from notable stats (${notable}). Rewrite as qualitative outlook — not a prediction.`
      : `${EDIT} Write the closing outlook. Keep it contextual; no invented standings or series forecasts.`,

    snapshotNotes: {
      playoffResult: null,
    },
  };
}
