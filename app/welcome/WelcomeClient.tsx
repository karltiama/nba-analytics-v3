'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { safeInternalPath } from '@/lib/auth/safe-next';
import {
  destinationForIntent,
  parseWelcomeStep,
  PRIMARY_INTENTS,
  SKIP_DESTINATION,
  WELCOME_PATH,
  welcomeStepsFor,
  type PrimaryIntent,
  type WelcomeMode,
  type WelcomeStep,
} from '@/lib/onboarding/contract';
import { INTENT_COPY } from '@/lib/onboarding/copy';
import { isBettingCountry, isValidSubdivision } from '@/lib/onboarding/regions';
import { booksWithOdds, normalizeBookIds } from '@/lib/onboarding/sportsbooks';
import { markOnboardingComplete } from '@/lib/onboarding/storage';
import { trackEvent } from '@/lib/product-analytics/track-event';
import { RegionFields, type RegionValue } from '@/components/onboarding/RegionFields';
import { BookPicker } from '@/components/onboarding/BookPicker';

const STEP_COPY: Record<WelcomeStep, { title: string; body: string }> = {
  region: {
    title: 'Where do you usually bet?',
    body: 'We put the books available near you first. Nothing is hidden, and you can change this anytime in your profile.',
  },
  books: {
    title: 'Which books do you have accounts with?',
    body: 'These are the books Court Context has prices for. Pick all you use, and Props Explorer can show the best price among them.',
  },
  goal: {
    title: 'What do you want to do first?',
    body: 'This only picks where we send you next.',
  },
};

type SettingsResponse = {
  settings?: {
    bettingCountry?: string | null;
    bettingRegion?: string | null;
    sportsbooks?: string[] | null;
  };
};

export function WelcomeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode: WelcomeMode = searchParams.get('mode') === 'books' ? 'books' : 'full';
  const steps = welcomeStepsFor(mode);
  const step = parseWelcomeStep(searchParams.get('step'), mode);
  const stepIndex = steps.indexOf(step);
  const rawNext = searchParams.get('next');
  const next = rawNext ? safeInternalPath(rawNext, SKIP_DESTINATION) : null;

  const [loaded, setLoaded] = useState(false);
  const [region, setRegion] = useState<RegionValue>({ country: null, region: null });
  const [books, setBooks] = useState<string[]>([]);
  /** Books step answered (even with none); omitted from the save when the user skipped it. */
  const [booksAnswered, setBooksAnswered] = useState(false);
  const [intent, setIntent] = useState<PrimaryIntent | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    trackEvent('onboarding_started', { surface: 'onboarding', welcome_mode: mode });
  }, [mode]);

  // Prefill from saved settings so editing from Props Explorer starts where the user left off.
  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/user/settings', { credentials: 'include', cache: 'no-store', signal: ac.signal })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(`${WELCOME_PATH}?${searchParams.toString()}`)}`);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as SettingsResponse;
        const s = data.settings;
        const country = isBettingCountry(s?.bettingCountry) ? s.bettingCountry : null;
        const savedRegion = isValidSubdivision(country, s?.bettingRegion) ? (s?.bettingRegion ?? null) : null;
        setRegion({ country, region: savedRegion });
        if (Array.isArray(s?.sportsbooks)) {
          setBooks(normalizeBookIds(s.sportsbooks));
          setBooksAnswered(true);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!ac.signal.aborted) setLoaded(true);
      });
    return () => ac.abort();
    // Load once; step changes only rewrite the query string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToStep = useCallback(
    (target: WelcomeStep) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('step', target);
      router.push(`${WELCOME_PATH}?${params.toString()}`, { scroll: true });
    },
    [router, searchParams]
  );

  const regionPayload = useCallback(() => {
    if (!region.country) return {};
    return { bettingCountry: region.country, bettingRegion: region.region };
  }, [region]);

  const analytics = useCallback(
    () => ({
      welcome_mode: mode,
      betting_country: region.country ?? 'none',
      book_count: booksAnswered ? books.length : 0,
      books_with_odds_count: booksAnswered ? booksWithOdds(books).length : 0,
    }),
    [books, booksAnswered, mode, region.country]
  );

  const finish = useCallback(
    async (skipped: boolean) => {
      setSaving(true);
      setError(null);
      try {
        if (mode === 'books') {
          if (!skipped) {
            const res = await fetch('/api/user/settings', {
              method: 'PUT',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...regionPayload(), ...(booksAnswered ? { sportsbooks: books } : {}) }),
            });
            if (!res.ok) throw new Error('save_failed');
            trackEvent('onboarding_completed', { surface: 'onboarding', ...analytics() });
          }
          router.replace(next ?? '/betting/props-explorer');
          return;
        }

        const res = await fetch('/api/user/onboarding', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            skipped
              ? { skipped: true }
              : {
                  skipped: false,
                  primaryIntent: intent,
                  ...regionPayload(),
                  ...(booksAnswered ? { sportsbooks: books } : {}),
                }
          ),
        });
        if (!res.ok) throw new Error('save_failed');
        markOnboardingComplete({ skipped, primaryIntent: skipped ? null : intent, guidanceLevel: null });
        trackEvent(skipped ? 'onboarding_skipped' : 'onboarding_completed', {
          surface: 'onboarding',
          primary_intent: skipped ? 'skipped' : (intent ?? 'none'),
          ...analytics(),
        });
        const dest = !skipped && intent ? destinationForIntent(intent) : (next ?? SKIP_DESTINATION);
        router.replace(dest);
      } catch {
        setError("We couldn't save that. Check your connection and try again.");
        setSaving(false);
      }
    },
    [analytics, books, booksAnswered, intent, mode, next, regionPayload, router]
  );

  const isLast = stepIndex === steps.length - 1;
  const advance = () => {
    if (step === 'books') setBooksAnswered(true);
    if (isLast) void finish(false);
    else goToStep(steps[stepIndex + 1]);
  };
  const skipStep = () => {
    if (step === 'region') setRegion({ country: null, region: null });
    if (step === 'goal') setIntent(null);
    if (isLast) void finish(false);
    else goToStep(steps[stepIndex + 1]);
  };

  const canContinue =
    step === 'region'
      ? region.country !== null && (region.country === 'OTHER' || region.region !== null)
      : step === 'books'
        ? books.length > 0
        : intent !== null;

  const copy = STEP_COPY[step];

  return (
    <div className="min-h-dvh bg-[#f7f9f7] text-[#063f46] flex flex-col">
      <header className="border-b border-[#DCE9EA] bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="text-sm font-semibold tracking-tight">
            Court <span className="text-[#075B5C]">Context</span>
          </span>
          <button
            type="button"
            onClick={() => void finish(true)}
            disabled={saving}
            className="min-h-[44px] px-2 text-sm text-[#4a6366] hover:text-[#063f46] disabled:opacity-50"
          >
            {mode === 'books' ? 'Cancel' : 'Do this later'}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-6 pb-32 sm:px-6 sm:pt-10">
        <div className="flex gap-1.5" aria-hidden>
          {steps.map((id, i) => (
            <div
              key={id}
              className={cn('h-1 flex-1 rounded-full', i <= stepIndex ? 'bg-[#075B5C]' : 'bg-[#DCE9EA]')}
            />
          ))}
        </div>
        <p className="mt-4 text-xs font-medium text-[#4a6366]">
          Step {stepIndex + 1} of {steps.length}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-2 text-sm text-[#4a6366]">{copy.body}</p>

        <div className="mt-6">
          {!loaded ? (
            <div className="flex items-center gap-2 py-10 text-sm text-[#4a6366]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your settings…
            </div>
          ) : step === 'region' ? (
            <RegionFields value={region} onChange={setRegion} />
          ) : step === 'books' ? (
            <BookPicker country={region.country} region={region.region} selected={books} onChange={setBooks} />
          ) : (
            <div className="grid gap-2" role="radiogroup" aria-label="What do you want to do first?">
              {PRIMARY_INTENTS.map((key) => {
                const c = INTENT_COPY[key];
                const selected = intent === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setIntent(key)}
                    className={cn(
                      'min-h-[44px] rounded-xl border px-3 py-3 text-left transition-colors',
                      selected
                        ? 'border-[#075B5C] bg-[#55ddb1]/20'
                        : 'border-[#DCE9EA] bg-white hover:bg-[#f7f9f7]'
                    )}
                  >
                    <span className="block text-sm font-medium">{c.title}</span>
                    <span className="mt-0.5 block text-xs text-[#4a6366]">{c.desc}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error ? (
          <p className="mt-4 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-[#DCE9EA] bg-white/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={() => goToStep(steps[stepIndex - 1])}
                disabled={saving}
                className="min-h-[44px] px-2 text-sm text-[#4a6366] hover:text-[#063f46]"
              >
                Back
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={skipStep}
              disabled={saving || !loaded}
              className="min-h-[44px] px-3 text-sm text-[#4a6366] hover:text-[#063f46] disabled:opacity-50"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={advance}
              disabled={saving || !loaded || !canContinue}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#063f46] px-5 text-sm font-semibold text-white hover:bg-[#075B5C] disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {isLast ? (mode === 'books' ? 'Save' : 'Finish') : 'Continue'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
