/**
 * Historical Timeline v1 read model (Step 12G).
 * Client-safe: no fs/S3. Normalization and quality gates live here so React
 * never interprets provider Plays JSON.
 *
 * Official final score remains analytics.games. Plays running scores are
 * display/progression only. No possessions, WOWY, or shot coordinates.
 */

export const HISTORICAL_TIMELINE_SEASON = '2025';
export const HISTORICAL_TIMELINE_SOURCE = 'bdl_plays_2025_canonical';

/** Combined Plays/official total below this ratio → truncated stream (fail closed). */
export const STREAM_TRUNCATION_SCORE_RATIO = 0.7;
/** Official combined points that imply a full NBA game for truncation checks. */
export const FULL_GAME_OFFICIAL_TOTAL_MIN = 80;
/** Combined-point deficit + missing End Game → truncated even if ratio ≥ 0.70. */
export const STREAM_TRUNCATION_DEFICIT_WITHOUT_END_GAME = 20;

export const PLAYS_2025_STARTER_ANOMALY_IDS = ['18447931', '18447988'] as const;

/** Certified 9E/12A score-mismatch list. Do not silently replace. */
export const PLAYS_2025_SCORE_MISMATCH_IDS = [
  '18446874',
  '18446876',
  '18446885',
  '18446886',
  '18446941',
  '18447009',
  '18447024',
  '18447157',
  '18447188',
  '18447236',
  '18447292',
  '18447388',
  '18447389',
  '18447390',
  '18447432',
  '18447741',
  '18447742',
  '18447470',
  '18447953',
  '21709227',
] as const;

export type RotationFailureClass =
  | 'MISSING_PARTICIPANT'
  | 'BOTH_OFF_COURT'
  | 'BOTH_ON_COURT'
  | 'STARTER_ANOMALY';

/** Certified 9E rotation reconstruction failures (36). Independent of Timeline. */
export const PLAYS_2025_ROTATION_FAILURE_BY_GAME: Record<string, Exclude<RotationFailureClass, 'STARTER_ANOMALY'>> =
  {
    '18446876': 'BOTH_OFF_COURT',
    '18446886': 'BOTH_ON_COURT',
    '18446930': 'MISSING_PARTICIPANT',
    '18446957': 'MISSING_PARTICIPANT',
    '18446964': 'MISSING_PARTICIPANT',
    '18446979': 'MISSING_PARTICIPANT',
    '18446994': 'MISSING_PARTICIPANT',
    '18447007': 'MISSING_PARTICIPANT',
    '18447009': 'BOTH_ON_COURT',
    '18447019': 'MISSING_PARTICIPANT',
    '18447074': 'BOTH_OFF_COURT',
    '18447087': 'MISSING_PARTICIPANT',
    '18447330': 'MISSING_PARTICIPANT',
    '18447390': 'BOTH_ON_COURT',
    '18447432': 'MISSING_PARTICIPANT',
    '18447480': 'BOTH_OFF_COURT',
    '18447498': 'MISSING_PARTICIPANT',
    '18447684': 'MISSING_PARTICIPANT',
    '18447700': 'MISSING_PARTICIPANT',
    '18447720': 'MISSING_PARTICIPANT',
    '18447721': 'MISSING_PARTICIPANT',
    '18447738': 'MISSING_PARTICIPANT',
    '18447741': 'BOTH_ON_COURT',
    '18447742': 'BOTH_OFF_COURT',
    '18447743': 'BOTH_OFF_COURT',
    '18447752': 'MISSING_PARTICIPANT',
    '18447761': 'MISSING_PARTICIPANT',
    '18447799': 'MISSING_PARTICIPANT',
    '18447802': 'MISSING_PARTICIPANT',
    '18447817': 'MISSING_PARTICIPANT',
    '18447827': 'MISSING_PARTICIPANT',
    '18447831': 'MISSING_PARTICIPANT',
    '18447844': 'MISSING_PARTICIPANT',
    '18447908': 'MISSING_PARTICIPANT',
    '18447928': 'MISSING_PARTICIPANT',
    '18448017': 'MISSING_PARTICIPANT',
  };

export type TimelineEventCategory =
  | 'scoring'
  | 'shot_missed'
  | 'free_throw'
  | 'rebound'
  | 'turnover'
  | 'foul'
  | 'substitution'
  | 'timeout'
  | 'jump_ball'
  | 'review'
  | 'period'
  | 'other';

export type StreamClass = 'complete' | 'truncated' | 'uncertain';

export type TimelineQualityCode =
  | 'TIMELINE_OK'
  | 'SCORE_MISMATCH'
  | 'STREAM_TRUNCATED'
  | 'MALFORMED_ORDER'
  | 'NO_EVENTS';

export type NormalizedTimelineEvent = {
  gameId: string;
  order: number;
  period: number | null;
  periodLabel: string;
  clock: string | null;
  clockSecondsRemaining: number | null;
  category: TimelineEventCategory;
  rawType: string;
  description: string | null;
  teamId: string | null;
  primaryPlayerId: string | null;
  secondaryPlayerId: string | null;
  primaryPlayerName: string | null;
  secondaryPlayerName: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
  scoreValue: number | null;
  scoringPlay: boolean;
  substitutionPlayerIds: string[];
  leadChange: boolean;
  becameTied: boolean;
};

export type TimelineQuality = {
  timelineAvailable: boolean;
  scoreReconciled: boolean;
  streamComplete: boolean;
  streamClass: StreamClass;
  rotationContextAvailable: boolean;
  rotationFailureClass: RotationFailureClass | null;
  qualityCode: TimelineQualityCode;
};

export type GameFlowSummary = {
  gameId: string;
  season: string;
  source: string;
  timelineAvailable: boolean;
  scoreReconciled: boolean;
  streamComplete: boolean;
  streamClass: StreamClass;
  qualityCode: TimelineQualityCode;
  playsFinalHome: number | null;
  playsFinalAway: number | null;
  eventCount: number;
  periodCount: number;
  overtimeCount: number;
  leadChanges: number | null;
  ties: number | null;
  largestHomeLead: number | null;
  largestAwayLead: number | null;
  largestHomeRun: number | null;
  largestAwayRun: number | null;
  homePointsByPeriod: number[];
  awayPointsByPeriod: number[];
  rotationAvailable: boolean;
  rotationFailureClass: RotationFailureClass | null;
};

export type HistoricalGameTimeline = {
  available: boolean;
  quality: TimelineQuality;
  gameFlow: GameFlowSummary | null;
  events: NormalizedTimelineEvent[];
  officialHomeScore: number | null;
  officialAwayScore: number | null;
};

type Leader = 'home' | 'away' | 'tie';

function asFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function asText(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.length ? s : null;
}

function normalizeTypeKey(rawType: string): string {
  return rawType.replace(/\s+/g, ' ').trim();
}

export function periodLabel(period: number | null | undefined): string {
  const p = asFiniteNumber(period);
  if (p == null || p < 1) return '';
  const n = Math.floor(p);
  if (n <= 4) return `Q${n}`;
  if (n === 5) return 'OT';
  return `${n - 4}OT`;
}

/**
 * Clock is display metadata. Canonical chronology is `order`.
 * Formats observed: M:SS, MM:SS, optional fractional seconds, and sub-minute SS.s.
 */
export function parseClockToSeconds(clock: string | null | undefined): number | null {
  if (clock == null) return null;
  const s = String(clock).trim();
  if (!s) return null;
  const mmss = s.match(/^(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
  if (mmss) {
    const minutes = Number(mmss[1]);
    const seconds = Number(mmss[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
    const frac = mmss[3] ? Number(`0.${mmss[3]}`) : 0;
    if (!Number.isFinite(frac)) return null;
    return minutes * 60 + seconds + frac;
  }
  const onlySeconds = s.match(/^(\d{1,2}(?:\.\d+)?)$/);
  if (!onlySeconds) return null;
  const n = Number(onlySeconds[1]);
  return Number.isFinite(n) ? n : null;
}

export function mapTimelineEventCategory(
  rawType: string,
  scoringPlay: boolean,
  shootingPlay: boolean
): TimelineEventCategory {
  const type = normalizeTypeKey(rawType);
  if (!type) return 'other';
  if (type === 'Substitution') return 'substitution';
  if (type === 'Jumpball' || type === 'Jump Ball') return 'jump_ball';
  if (type === 'End Period' || type === 'End Game' || type === 'Start Period' || type === 'Start Game') {
    return 'period';
  }
  if (/review|challenge/i.test(type)) return 'review';
  if (/timeout/i.test(type) && !/turnover/i.test(type)) return 'timeout';
  if (/rebound/i.test(type)) return 'rebound';
  if (/turnover/i.test(type) || type === 'Traveling') return 'turnover';
  if (/^free throw/i.test(type)) return 'free_throw';
  if (/foul/i.test(type)) return 'foul';
  if (shootingPlay && !scoringPlay) return 'shot_missed';
  if (scoringPlay) return 'scoring';
  return 'other';
}

export function extractParticipantIds(raw: Record<string, unknown>): string[] {
  const participants = raw.participants;
  if (!Array.isArray(participants)) return [];
  const ids: string[] = [];
  for (const item of participants) {
    if (item == null) continue;
    if (typeof item === 'string' || typeof item === 'number') {
      const s = String(item).trim();
      if (s) ids.push(s);
      continue;
    }
    if (typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const nested =
        obj.id ??
        obj.player_id ??
        (obj.player && typeof obj.player === 'object'
          ? (obj.player as Record<string, unknown>).id
          : null) ??
        (obj.athlete && typeof obj.athlete === 'object'
          ? (obj.athlete as Record<string, unknown>).id
          : null);
      const s = nested == null ? '' : String(nested).trim();
      if (s) ids.push(s);
    }
  }
  return ids;
}

export function extractEventTeamId(raw: Record<string, unknown>): string | null {
  if (raw.team && typeof raw.team === 'object' && !Array.isArray(raw.team)) {
    const id = (raw.team as Record<string, unknown>).id;
    const s = id == null ? '' : String(id).trim();
    if (s) return s;
  }
  const flat = raw.team_id;
  const s = flat == null ? '' : String(flat).trim();
  return s || null;
}

export function isCertifiedScoreMismatch(gameId: string): boolean {
  return (PLAYS_2025_SCORE_MISMATCH_IDS as readonly string[]).includes(String(gameId));
}

export function rotationContextForGame(
  gameId: string,
  opts?: { inPlays2025Archive?: boolean }
): {
  available: boolean;
  failureClass: RotationFailureClass | null;
} {
  const id = String(gameId);
  if (!opts?.inPlays2025Archive) {
    return { available: false, failureClass: null };
  }
  if ((PLAYS_2025_STARTER_ANOMALY_IDS as readonly string[]).includes(id)) {
    return { available: false, failureClass: 'STARTER_ANOMALY' };
  }
  const failure = PLAYS_2025_ROTATION_FAILURE_BY_GAME[id];
  if (failure) return { available: false, failureClass: failure };
  return { available: true, failureClass: null };
}

export function shouldShowHistoricalTimeline(
  availability: { timeline?: boolean } | null | undefined
): boolean {
  return availability?.timeline === true;
}

function leaderOf(home: number, away: number): Leader {
  if (home > away) return 'home';
  if (away > home) return 'away';
  return 'tie';
}

export function classifyStreamCompleteness(input: {
  eventCount: number;
  maxPeriod: number | null;
  hasEndGame: boolean;
  orderMalformed: boolean;
  playsFinalHome: number | null;
  playsFinalAway: number | null;
  officialHome: number | null;
  officialAway: number | null;
}): StreamClass {
  if (input.eventCount <= 0 || input.orderMalformed) return 'truncated';
  const playsTotal =
    input.playsFinalHome != null && input.playsFinalAway != null
      ? input.playsFinalHome + input.playsFinalAway
      : null;
  const officialTotal =
    input.officialHome != null && input.officialAway != null
      ? input.officialHome + input.officialAway
      : null;

  if (officialTotal != null && officialTotal >= FULL_GAME_OFFICIAL_TOTAL_MIN) {
    if (playsTotal != null && playsTotal / officialTotal < STREAM_TRUNCATION_SCORE_RATIO) {
      return 'truncated';
    }
    if (input.maxPeriod != null && input.maxPeriod < 4) return 'truncated';
    if (
      !input.hasEndGame &&
      playsTotal != null &&
      officialTotal - playsTotal >= STREAM_TRUNCATION_DEFICIT_WITHOUT_END_GAME
    ) {
      return 'truncated';
    }
  }

  if (!input.hasEndGame && officialTotal != null && playsTotal != null) {
    const ratio = playsTotal / officialTotal;
    if (ratio < 0.95 && ratio >= STREAM_TRUNCATION_SCORE_RATIO) return 'uncertain';
  }
  return 'complete';
}

export function timelineQualityCode(input: {
  eventCount: number;
  orderMalformed: boolean;
  streamClass: StreamClass;
  scoreReconciled: boolean;
}): TimelineQualityCode {
  if (input.eventCount <= 0) return 'NO_EVENTS';
  if (input.orderMalformed) return 'MALFORMED_ORDER';
  if (input.streamClass === 'truncated') return 'STREAM_TRUNCATED';
  if (!input.scoreReconciled) return 'SCORE_MISMATCH';
  return 'TIMELINE_OK';
}

/**
 * 12H Key Events: deterministic filters, not an importance score.
 * Not official "clutch" (NBA.com clutch is last 5:00 within 5 — deferred).
 */
export function isKeyTimelineEvent(event: NormalizedTimelineEvent): boolean {
  if (event.category === 'period') return true;
  if (event.leadChange) return true;
  if (event.becameTied) return true;
  if (
    event.scoringPlay &&
    event.period != null &&
    event.period >= 4 &&
    event.clockSecondsRemaining != null &&
    event.clockSecondsRemaining <= 300
  ) {
    return true;
  }
  return false;
}

export function emptyTimeline(gameId: string, officialHome: number | null, officialAway: number | null): HistoricalGameTimeline {
  const rotation = rotationContextForGame(gameId, { inPlays2025Archive: false });
  const quality: TimelineQuality = {
    timelineAvailable: false,
    scoreReconciled: false,
    streamComplete: false,
    streamClass: 'truncated',
    rotationContextAvailable: rotation.available,
    rotationFailureClass: rotation.failureClass,
    qualityCode: 'NO_EVENTS',
  };
  return {
    available: false,
    quality,
    gameFlow: null,
    events: [],
    officialHomeScore: officialHome,
    officialAwayScore: officialAway,
  };
}

export function normalizePlayEvent(raw: Record<string, unknown>, fallbackGameId: string): NormalizedTimelineEvent | null {
  const order = asFiniteNumber(raw.order);
  if (order == null) return null;
  const gameId = asText(raw.game_id) ?? fallbackGameId;
  const period = asFiniteNumber(raw.period);
  const clock = asText(raw.clock);
  const rawType = asText(raw.type) ?? '';
  const scoringPlay = asBool(raw.scoring_play);
  const shootingPlay = asBool(raw.shooting_play);
  const participantIds = extractParticipantIds(raw);
  const category = mapTimelineEventCategory(rawType, scoringPlay, shootingPlay);
  return {
    gameId: String(gameId),
    order,
    period,
    periodLabel: periodLabel(period),
    clock,
    clockSecondsRemaining: parseClockToSeconds(clock),
    category,
    rawType,
    description: asText(raw.text),
    teamId: extractEventTeamId(raw),
    primaryPlayerId: participantIds[0] ?? null,
    secondaryPlayerId: participantIds[1] ?? null,
    primaryPlayerName: null,
    secondaryPlayerName: null,
    scoreHome: asFiniteNumber(raw.home_score),
    scoreAway: asFiniteNumber(raw.away_score),
    scoreValue: asFiniteNumber(raw.score_value),
    scoringPlay,
    substitutionPlayerIds: category === 'substitution' ? participantIds : [],
    leadChange: false,
    becameTied: false,
  };
}

/**
 * Sort by `order` only. Same-clock events keep provider order.
 * Duplicate / gap / null-order detection is returned, not repaired.
 */
export function normalizePlayEvents(
  rows: Record<string, unknown>[],
  gameId: string
): { events: NormalizedTimelineEvent[]; orderMalformed: boolean } {
  const parsed: NormalizedTimelineEvent[] = [];
  let nullOrders = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const event = normalizePlayEvent(row, gameId);
    if (!event) {
      nullOrders += 1;
      continue;
    }
    parsed.push(event);
  }
  parsed.sort((a, b) => a.order - b.order || 0);
  const seen = new Set<number>();
  let duplicateOrders = false;
  for (const event of parsed) {
    if (seen.has(event.order)) duplicateOrders = true;
    seen.add(event.order);
  }
  let orderGaps = false;
  if (parsed.length > 0) {
    const min = parsed[0]!.order;
    const max = parsed[parsed.length - 1]!.order;
    if (max - min + 1 !== parsed.length || seen.size !== parsed.length) {
      const expected = new Set<number>();
      for (let i = min; i <= max; i += 1) expected.add(i);
      for (const order of seen) expected.delete(order);
      if (expected.size > 0) orderGaps = true;
    }
  }
  return {
    events: parsed,
    orderMalformed: nullOrders > 0 || duplicateOrders || orderGaps,
  };
}

function applyScoreProgression(events: NormalizedTimelineEvent[]): {
  leadChanges: number;
  ties: number;
  largestHomeLead: number;
  largestAwayLead: number;
  largestHomeRun: number;
  largestAwayRun: number;
  playsFinalHome: number | null;
  playsFinalAway: number | null;
  homePointsByPeriod: number[];
  awayPointsByPeriod: number[];
  maxPeriod: number;
  hasEndGame: boolean;
} {
  let prevHome = 0;
  let prevAway = 0;
  let haveScore = false;
  let prevLeader: Leader = 'tie';
  let leadChanges = 0;
  let ties = 0;
  let largestHomeLead = 0;
  let largestAwayLead = 0;
  let currentRunTeam: Leader | null = null;
  let currentRun = 0;
  let largestHomeRun = 0;
  let largestAwayRun = 0;
  let maxPeriod = 0;
  let hasEndGame = false;
  const lastHomeByPeriod: Record<number, number> = {};
  const lastAwayByPeriod: Record<number, number> = {};

  for (const event of events) {
    if (event.period != null && event.period > maxPeriod) maxPeriod = event.period;
    if (normalizeTypeKey(event.rawType) === 'End Game') hasEndGame = true;

    const home = event.scoreHome;
    const away = event.scoreAway;
    if (home == null || away == null) continue;

    const homeDelta = haveScore ? home - prevHome : home;
    const awayDelta = haveScore ? away - prevAway : away;
    const newLeader = leaderOf(home, away);

    if (haveScore) {
      if (prevLeader !== 'tie' && newLeader !== 'tie' && newLeader !== prevLeader) {
        event.leadChange = true;
        leadChanges += 1;
      }
      if (newLeader === 'tie' && prevLeader !== 'tie') {
        event.becameTied = true;
        ties += 1;
      }
    }

    if (home > away) largestHomeLead = Math.max(largestHomeLead, home - away);
    if (away > home) largestAwayLead = Math.max(largestAwayLead, away - home);

    const scoredHome = homeDelta > 0 && awayDelta <= 0;
    const scoredAway = awayDelta > 0 && homeDelta <= 0;
    if (scoredHome || scoredAway) {
      const team: Leader = scoredHome ? 'home' : 'away';
      const points = scoredHome ? homeDelta : awayDelta;
      if (currentRunTeam === team) currentRun += points;
      else {
        currentRunTeam = team;
        currentRun = points;
      }
      if (team === 'home') largestHomeRun = Math.max(largestHomeRun, currentRun);
      else largestAwayRun = Math.max(largestAwayRun, currentRun);
    } else if (homeDelta > 0 && awayDelta > 0) {
      currentRunTeam = null;
      currentRun = 0;
    }

    if (event.period != null) {
      lastHomeByPeriod[event.period] = home;
      lastAwayByPeriod[event.period] = away;
    }

    prevHome = home;
    prevAway = away;
    prevLeader = newLeader;
    haveScore = true;
  }

  const homePointsByPeriod: number[] = [];
  const awayPointsByPeriod: number[] = [];
  let carryHome = 0;
  let carryAway = 0;
  for (let period = 1; period <= Math.max(maxPeriod, 1); period += 1) {
    const endHome = lastHomeByPeriod[period] ?? carryHome;
    const endAway = lastAwayByPeriod[period] ?? carryAway;
    homePointsByPeriod.push(endHome - carryHome);
    awayPointsByPeriod.push(endAway - carryAway);
    carryHome = endHome;
    carryAway = endAway;
  }

  return {
    leadChanges,
    ties,
    largestHomeLead,
    largestAwayLead,
    largestHomeRun,
    largestAwayRun,
    playsFinalHome: haveScore ? prevHome : null,
    playsFinalAway: haveScore ? prevAway : null,
    homePointsByPeriod,
    awayPointsByPeriod,
    maxPeriod,
    hasEndGame,
  };
}

export function buildGameFlowSummary(input: {
  gameId: string;
  season?: string;
  events: NormalizedTimelineEvent[];
  orderMalformed: boolean;
  officialHome: number | null;
  officialAway: number | null;
}): GameFlowSummary {
  const progression = applyScoreProgression(input.events);
  const rotation = rotationContextForGame(input.gameId, {
    inPlays2025Archive: (input.season ?? HISTORICAL_TIMELINE_SEASON) === HISTORICAL_TIMELINE_SEASON,
  });
  const scoreReconciled =
    progression.playsFinalHome != null &&
    progression.playsFinalAway != null &&
    input.officialHome != null &&
    input.officialAway != null &&
    progression.playsFinalHome === input.officialHome &&
    progression.playsFinalAway === input.officialAway;

  const streamClass = classifyStreamCompleteness({
    eventCount: input.events.length,
    maxPeriod: progression.maxPeriod || null,
    hasEndGame: progression.hasEndGame,
    orderMalformed: input.orderMalformed,
    playsFinalHome: progression.playsFinalHome,
    playsFinalAway: progression.playsFinalAway,
    officialHome: input.officialHome,
    officialAway: input.officialAway,
  });

  const qualityCode = timelineQualityCode({
    eventCount: input.events.length,
    orderMalformed: input.orderMalformed,
    streamClass,
    scoreReconciled,
  });

  const timelineAvailable = input.events.length > 0 && streamClass !== 'truncated' && !input.orderMalformed;
  const failClosedLeads = !timelineAvailable;

  return {
    gameId: input.gameId,
    season: input.season ?? HISTORICAL_TIMELINE_SEASON,
    source: HISTORICAL_TIMELINE_SOURCE,
    timelineAvailable,
    scoreReconciled,
    streamComplete: streamClass === 'complete',
    streamClass,
    qualityCode,
    playsFinalHome: progression.playsFinalHome,
    playsFinalAway: progression.playsFinalAway,
    eventCount: input.events.length,
    periodCount: progression.maxPeriod,
    overtimeCount: Math.max(0, progression.maxPeriod - 4),
    leadChanges: failClosedLeads ? null : progression.leadChanges,
    ties: failClosedLeads ? null : progression.ties,
    largestHomeLead: failClosedLeads ? null : progression.largestHomeLead,
    largestAwayLead: failClosedLeads ? null : progression.largestAwayLead,
    largestHomeRun: failClosedLeads ? null : progression.largestHomeRun,
    largestAwayRun: failClosedLeads ? null : progression.largestAwayRun,
    homePointsByPeriod: progression.homePointsByPeriod,
    awayPointsByPeriod: progression.awayPointsByPeriod,
    rotationAvailable: rotation.available,
    rotationFailureClass: rotation.failureClass,
  };
}

export function qualityFromGameFlow(flow: GameFlowSummary): TimelineQuality {
  return {
    timelineAvailable: flow.timelineAvailable,
    scoreReconciled: flow.scoreReconciled,
    streamComplete: flow.streamComplete,
    streamClass: flow.streamClass,
    rotationContextAvailable: flow.rotationAvailable,
    rotationFailureClass: flow.rotationFailureClass,
    qualityCode: flow.qualityCode,
  };
}

export function classifyScoreMismatchStream(streamClass: StreamClass): 'truncated' | 'chronology_usable' | 'uncertain' {
  if (streamClass === 'truncated') return 'truncated';
  if (streamClass === 'uncertain') return 'uncertain';
  return 'chronology_usable';
}
