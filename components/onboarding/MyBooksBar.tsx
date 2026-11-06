'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { welcomeHref } from '@/lib/onboarding/contract';
import { booksWithOdds, bookById, normalizeBookIds } from '@/lib/onboarding/sportsbooks';

const DISMISS_KEY = 'cc_my_books_prompt_dismissed';
const EDIT_HREF = welcomeHref({ mode: 'books', next: '/betting/props-explorer' });

type MyBooksState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'unanswered' }
  | { status: 'answered'; books: string[] };

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* private mode */
  }
}

/** Saved books for the signed-in user. Guests and load errors render nothing. */
export function useMyBooks(): MyBooksState {
  const [state, setState] = useState<MyBooksState>({ status: 'loading' });
  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/user/settings', { credentials: 'include', cache: 'no-store', signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) return setState({ status: 'hidden' });
        const data = (await res.json()) as { settings?: { sportsbooks?: string[] | null } };
        const raw = data.settings?.sportsbooks;
        setState(Array.isArray(raw) ? { status: 'answered', books: normalizeBookIds(raw) } : { status: 'unanswered' });
      })
      .catch(() => {
        if (!ac.signal.aborted) setState({ status: 'hidden' });
      });
    return () => ac.abort();
  }, []);
  return state;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * Props Explorer: ask for books where it pays off, then make "my books" one tap.
 * `sportsbook` is the explorer's comma-separated filter param.
 */
export function MyBooksBar({
  sportsbook,
  onApply,
}: {
  sportsbook: string;
  onApply: (bookIds: string[] | null) => void;
}) {
  const state = useMyBooks();
  // Safe without a mount effect: the bar renders nothing until settings load on the client.
  const [dismissed, setDismissed] = useState(() => typeof window !== 'undefined' && readDismissed());

  if (state.status === 'loading' || state.status === 'hidden') return null;

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  if (state.status === 'unanswered') {
    if (dismissed) return null;
    return (
      <div className="mb-3 flex items-start gap-3 rounded-xl border border-[#55ddb1] bg-[#55ddb1]/10 px-3 py-3 sm:items-center sm:px-4">
        <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
          <p className="text-sm text-[#063f46]">
            <span className="font-medium">Pick your books</span> to see the best price you can actually get.
          </p>
          <Link
            href={EDIT_HREF}
            className="mt-2 inline-flex min-h-[36px] items-center rounded-lg bg-[#063f46] px-3 text-sm font-semibold text-white hover:bg-[#075B5C] sm:mt-0"
          >
            Choose books
          </Link>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="-m-1 rounded-md p-1 text-[#4a6366] hover:bg-white/60 hover:text-[#063f46]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const mine = booksWithOdds(state.books);
  const current = sportsbook.split(',').filter(Boolean);

  if (mine.length === 0) {
    if (state.books.length === 0 || dismissed) return null;
    return (
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-[#DCE9EA] bg-white px-3 py-2.5 text-sm text-[#4a6366]">
        <p className="min-w-0 flex-1">
          Props Explorer doesn&apos;t show Kalshi or Polymarket prices yet. Prices below come from sportsbooks.{' '}
          <Link href={EDIT_HREF} className="text-[#075B5C] hover:underline">
            Edit books
          </Link>
        </p>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="-m-1 rounded-md p-1 hover:text-[#063f46]">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const active = sameSet(current, mine);
  const names = mine.map((id) => bookById(id)?.label ?? id).join(', ');

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[#DCE9EA] bg-white px-3 py-2.5 text-sm">
      <p className="min-w-0 flex-1 text-[#4a6366]">
        {active ? 'Showing your books: ' : 'Your books: '}
        <span className="text-[#063f46]">{names}</span>
      </p>
      <button
        type="button"
        onClick={() => onApply(active ? null : mine)}
        className="inline-flex min-h-[36px] items-center rounded-lg border border-[#075B5C] px-3 font-medium text-[#075B5C] hover:bg-[#55ddb1]/10"
      >
        {active ? 'Show all books' : 'Only my books'}
      </button>
      <Link href={EDIT_HREF} className="text-[#075B5C] hover:underline">
        Edit
      </Link>
    </div>
  );
}
