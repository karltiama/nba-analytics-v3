import { formatTipoffEt } from '@/lib/betting/format-tipoff-et';
import { gameDetailHref } from '@/lib/betting/research-journey';
import { formatNbaSeasonLabel, getAnalyticsSeason } from '@/lib/season';
import {
  getTeamById,
  resolveAnalyticsTeamId,
} from '@/lib/teams/analytics-queries';
import { getTeamCompactSchedule } from '@/lib/teams/team-compact-schedule-queries';
import { getPreviousSeasonBaseline } from '@/lib/teams/team-previous-season-baseline-queries';
import type { TeamSeasonSnapshot } from '@/lib/teams/team-season-snapshot';
import { previousAnalyticsSeason } from '@/lib/teams/team-roster-continuity';
import {
  previewDraftPath,
  readPreviewDraftContent,
} from './automation/storage';
import { getPreseasonPreviewContentForTeam } from './registry';
import { buildSnapshotFields } from './snapshot-fields';
import type {
  TeamPreseasonPreviewContent,
  TeamPreseasonPreviewPageModel,
} from './types';

function formatScheduleDate(startTime: string | null): string {
  if (!startTime) return 'TBD';
  const d = new Date(startTime);
  if (Number.isNaN(d.getTime())) return 'TBD';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

async function resolvePreviewContent(args: {
  abbreviation: string;
  teamId: string;
  season: string;
}): Promise<{
  content: TeamPreseasonPreviewContent;
  source: 'curated' | 'research_draft';
} | null> {
  const curated = getPreseasonPreviewContentForTeam({
    abbreviation: args.abbreviation,
    teamId: args.teamId,
  });
  if (curated) return { content: curated, source: 'curated' };

  const draft = await readPreviewDraftContent(args.season, args.abbreviation);
  if (draft) return { content: draft, source: 'research_draft' };

  return null;
}

/**
 * Load curated preview (preferred) or research-derived draft scaffold,
 * plus live team identity / prior-season snapshot / schedule.
 * Returns null when team cannot be resolved or neither content source exists.
 */
export async function loadTeamPreseasonPreview(
  teamIdOrAbbr: string
): Promise<TeamPreseasonPreviewPageModel | null> {
  const analyticsTeamId = await resolveAnalyticsTeamId(teamIdOrAbbr);
  if (!analyticsTeamId) return null;

  const team = await getTeamById(analyticsTeamId);
  if (!team) return null;

  const season = getAnalyticsSeason();
  const resolved = await resolvePreviewContent({
    abbreviation: team.abbreviation,
    teamId: team.team_id,
    season,
  });
  if (!resolved) return null;

  const { content, source } = resolved;
  const priorSeason = previousAnalyticsSeason(content.season);
  const [baseline, compactSchedule] = await Promise.all([
    getPreviousSeasonBaseline(analyticsTeamId, content.season),
    getTeamCompactSchedule(analyticsTeamId, content.season, {
      limitUpcoming: 5,
      limitRecent: 0,
    }),
  ]);

  const snap = baseline.available
    ? baseline.snapshot
    : ({
        season: priorSeason,
        hasData: false,
        gamesPlayed: 0,
        wins: null,
        losses: null,
        ppg: null,
        ortg: null,
        drtg: null,
        netRating: null,
        pace: null,
        sampleBand: 'none' as const,
        sampleLabel: null,
        metricsScope: 'all_games' as const,
        includesPostseason: false,
        scopeNote: null,
      } satisfies TeamSeasonSnapshot);

  const priorSeasonLabel = formatNbaSeasonLabel(
    baseline.available ? baseline.baselineSeason : priorSeason
  );

  const snapshotFields = buildSnapshotFields(snap, content);

  const schedule = compactSchedule.upcoming.map((g) => {
    const timeLabel = formatTipoffEt(g.start_time) || null;
    return {
      dateLabel: formatScheduleDate(g.start_time),
      opponentAbbr: g.opponent_abbr,
      isHome: g.is_home,
      timeLabel,
      href: gameDetailHref(g.game_id),
    };
  });

  return {
    content,
    team: {
      team_id: team.team_id,
      abbreviation: team.abbreviation,
      full_name: team.full_name,
      conference: team.conference,
      division: team.division,
      city: team.city,
    },
    seasonLabel: formatNbaSeasonLabel(content.season),
    priorSeasonLabel,
    snapshotFields,
    snapshotUnavailableReason:
      snapshotFields.length === 0
        ? (baseline.unavailableReason ??
          'Previous season baseline unavailable')
        : null,
    schedule,
    scheduleUnavailableReason:
      schedule.length === 0
        ? 'Preseason schedule not available yet for this season.'
        : null,
    contentSource: source,
    draftPath:
      source === 'research_draft'
        ? previewDraftPath(content.season, content.slug)
        : null,
  };
}
