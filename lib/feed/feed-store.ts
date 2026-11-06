/**
 * Server-only bet feed persistence and settlement (feed.posts).
 * Callers pass the session user id. Responses never include another user's user_id.
 */

import { query, queryOne } from '@/lib/db';
import type { PlayerGameOutcomeStats } from '@/lib/betting/paper-settlement';
import { parseLegsSnapshot } from '@/lib/bet-slip/shared-slip-service';
import type { CanonicalBetLeg } from '@/lib/bet-slip/types';
import {
  FEED_DAILY_POST_CAP,
  feedLegState,
  gradeFeedParlay,
  summarizeFeedRecord,
  type FeedLegGrade,
  type FeedPostResult,
} from './feed-rules';
import type { PaperPortfolioSummary } from '@/lib/betting/paper-portfolio';

/** Posts with this many distinct reports drop out of the feed until reviewed. */
export const FEED_REPORT_HIDE_THRESHOLD = 3;

export type FeedAuthorRecord = Pick<
  PaperPortfolioSummary,
  'n' | 'wins' | 'losses' | 'pushes' | 'profitStaked' | 'roi'
>;

export type FeedPostView = {
  id: string;
  isMine: boolean;
  authorName: string;
  authorRecord: FeedAuthorRecord;
  postedAt: string;
  note: string | null;
  legs: CanonicalBetLeg[];
  combinedOddsAmerican: number | null;
  stakeUnits: number;
  status: 'open' | 'settled';
  result: FeedPostResult | null;
  profitUnits: number | null;
  legResults: FeedLegGrade[] | null;
  hidden: boolean;
};

function num(v: unknown): number | null {
  if (v == null) return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function iso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const FEED_INSERT_SQL = `
INSERT INTO feed.posts (
  user_id, post_date_et, daily_slot, note, legs_snapshot, leg_count,
  combined_odds_american, stake_units, first_tip_at
)
SELECT $1::uuid, $2::date, COALESCE(MAX(daily_slot), 0) + 1, $3, $4::jsonb, $5, $6, 1, $7::timestamptz
FROM feed.posts
WHERE user_id = $1::uuid AND post_date_et = $2::date
HAVING COALESCE(MAX(daily_slot), 0) < $8
ON CONFLICT (user_id, post_date_et, daily_slot) DO NOTHING
RETURNING id, daily_slot, posted_at
`;

export type InsertFeedPostResult =
  | { ok: true; id: string; dailySlot: number; postedAt: string }
  | { ok: false; code: 'DAILY_CAP' };

/**
 * Inserts at the next free daily slot. The unique (user, day, slot) index makes the cap hold under
 * concurrent posts: a lost race returns no row and we retry against the new max.
 */
export async function insertFeedPost(input: {
  userId: string;
  postDateEt: string;
  note: string | null;
  legs: CanonicalBetLeg[];
  combinedOddsAmerican: number | null;
  firstTipAt: Date;
}): Promise<InsertFeedPostResult> {
  for (let attempt = 0; attempt < FEED_DAILY_POST_CAP + 1; attempt++) {
    const row = await queryOne<{ id: string; daily_slot: number; posted_at: string | Date }>(FEED_INSERT_SQL, [
      input.userId,
      input.postDateEt,
      input.note,
      JSON.stringify(input.legs),
      input.legs.length,
      input.combinedOddsAmerican,
      input.firstTipAt.toISOString(),
      FEED_DAILY_POST_CAP,
    ]);
    if (row) {
      return { ok: true, id: row.id, dailySlot: Number(row.daily_slot), postedAt: iso(row.posted_at) };
    }
    const used = await countFeedPostsForDay(input.userId, input.postDateEt);
    if (used >= FEED_DAILY_POST_CAP) return { ok: false, code: 'DAILY_CAP' };
  }
  return { ok: false, code: 'DAILY_CAP' };
}

export async function countFeedPostsForDay(userId: string, postDateEt: string): Promise<number> {
  const row = await queryOne<{ n: string | number }>(
    `SELECT count(*) AS n FROM feed.posts WHERE user_id = $1::uuid AND post_date_et = $2::date`,
    [userId, postDateEt]
  );
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const FEED_LIST_SQL = `
WITH day_posts AS (
  SELECT p.*
  FROM feed.posts p
  WHERE p.post_date_et = $1::date
    AND (p.hidden = false OR p.user_id = $2::uuid)
    AND (
      p.user_id = $2::uuid
      OR (SELECT count(*) FROM feed.post_reports r WHERE r.post_id = p.id) < $4
    )
),
rec AS (
  SELECT s.user_id,
         count(*) AS n,
         count(*) FILTER (WHERE s.result = 'win') AS wins,
         count(*) FILTER (WHERE s.result = 'loss') AS losses,
         count(*) FILTER (WHERE s.result = 'push') AS pushes,
         COALESCE(sum(s.profit_units), 0) AS profit,
         COALESCE(sum(s.stake_units), 0) AS stake
  FROM feed.posts s
  WHERE s.status = 'settled'
    AND s.user_id IN (SELECT user_id FROM day_posts)
  GROUP BY s.user_id
)
SELECT
  d.id,
  (d.user_id = $2::uuid) AS is_mine,
  COALESCE(NULLIF(trim(pr.display_name), ''), NULLIF(trim(pr.username), ''), 'Anonymous') AS author_name,
  d.posted_at,
  d.note,
  d.legs_snapshot,
  d.combined_odds_american,
  d.stake_units,
  d.status,
  d.result,
  d.profit_units,
  d.leg_results,
  d.hidden,
  COALESCE(rec.n, 0) AS rec_n,
  COALESCE(rec.wins, 0) AS rec_wins,
  COALESCE(rec.losses, 0) AS rec_losses,
  COALESCE(rec.pushes, 0) AS rec_pushes,
  COALESCE(rec.profit, 0) AS rec_profit,
  COALESCE(rec.stake, 0) AS rec_stake
FROM day_posts d
LEFT JOIN public.profiles pr ON pr.id = d.user_id
LEFT JOIN rec ON rec.user_id = d.user_id
ORDER BY d.posted_at DESC
LIMIT $3
`;

type FeedListRow = {
  id: string;
  is_mine: boolean;
  author_name: string;
  posted_at: string | Date;
  note: string | null;
  legs_snapshot: unknown;
  combined_odds_american: number | null;
  stake_units: string | number;
  status: string;
  result: string | null;
  profit_units: string | number | null;
  leg_results: unknown;
  hidden: boolean;
  rec_n: string | number;
  rec_wins: string | number;
  rec_losses: string | number;
  rec_pushes: string | number;
  rec_profit: string | number;
  rec_stake: string | number;
};

function parseLegResults(raw: unknown): FeedLegGrade[] | null {
  if (!Array.isArray(raw)) return null;
  const ok = raw.every((g) => g === 'win' || g === 'loss' || g === 'push' || g === 'void');
  return ok ? (raw as FeedLegGrade[]) : null;
}

export function mapFeedRow(r: FeedListRow): FeedPostView | null {
  const legs = parseLegsSnapshot(r.legs_snapshot);
  if (!legs) return null;
  const stake = num(r.rec_stake) ?? 0;
  const profit = num(r.rec_profit) ?? 0;
  const result = r.result === 'win' || r.result === 'loss' || r.result === 'push' ? r.result : null;
  return {
    id: r.id,
    isMine: Boolean(r.is_mine),
    authorName: r.author_name,
    authorRecord: {
      n: Number(r.rec_n),
      wins: Number(r.rec_wins),
      losses: Number(r.rec_losses),
      pushes: Number(r.rec_pushes),
      profitStaked: profit,
      roi: stake > 0 ? profit / stake : null,
    },
    postedAt: iso(r.posted_at),
    note: r.note,
    legs,
    combinedOddsAmerican: r.combined_odds_american == null ? null : Number(r.combined_odds_american),
    stakeUnits: num(r.stake_units) ?? 1,
    status: r.status === 'settled' ? 'settled' : 'open',
    result,
    profitUnits: num(r.profit_units),
    legResults: parseLegResults(r.leg_results),
    hidden: Boolean(r.hidden),
  };
}

export async function listFeedPostsForDay(input: {
  dateEt: string;
  viewerId: string;
  limit: number;
}): Promise<FeedPostView[]> {
  const rows = await query<FeedListRow>(FEED_LIST_SQL, [
    input.dateEt,
    input.viewerId,
    input.limit,
    FEED_REPORT_HIDE_THRESHOLD,
  ]);
  return rows.map(mapFeedRow).filter((p): p is FeedPostView => p != null);
}

/** Viewer's own settled record, hidden posts included. */
export async function getFeedRecordForUser(userId: string): Promise<PaperPortfolioSummary> {
  const rows = await query<{ result: string | null; profit_units: string | number | null; stake_units: string | number }>(
    `SELECT result, profit_units, stake_units FROM feed.posts WHERE user_id = $1::uuid AND status = 'settled'`,
    [userId]
  );
  return summarizeFeedRecord(
    rows.map((r) => ({ result: r.result, profitUnits: num(r.profit_units), stakeUnits: num(r.stake_units) ?? 1 }))
  );
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

/** Owner hide. The post keeps its daily slot and still counts toward the record. */
export async function hideFeedPostForOwner(userId: string, postId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE feed.posts SET hidden = true, hidden_at = COALESCE(hidden_at, now())
     WHERE id = $1::uuid AND user_id = $2::uuid
     RETURNING id`,
    [postId, userId]
  );
  return row != null;
}

/** One report per user per post. Reporting your own post is a no-op. */
export async function reportFeedPost(input: {
  reporterId: string;
  postId: string;
  reason: string | null;
}): Promise<'reported' | 'not_found'> {
  const row = await queryOne<{ post_id: string }>(
    `INSERT INTO feed.post_reports (post_id, reporter_id, reason)
     SELECT p.id, $2::uuid, $3 FROM feed.posts p WHERE p.id = $1::uuid AND p.user_id <> $2::uuid
     ON CONFLICT (post_id, reporter_id) DO UPDATE SET reason = EXCLUDED.reason
     RETURNING post_id`,
    [input.postId, input.reporterId, input.reason]
  );
  return row ? 'reported' : 'not_found';
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

type OpenPostRow = { id: string; legs_snapshot: unknown; stake_units: string | number };
type GameStatusRow = { game_id: string; status: string | null };
type OutcomeRow = {
  game_id: string;
  player_id: string;
  pts: string | number | null;
  reb: string | number | null;
  ast: string | number | null;
  threes: string | number | null;
  pra: string | number | null;
  pa: string | number | null;
  pr: string | number | null;
  ra: string | number | null;
};

export type FeedSettlementResult = {
  examined: number;
  settled: number;
  pending: number;
  errors?: string[];
};

export async function runFeedSettlement(): Promise<FeedSettlementResult> {
  const posts = await query<OpenPostRow>(
    `SELECT id, legs_snapshot, stake_units FROM feed.posts
     WHERE status = 'open' AND first_tip_at <= now()
     ORDER BY first_tip_at
     LIMIT 1000`
  );
  if (posts.length === 0) return { examined: 0, settled: 0, pending: 0 };

  const parsed = posts.map((p) => ({ row: p, legs: parseLegsSnapshot(p.legs_snapshot) }));
  const gameIds = [...new Set(parsed.flatMap((p) => (p.legs ?? []).map((l) => l.gameId)))];

  const [games, outcomes] = await Promise.all([
    query<GameStatusRow>(`SELECT game_id, status FROM analytics.games WHERE game_id = ANY($1::text[])`, [gameIds]),
    query<OutcomeRow>(
      `SELECT game_id, player_id, pts, reb, ast, threes, pra, pa, pr, ra
       FROM research.v_player_game_outcomes WHERE game_id = ANY($1::text[])`,
      [gameIds]
    ),
  ]);

  const statusByGame = new Map(games.map((g) => [String(g.game_id), g.status]));
  const gamesWithBox = new Set(outcomes.map((o) => String(o.game_id)));
  const outcomeByKey = new Map(
    outcomes.map((o) => [
      `${o.game_id}|${o.player_id}`,
      {
        pts: num(o.pts) ?? 0,
        reb: num(o.reb) ?? 0,
        ast: num(o.ast) ?? 0,
        threes: num(o.threes) ?? 0,
        pra: num(o.pra) ?? 0,
        pa: num(o.pa) ?? 0,
        pr: num(o.pr) ?? 0,
        ra: num(o.ra) ?? 0,
      } satisfies PlayerGameOutcomeStats,
    ])
  );

  let settled = 0;
  let pending = 0;
  const errors: string[] = [];

  for (const { row, legs } of parsed) {
    if (!legs) {
      errors.push(`${row.id}: malformed legs_snapshot`);
      continue;
    }
    const grades: FeedLegGrade[] = [];
    let waiting = false;
    for (const leg of legs) {
      const state = feedLegState({
        leg,
        gameStatus: statusByGame.get(leg.gameId),
        gameHasBoxScore: gamesWithBox.has(leg.gameId),
        outcome: outcomeByKey.get(`${leg.gameId}|${leg.playerId}`) ?? null,
      });
      if (state.kind === 'pending') {
        waiting = true;
        break;
      }
      grades.push(state.grade);
    }
    if (waiting) {
      pending++;
      continue;
    }

    const stake = num(row.stake_units) ?? 1;
    const graded = gradeFeedParlay({
      legGrades: grades,
      legOdds: legs.map((l) => l.selectedOdds ?? null),
      stakeUnits: stake,
    });

    try {
      await query(
        `UPDATE feed.posts
         SET status = 'settled', result = $2, profit_units = $3, leg_results = $4::jsonb, settled_at = now()
         WHERE id = $1::uuid AND status = 'open'`,
        [row.id, graded.result, graded.profitUnits, JSON.stringify(grades)]
      );
      settled++;
    } catch (e) {
      errors.push(`${row.id}: ${e instanceof Error ? e.message : 'update failed'}`);
    }
  }

  return { examined: posts.length, settled, pending, ...(errors.length ? { errors } : {}) };
}
