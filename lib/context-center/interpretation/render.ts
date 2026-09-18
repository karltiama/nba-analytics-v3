/**
 * Deterministic renderer: templateKey + templateParameters → prose.
 * No LLM. No hidden calculations beyond approved formatters already in params.
 */

import {
  formatCountingAverage,
  formatCountingDelta,
  formatCount,
  formatMinutes,
  formatPercentagePointsDelta,
  formatRateAsPercent,
  formatRating,
} from './format';
import { assertSafeRenderedText } from './prohibited-language';
import {
  RECENT_WINDOW_FULL,
  TEMPLATE_KEY,
  type ContextInterpretation,
  type TemplateKey,
} from './types';

function sampleQualifier(params: Record<string, unknown>): string {
  const n = params.recentHistoryN;
  if (typeof n === 'number' && Number.isFinite(n) && n > 0 && n < RECENT_WINDOW_FULL) {
    return ` Recent sample: ${Math.trunc(n)} prior played games.`;
  }
  return '';
}

function homeAwayWord(v: unknown): 'Home' | 'Away' {
  if (v === 'HOME' || v === 'Home' || v === 'home') return 'Home';
  if (v === 'AWAY' || v === 'Away' || v === 'away') return 'Away';
  throw new Error(`Invalid homeAway: ${String(v)}`);
}

export function renderTemplate(
  templateKey: TemplateKey,
  params: Record<string, unknown>
): string {
  switch (templateKey) {
    case TEMPLATE_KEY.AVAILABILITY_HEALTH_OUT_WITH_BURDEN: {
      const count = formatCount(Number(params.healthOutCount));
      const mins = formatMinutes(Number(params.expectedMissingMinutes));
      return `${count} health-related players are Out, representing ${mins} prior rotation minutes based on available historical role estimates.`;
    }
    case TEMPLATE_KEY.AVAILABILITY_PARTIAL_BURDEN: {
      const mins = formatMinutes(Number(params.burdenMinutesFloor));
      const missing = formatCount(Number(params.outWithoutRoleHistory));
      const noun = Number(params.outWithoutRoleHistory) === 1 ? 'player' : 'players';
      return `At least ${mins} prior rotation minutes are represented by health-related absences; role history is unavailable for ${missing} additional Out ${noun}.`;
    }
    case TEMPLATE_KEY.AVAILABILITY_SOURCE_ONLY_COUNTS: {
      const count = formatCount(Number(params.healthOutCount));
      return `${count} health-related players are Out. Historical role estimates are unavailable for those absences.`;
    }
    case TEMPLATE_KEY.SCHEDULE_SEASON_OPENER: {
      const loc = homeAwayWord(params.homeAway).toLowerCase();
      return `Season opener at ${loc}.`;
    }
    case TEMPLATE_KEY.SCHEDULE_B2B: {
      const loc = homeAwayWord(params.homeAway);
      return `${loc} on the second night of a back-to-back.`;
    }
    case TEMPLATE_KEY.SCHEDULE_REST: {
      const loc = homeAwayWord(params.homeAway);
      const days = formatCount(Number(params.daysRest));
      const dayWord = Number(params.daysRest) === 1 ? 'day' : 'days';
      return `${loc} with ${days} ${dayWord} of rest.`;
    }
    case TEMPLATE_KEY.ROLE_RECENT_VS_SEASON: {
      const recent = formatMinutes(Number(params.recent));
      const season = formatMinutes(Number(params.season));
      const delta = formatCountingDelta(Number(params.delta));
      return `Recent playing time is ${recent} minutes per game versus a ${season} season baseline (${delta}).${sampleQualifier(params)}`;
    }
    case TEMPLATE_KEY.ROLE_SHOT_OPPORTUNITY: {
      const recent = formatCountingAverage(Number(params.recentFga));
      const season = formatCountingAverage(Number(params.seasonFga));
      const delta = formatCountingDelta(Number(params.fgaDelta));
      let text = `Recent shot volume is ${recent} FGA per game versus ${season} across the season baseline (${delta}).`;
      if (
        params.includeTpaDelta === true &&
        typeof params.recentTpa === 'number' &&
        typeof params.seasonTpa === 'number' &&
        typeof params.tpaDelta === 'number'
      ) {
        const rt = formatCountingAverage(Number(params.recentTpa));
        const st = formatCountingAverage(Number(params.seasonTpa));
        const dt = formatCountingDelta(Number(params.tpaDelta));
        text += ` Recent three-point attempts are ${rt} per game versus ${st} across the season baseline (${dt}).`;
      }
      return `${text}${sampleQualifier(params)}`;
    }
    case TEMPLATE_KEY.FORM_RECENT_VS_SEASON: {
      const recent = formatCountingAverage(Number(params.recent));
      const season = formatCountingAverage(Number(params.season));
      const delta = formatCountingDelta(Number(params.delta));
      return `Recent scoring is ${recent} points per game versus a ${season} season baseline (${delta}).${sampleQualifier(params)}`;
    }
    case TEMPLATE_KEY.FORM_SHOOTING_PP: {
      const parts: string[] = [];
      if (params.includeFg === true) {
        const recent = formatRateAsPercent(Number(params.recentFgPct));
        const season = formatRateAsPercent(Number(params.seasonFgPct));
        const delta = formatPercentagePointsDelta(Number(params.fgDeltaFraction));
        parts.push(
          `Recent field-goal shooting is ${recent} versus a ${season} season baseline (${delta} percentage points).`
        );
      }
      if (params.includeThree === true) {
        const recent = formatRateAsPercent(Number(params.recentThreePct));
        const season = formatRateAsPercent(Number(params.seasonThreePct));
        const delta = formatPercentagePointsDelta(Number(params.threeDeltaFraction));
        parts.push(
          `Recent three-point shooting is ${recent} versus a ${season} season baseline (${delta} percentage points).`
        );
      }
      if (parts.length === 0) {
        throw new Error('FORM_SHOOTING_PP requires includeFg and/or includeThree');
      }
      return `${parts.join(' ')}${sampleQualifier(params)}`;
    }
    case TEMPLATE_KEY.MATCHUP_SCORING_ENVIRONMENT: {
      const pts = formatCountingAverage(Number(params.recentPoints));
      const drtg = formatRating(Number(params.defensiveRating));
      let text = `The player has averaged ${pts} points recently. The opponent enters with a ${drtg} pregame defensive rating.`;
      if (params.includePace === true && typeof params.pace === 'number') {
        const pace = formatRating(Number(params.pace));
        text = `The player has averaged ${pts} points recently. The opponent enters with a ${drtg} pregame defensive rating at ${pace} possessions per game.`;
      }
      if (
        params.includeOpportunity === true &&
        typeof params.recentFga === 'number'
      ) {
        const fga = formatCountingAverage(Number(params.recentFga));
        text = `The player has averaged ${pts} points on ${fga} FGA recently. The opponent enters with a ${drtg} pregame defensive rating${
          params.includePace === true && typeof params.pace === 'number'
            ? ` at ${formatRating(Number(params.pace))} possessions per game`
            : ''
        }.`;
      }
      return text;
    }
    case TEMPLATE_KEY.MATCHUP_PERIMETER:
    case TEMPLATE_KEY.MATCHUP_PERIMETER_REDUCED: {
      const recentTpa = formatCountingAverage(Number(params.recentTpa));
      const rate = formatRateAsPercent(Number(params.threePointAttemptRateAllowed));
      let lead = `The player has attempted ${recentTpa} threes per game recently`;
      if (
        params.includeSeasonTpa === true &&
        typeof params.seasonTpa === 'number'
      ) {
        const seasonTpa = formatCountingAverage(Number(params.seasonTpa));
        lead += ` versus a ${seasonTpa} season baseline`;
      }
      lead += `. The opponent has allowed ${rate} of opposing field-goal attempts from three.`;
      return lead;
    }
    default: {
      const _exhaustive: never = templateKey;
      throw new Error(`Unknown templateKey: ${String(_exhaustive)}`);
    }
  }
}

export function renderInterpretation(interp: ContextInterpretation): string {
  const text = renderTemplate(interp.templateKey, interp.templateParameters);
  assertSafeRenderedText(text);
  return text;
}
