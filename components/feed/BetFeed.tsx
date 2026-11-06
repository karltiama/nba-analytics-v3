'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatSharedOdds, sharedLegHeadline } from '@/lib/bet-slip/shared-slip-present';
import type { CanonicalBetLeg } from '@/lib/bet-slip/types';
import { formatFeedRecord, type FeedLegGrade, type FeedPostResult } from '@/lib/feed/feed-rules';

type FeedRecord = { n: number; wins: number; losses: number; pushes: number; profitStaked: number; roi: number | null };

type FeedPost = {
  id: string;
  isMine: boolean;
  authorName: string;
  authorRecord: FeedRecord;
  postedAt: string;
  note: string | null;
  legs: CanonicalBetLeg[];
  combinedOddsAmerican: number | null;
  status: 'open' | 'settled';
  result: FeedPostResult | null;
  profitUnits: number | null;
  legResults: FeedLegGrade[] | null;
  hidden: boolean;
};

type FeedResponse = {
  date: string;
  posts: FeedPost[];
  viewer: { record: FeedRecord; postsLeftToday: number; dailyCap: number };
};

const RESULT_CHIP: { [K in FeedPostResult | 'open']: { label: string; cls: string } } = {
  open: { label: 'Open', cls: 'border-[#DCE9EA] bg-[#f4f7f8] text-[#063f46]' },
  win: { label: 'Won', cls: 'border-[#bfe8d2] bg-[#e7f8ef] text-[#0f6b45]' },
  loss: { label: 'Lost', cls: 'border-[#f6d5d5] bg-[#fff7f7] text-[#9a3412]' },
  push: { label: 'Push', cls: 'border-[#DCE9EA] bg-[#f4f6f6] text-[#4a6366]' },
};

const LEG_GRADE_LABEL: { [K in FeedLegGrade]: string } = { win: 'Hit', loss: 'Miss', push: 'Push', void: 'Void' };
const LEG_GRADE_CLS: { [K in FeedLegGrade]: string } = {
  win: 'text-[#0f6b45]',
  loss: 'text-[#9a3412]',
  push: 'text-[#4a6366]',
  void: 'text-[#4a6366]',
};

function formatUnits(u: number): string {
  const r = Math.round(u * 100) / 100;
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}u`;
}

function formatRoi(roi: number | null): string | null {
  if (roi == null) return null;
  const pct = Math.round(roi * 1000) / 10;
  return `${pct > 0 ? '+' : ''}${pct}% ROI`;
}

function recordLine(r: FeedRecord): string {
  if (r.n === 0) return 'No settled posts yet';
  const parts = [formatFeedRecord(r), formatUnits(r.profitStaked)];
  const roi = formatRoi(r.roi);
  if (roi) parts.push(roi);
  parts.push(`${r.n} settled`);
  return parts.join(' · ');
}

function postedTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

function FeedCard({ post, onAction }: { post: FeedPost; onAction: (id: string, action: 'hide' | 'report') => void }) {
  const chip = RESULT_CHIP[post.status === 'settled' && post.result ? post.result : 'open'];
  const isParlay = post.legs.length > 1;
  return (
    <article
      className="rounded-2xl border border-[#DCE9EA] bg-white p-4 shadow-sm"
      data-feed-post={post.id}
      aria-label={`${post.authorName}'s ${isParlay ? 'parlay' : 'bet'}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="type-card-data truncate text-[#063f46]">
            {post.authorName}
            {post.isMine ? <span className="type-metadata ml-2">You</span> : null}
          </p>
          <p className="type-metadata">
            {recordLine(post.authorRecord)} · posted {postedTime(post.postedAt)} ET
          </p>
        </div>
        <span className={`type-badge shrink-0 rounded-full border px-2 py-0.5 ${chip.cls}`}>
          {chip.label}
          {post.status === 'settled' && post.profitUnits != null && post.result !== 'push'
            ? ` ${formatUnits(post.profitUnits)}`
            : null}
        </span>
      </header>

      {post.note ? <p className="type-body mt-2 whitespace-pre-line break-words text-[#063f46]">{post.note}</p> : null}

      <ul className="mt-3 divide-y divide-[#eef3f3] rounded-xl border border-[#eef3f3]">
        {post.legs.map((leg, i) => {
          const grade = post.legResults?.[i] ?? null;
          return (
            <li key={leg.selectionKey} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="type-card-data truncate text-[#063f46]">{leg.playerName || `Player ${leg.playerId}`}</p>
                <p className="type-secondary truncate">
                  {sharedLegHeadline(leg)}
                  {leg.gameLabel ? ` · ${leg.gameLabel}` : null}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="type-card-data text-[#063f46]">{formatSharedOdds(leg.selectedOdds)}</p>
                {grade ? <p className={`type-badge ${LEG_GRADE_CLS[grade]}`}>{LEG_GRADE_LABEL[grade]}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="mt-3 flex items-center justify-between gap-3">
        <span className="type-metadata">
          {isParlay ? `${post.legs.length}-leg parlay` : 'Single'}
          {isParlay && post.combinedOddsAmerican != null ? ` · ${formatSharedOdds(post.combinedOddsAmerican)}` : null}
          {post.hidden ? ' · Hidden from others' : null}
        </span>
        {post.isMine ? (
          post.hidden ? null : (
            <button
              type="button"
              className="type-interactive min-h-[32px] rounded-lg px-2 text-[#4a6366] hover:bg-[#f7f9f7]"
              onClick={() => onAction(post.id, 'hide')}
            >
              Hide
            </button>
          )
        ) : (
          <button
            type="button"
            className="type-interactive min-h-[32px] rounded-lg px-2 text-[#4a6366] hover:bg-[#f7f9f7]"
            onClick={() => onAction(post.id, 'report')}
          >
            Report
          </button>
        )}
      </footer>
    </article>
  );
}

/**
 * Dashboard bet feed for the selected ET date. Self-reported posts; one record unit per post.
 */
export function BetFeed({ date }: { date: string }) {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unavailable'>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/betting/feed?date=${encodeURIComponent(date)}`, {
          credentials: 'same-origin',
          signal,
        });
        if (res.status === 503) {
          setState('unavailable');
          return;
        }
        if (!res.ok) throw new Error('feed');
        setData((await res.json()) as FeedResponse);
        setState('ready');
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState('error');
      }
    },
    [date]
  );

  useEffect(() => {
    const ac = new AbortController();
    setState('loading');
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const onAction = useCallback(
    async (id: string, action: 'hide' | 'report') => {
      if (action === 'hide' && !window.confirm('Hide this post from the feed? It still counts toward your record.')) return;
      if (action === 'report' && !window.confirm('Report this post?')) return;
      const res = await fetch(`/api/betting/feed/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action }),
      });
      setNotice(res.ok ? (action === 'hide' ? 'Post hidden.' : 'Thanks. Post reported.') : 'That did not go through.');
      if (res.ok) void load();
    },
    [load]
  );

  if (state === 'unavailable') return null;

  const viewer = data?.viewer;
  const posts = data?.posts ?? [];

  return (
    <section aria-labelledby="bet-feed-heading" data-bet-feed>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="bet-feed-heading" className="type-section-heading text-[#063f46]">
            Bet Feed
          </h2>
          {viewer ? (
            <p className="type-secondary mt-1">
              Your record: {recordLine(viewer.record)} · {viewer.postsLeftToday} of {viewer.dailyCap} posts left today
            </p>
          ) : null}
        </div>
        <Link
          href="/parlay-workspace"
          className="type-interactive inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#075B5C] px-4 text-[#075B5C] hover:bg-[#55ddb1]/20"
        >
          Post from Workspace
        </Link>
      </div>

      {notice ? (
        <p className="type-secondary mb-3" role="status">
          {notice}
        </p>
      ) : null}

      {state === 'loading' ? (
        <p className="type-secondary" role="status">
          Loading feed…
        </p>
      ) : state === 'error' ? (
        <div className="rounded-2xl border border-[#DCE9EA] bg-white p-6 text-center shadow-sm">
          <p className="type-body text-[#063f46]">The feed could not load.</p>
          <button
            type="button"
            className="type-interactive mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#075B5C] px-4 text-[#075B5C] hover:bg-[#55ddb1]/20"
            onClick={() => {
              setState('loading');
              void load();
            }}
          >
            Try again
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-[#DCE9EA] bg-white p-6 text-center shadow-sm">
          <p className="type-body text-[#063f46]">No posts for this day yet.</p>
          <p className="type-secondary mt-1">Build a bet in Parlay Workspace and post it before tip-off.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <FeedCard key={post.id} post={post} onAction={(id, a) => void onAction(id, a)} />
          ))}
        </div>
      )}

      <p className="type-metadata mt-3">
        Self-reported bets. Records count settled posts only, one result per post. Past results do not predict future
        ones. If gambling stops being fun, call 1-800-GAMBLER.
      </p>
    </section>
  );
}
