'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { Dialog } from 'radix-ui';
import { ChevronLeft, ChevronRight, LogIn, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SPORTSBOOK_OPTIONS } from '@/lib/onboarding/sportsbooks';

type OddsFormat = 'american' | 'decimal' | 'fractional';
type PaperMode = 'dollars' | 'units' | 'off';
type PrimaryGoal = 'find_edges' | 'track_picks' | 'learn';
type Experience = 'novice' | 'intermediate' | 'advanced';

export type OnboardingModalProps = {
  open: boolean;
  onCompleted: () => void;
  /** loading: waiting on session/profile; signin_required: not authenticated (keep ?onboard=1); ready: form */
  phase?: 'loading' | 'ready' | 'signin_required';
};

const GOAL_COPY: Record<PrimaryGoal, { title: string; desc: string }> = {
  find_edges: { title: 'Find edges', desc: 'Compare lines and model vs market' },
  track_picks: { title: 'Track picks', desc: 'Paper trading and saved props' },
  learn: { title: 'Learn & explore', desc: 'Stats and trends without pressure' },
};

export function OnboardingModal({ open, onCompleted, phase = 'ready' }: OnboardingModalProps) {
  const [step, setStep] = useState(0);
  const [sportsbookInput, setSportsbookInput] = useState('');
  const [oddsFormat, setOddsFormat] = useState<OddsFormat>('american');
  const [paperMode, setPaperMode] = useState<PaperMode>('units');
  const [primaryGoal, setPrimaryGoal] = useState<PrimaryGoal | null>(null);
  const [experience, setExperience] = useState<Experience | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredBooks = useMemo(() => {
    const q = sportsbookInput.trim().toLowerCase();
    if (!q) return SPORTSBOOK_OPTIONS.slice(0, 8);
    return SPORTSBOOK_OPTIONS.filter((b) => b.toLowerCase().includes(q)).slice(0, 12);
  }, [sportsbookInput]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const preferredSportsbook = sportsbookInput.trim() || null;
      const res = await fetch('/api/user/onboarding', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredSportsbook,
          oddsFormat,
          paperDisplayMode: paperMode,
          primaryGoal,
          experienceLevel: experience,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Something went wrong. Try again.');
        return;
      }
      onCompleted();
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [
    sportsbookInput,
    oddsFormat,
    paperMode,
    primaryGoal,
    experience,
    onCompleted,
  ]);

  const goNext = useCallback(() => {
    setError(null);
    setStep(1);
  }, []);

  const goBack = useCallback(() => {
    setError(null);
    setStep(0);
  }, []);

  return (
    <Dialog.Root open={open} modal>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[201] w-[min(100vw-1.5rem,28rem)] max-h-[min(90vh,40rem)] -translate-x-1/2 -translate-y-1/2',
            'glass-card border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col',
            'data-[state=open]:animate-in data-[state=closed]:animate-out'
          )}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <Dialog.Description className="sr-only">
            {phase === 'signin_required'
              ? 'Sign in to complete workspace setup.'
              : 'Choose your sportsbook, odds format, and paper trading preferences. Optional questions help us tune the experience.'}
          </Dialog.Description>
          <div className="px-5 pt-5 pb-3 border-b border-white/5 shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#00d4ff] to-[#bf5af2] flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <Dialog.Title className="text-lg font-semibold text-white tracking-tight">
                {phase === 'signin_required' ? 'Sign in to continue' : 'Set up your workspace'}
              </Dialog.Title>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {phase === 'loading'
                ? 'Getting things ready…'
                : phase === 'signin_required'
                  ? 'We need your account to save preferences and props.'
                  : `Step ${step + 1} of 2 — personalize defaults; you can change these later.`}
            </p>
            <div className="flex gap-1.5 mt-3">
              <div
                className={cn(
                  'h-1 flex-1 rounded-full',
                  phase === 'loading' || phase === 'signin_required'
                    ? 'bg-[#00d4ff]/40'
                    : step === 0
                      ? 'bg-[#00d4ff]'
                      : 'bg-white/20'
                )}
              />
              <div
                className={cn(
                  'h-1 flex-1 rounded-full',
                  phase === 'loading' || phase === 'signin_required'
                    ? 'bg-white/10'
                    : step === 1
                      ? 'bg-[#00d4ff]'
                      : 'bg-white/20'
                )}
              />
            </div>
          </div>

          <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">
            {phase === 'loading' ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="h-10 w-10 rounded-full border-2 border-[#00d4ff]/30 border-t-[#00d4ff] animate-spin" />
                <p className="text-sm text-muted-foreground">Syncing your session…</p>
              </div>
            ) : phase === 'signin_required' ? (
              <div className="flex flex-col items-center gap-4 py-10 text-center px-1">
                <div className="w-14 h-14 rounded-2xl bg-secondary/60 flex items-center justify-center">
                  <LogIn className="w-7 h-7 text-[#00d4ff]" />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your session is not loaded yet, or you are not signed in. Sign in and we will bring you right back
                  to finish setup.
                </p>
                <Link
                  href={`/login?next=${encodeURIComponent('/betting?onboard=1')}`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#00d4ff] to-[#bf5af2] px-5 py-3 text-sm font-semibold text-white w-full max-w-xs hover:opacity-95"
                >
                  Sign in
                </Link>
                <Link
                  href={`/signup?next=${encodeURIComponent('/betting?onboard=1')}`}
                  className="text-xs text-muted-foreground hover:text-white transition-colors"
                >
                  Create an account
                </Link>
              </div>
            ) : step === 0 ? (
              <div className="space-y-5">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Preferred sportsbook
                  </label>
                  <input
                    type="text"
                    value={sportsbookInput}
                    onChange={(e) => setSportsbookInput(e.target.value)}
                    placeholder="Search or type your book"
                    className="mt-1.5 w-full rounded-xl bg-secondary/50 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#00d4ff]/40"
                    autoComplete="off"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {filteredBooks.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setSportsbookInput(name)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-secondary/40 hover:bg-secondary text-muted-foreground hover:text-white transition-colors"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSportsbookInput('')}
                    className="mt-2 text-xs text-[#00d4ff]/90 hover:text-[#00d4ff]"
                  >
                    Prefer not to say
                  </button>
                </div>

                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Odds format
                  </span>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(
                      [
                        ['american', 'American'],
                        ['decimal', 'Decimal'],
                        ['fractional', 'Fractional'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setOddsFormat(id)}
                        className={cn(
                          'rounded-xl py-2.5 text-xs font-medium transition-colors',
                          oddsFormat === id
                            ? 'bg-[#00d4ff]/20 text-[#00d4ff] ring-1 ring-[#00d4ff]/50'
                            : 'bg-secondary/40 text-muted-foreground hover:text-white'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Paper trading display
                  </span>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    {(
                      [
                        ['dollars', 'Dollar amounts'],
                        ['units', 'Units only'],
                        ['off', 'Not using paper trading yet'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setPaperMode(id)}
                        className={cn(
                          'rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                          paperMode === id
                            ? 'bg-[#00d4ff]/20 text-white ring-1 ring-[#00d4ff]/50'
                            : 'bg-secondary/40 text-muted-foreground hover:text-white'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    What brings you here? (optional)
                  </span>
                  <div className="mt-2 grid gap-2">
                    {(Object.keys(GOAL_COPY) as PrimaryGoal[]).map((key) => {
                      const g = GOAL_COPY[key];
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setPrimaryGoal(primaryGoal === key ? null : key)}
                          className={cn(
                            'rounded-xl px-3 py-3 text-left transition-colors',
                            primaryGoal === key
                              ? 'bg-[#00d4ff]/20 ring-1 ring-[#00d4ff]/50'
                              : 'bg-secondary/40 hover:bg-secondary/60'
                          )}
                        >
                          <div className="text-sm font-medium text-white">{g.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{g.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Experience (optional)
                  </span>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(
                      [
                        ['novice', 'New'],
                        ['intermediate', 'Some'],
                        ['advanced', 'Sharp'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setExperience(experience === id ? null : id)}
                        className={cn(
                          'rounded-xl py-2.5 text-xs font-medium transition-colors',
                          experience === id
                            ? 'bg-[#bf5af2]/25 text-white ring-1 ring-[#bf5af2]/50'
                            : 'bg-secondary/40 text-muted-foreground hover:text-white'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {error ? (
              <p className="mt-4 text-sm text-red-400" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="px-5 py-4 border-t border-white/5 flex items-center justify-between gap-3 shrink-0 bg-black/20">
            {phase === 'loading' ? (
              <span className="text-xs text-muted-foreground w-full text-center">One moment</span>
            ) : phase === 'signin_required' ? (
              <span className="text-xs text-muted-foreground w-full text-center">
                Use the same email you use for the books (optional).
              </span>
            ) : step === 0 ? (
              <>
                <span className="text-xs text-muted-foreground" />
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#00d4ff] to-[#bf5af2] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goBack}
                  className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-white"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={submit}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#00d4ff] to-[#bf5af2] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Finish'}
                </button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
