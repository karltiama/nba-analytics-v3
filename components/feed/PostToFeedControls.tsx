'use client';

import Link from 'next/link';
import { useCallback, useId, useRef, useState } from 'react';
import { canonicalBetLegFromSelectedParlayLeg } from '@/lib/bet-slip/adapt-parlay-leg';
import type { SelectedParlayLeg } from '@/lib/parlay/selection';
import { FEED_NOTE_MAX } from '@/lib/feed/feed-rules';

type Phase = 'idle' | 'loading' | 'ready' | 'posting' | 'posted' | 'error';

/**
 * "Post to feed" from Parlay Workspace. Self-reported: legs, lines and odds freeze at post time.
 * 3 posts per ET day, locked at tip-off, counted as one result in the record.
 */
export function PostToFeedControls({ legs, className }: { legs: SelectedParlayLeg[]; className?: string }) {
  const titleId = useId();
  const noteId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState('');
  const [left, setLeft] = useState<number | null>(null);
  const [cap, setCap] = useState(3);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    dialogRef.current?.close();
    setPhase('idle');
    setError(null);
  }, []);

  const open = useCallback(async () => {
    if (legs.length === 0) return;
    setPhase('loading');
    setError(null);
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    try {
      const res = await fetch('/api/betting/feed?limit=1', { credentials: 'same-origin' });
      if (res.status === 401) {
        const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
        window.location.assign(`/login?next=${next}`);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        viewer?: { postsLeftToday: number; dailyCap: number };
        error?: string;
      };
      if (!res.ok || !body.viewer) throw new Error(body.error || 'Could not load your posts for today.');
      setLeft(body.viewer.postsLeftToday);
      setCap(body.viewer.dailyCap);
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your posts for today.');
      setPhase('error');
    }
  }, [legs.length]);

  const submit = useCallback(async () => {
    setPhase('posting');
    setError(null);
    try {
      const res = await fetch('/api/betting/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          legs: legs.map((leg) => canonicalBetLegFromSelectedParlayLeg(leg)),
          note: note.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        postsLeftToday?: number;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        if (res.status === 429) setLeft(0);
        throw new Error(body.message || body.error || 'Could not post.');
      }
      setLeft(body.postsLeftToday ?? null);
      setNote('');
      setPhase('posted');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post.');
      setPhase('error');
    }
  }, [legs, note]);

  const isParlay = legs.length > 1;

  return (
    <>
      <button
        type="button"
        className={
          className ??
          'type-interactive inline-flex min-h-9 items-center justify-center rounded-lg border border-[#075B5C] px-3 text-[#075B5C] hover:bg-[#55ddb1]/20 disabled:opacity-40'
        }
        onClick={() => void open()}
        disabled={legs.length === 0}
        aria-haspopup="dialog"
      >
        Post to feed
      </button>

      <dialog
        ref={dialogRef}
        className="fixed top-1/2 left-1/2 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#DCE9EA] bg-white p-0 text-[#063f46] shadow-lg backdrop:bg-[#063f46]/40"
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="space-y-3 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="type-section-heading">
              Post {isParlay ? `this ${legs.length}-leg parlay` : 'this bet'} to the feed
            </h2>
            <button
              type="button"
              className="type-interactive min-h-[32px] rounded-lg border border-[#DCE9EA] bg-white px-2 py-1 hover:bg-[#f7f9f7]"
              onClick={close}
            >
              Close
            </button>
          </div>

          {phase === 'loading' ? (
            <p className="type-secondary" role="status">
              Checking today&apos;s posts…
            </p>
          ) : null}

          {phase === 'posted' ? (
            <div className="space-y-3" role="status">
              <p className="type-body">Posted. It settles automatically once every game is final.</p>
              {left != null ? (
                <p className="type-secondary">
                  {left} of {cap} posts left today.
                </p>
              ) : null}
              <Link
                href="/dashboard"
                className="type-interactive inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-3 text-white hover:opacity-90"
              >
                See the feed
              </Link>
            </div>
          ) : null}

          {phase === 'ready' || phase === 'posting' || (phase === 'error' && left != null && left > 0) ? (
            <div className="space-y-3">
              <ul className="type-secondary space-y-1">
                <li>Lines and odds freeze now. You can hide a post later, but it still counts.</li>
                <li>{isParlay ? 'The parlay counts as one result in your record.' : 'Counts as one result in your record.'}</li>
                <li>Posting closes at tip-off of the first game.</li>
              </ul>
              <label htmlFor={noteId} className="type-interactive block">
                Note (optional)
              </label>
              <textarea
                id={noteId}
                value={note}
                maxLength={FEED_NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="type-body w-full rounded-lg border border-[#DCE9EA] px-3 py-2 focus:border-[#075B5C] focus:outline-none"
                placeholder="Why you like it"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="type-metadata">
                  {left != null ? `${left} of ${cap} posts left today` : null}
                </span>
                <button
                  type="button"
                  className="type-interactive inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-4 text-white hover:opacity-90 disabled:opacity-40"
                  onClick={() => void submit()}
                  disabled={phase === 'posting' || left === 0}
                  aria-busy={phase === 'posting'}
                >
                  {phase === 'posting' ? 'Posting…' : 'Post'}
                </button>
              </div>
            </div>
          ) : null}

          {phase === 'ready' && left === 0 ? (
            <p className="type-secondary" role="status">
              You&apos;ve used all {cap} posts for today. Posts reset at midnight ET.
            </p>
          ) : null}

          {phase === 'error' && error ? (
            <p className="type-secondary text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
