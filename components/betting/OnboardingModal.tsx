'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Dialog } from 'radix-ui';
import { cn } from '@/lib/utils';
import {
  GUIDANCE_LEVELS,
  PRIMARY_INTENTS,
  type GuidanceLevel,
  type PrimaryIntent,
} from '@/lib/onboarding/contract';
import { GUIDANCE_COPY, INTENT_COPY, ONBOARDING_WELCOME } from '@/lib/onboarding/copy';
import { trackEvent } from '@/lib/product-analytics/track-event';

type Step = 'welcome' | 'intent' | 'guidance';

export type OnboardingModalProps = {
  open: boolean;
  onCompleted: (input: {
    skipped: boolean;
    primaryIntent: PrimaryIntent | null;
    guidanceLevel: GuidanceLevel | null;
  }) => void;
  phase?: 'loading' | 'ready';
};

export function OnboardingModal({ open, onCompleted, phase = 'ready' }: OnboardingModalProps) {
  const titleId = useId();
  const [step, setStep] = useState<Step>('welcome');
  const [intent, setIntent] = useState<PrimaryIntent | null>(null);
  const [guidance, setGuidance] = useState<GuidanceLevel | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep('welcome');
      setIntent(null);
      setGuidance(null);
      setSubmitting(false);
      setError(null);
      setStarted(false);
      return;
    }
    if (started) return;
    setStarted(true);
    trackEvent('onboarding_started', { surface: 'onboarding' });
  }, [open, started]);

  const finish = useCallback(
    async (skipped: boolean, nextIntent: PrimaryIntent | null, nextGuidance: GuidanceLevel | null) => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch('/api/user/onboarding', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            skipped
              ? { skipped: true }
              : { skipped: false, primaryIntent: nextIntent, guidanceLevel: nextGuidance }
          ),
        });
        if (res.status !== 401 && !res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(typeof data.error === 'string' ? data.error : 'Something went wrong. Try again.');
          return;
        }
        trackEvent(skipped ? 'onboarding_skipped' : 'onboarding_completed', {
          surface: 'onboarding',
          primary_intent: skipped ? 'skipped' : nextIntent ?? 'none',
          guidance_level: skipped ? 'skipped' : nextGuidance ?? 'none',
        });
        onCompleted({ skipped, primaryIntent: nextIntent, guidanceLevel: nextGuidance });
      } catch {
        setError('Network error. Try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [onCompleted]
  );

  const goNext = useCallback(() => {
    setError(null);
    if (step === 'welcome') {
      setStep('intent');
      return;
    }
    if (step === 'intent') {
      if (!intent) {
        setError('Choose what you are here to do, or skip for now.');
        return;
      }
      setStep('guidance');
    }
  }, [intent, step]);

  const goBack = useCallback(() => {
    setError(null);
    if (step === 'guidance') setStep('intent');
    else if (step === 'intent') setStep('welcome');
  }, [step]);

  const onGuidanceContinue = useCallback(() => {
    if (!guidance) {
      setError('Choose how much guidance you want, or skip for now.');
      return;
    }
    void finish(false, intent, guidance);
  }, [finish, guidance, intent]);

  return (
    <Dialog.Root open={open} modal>
      <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[200] bg-[#063f46]/40 data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none" />
        <Dialog.Content
          aria-labelledby={titleId}
          className={cn(
            'fixed z-[201] flex flex-col overflow-hidden bg-white shadow-xl border border-[#DCE9EA]',
            'inset-x-0 bottom-0 max-h-[min(92dvh,40rem)] rounded-t-2xl',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(100vw-1.5rem,28rem)] sm:max-h-[min(90vh,40rem)]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
            'motion-reduce:animate-none'
          )}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            void finish(true, null, null);
          }}
        >
          <Dialog.Description className="sr-only">
            Short Court Context setup. Choose a starting place and how much guidance to show. You can skip.
          </Dialog.Description>
          <div className="px-5 pt-5 pb-3 border-b border-[#DCE9EA] shrink-0">
            <Dialog.Title id={titleId} className="text-lg font-semibold text-[#063f46] tracking-tight">
              {phase === 'loading'
                ? 'Getting things ready'
                : step === 'welcome'
                  ? ONBOARDING_WELCOME.title
                  : step === 'intent'
                    ? 'What are you here to do?'
                    : 'How do you usually research NBA props?'}
            </Dialog.Title>
            <p className="text-xs text-[#4a6366] mt-1">
              {phase === 'loading'
                ? 'One moment…'
                : step === 'welcome'
                  ? ONBOARDING_WELCOME.body
                  : 'This only changes where we send you first, or how many tips appear. It does not change basketball results.'}
            </p>
            <div className="flex gap-1.5 mt-3" aria-hidden>
              {(['welcome', 'intent', 'guidance'] as const).map((id) => (
                <div
                  key={id}
                  className={cn(
                    'h-1 flex-1 rounded-full',
                    step === id ? 'bg-[#075B5C]' : 'bg-[#DCE9EA]'
                  )}
                />
              ))}
            </div>
          </div>

          <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">
            {phase === 'loading' ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="h-10 w-10 rounded-full border-2 border-[#DCE9EA] border-t-[#075B5C] animate-spin" />
                <p className="text-sm text-[#4a6366]">Syncing your session…</p>
              </div>
            ) : step === 'welcome' ? (
              <ul className="grid gap-2">
                <li className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] px-3 py-3 text-sm text-[#063f46]">
                  {ONBOARDING_WELCOME.research}
                </li>
                <li className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] px-3 py-3 text-sm text-[#063f46]">
                  {ONBOARDING_WELCOME.analyze}
                </li>
              </ul>
            ) : step === 'intent' ? (
              <div className="grid gap-2" role="listbox" aria-label="Primary intent">
                {PRIMARY_INTENTS.map((key) => {
                  const copy = INTENT_COPY[key];
                  const selected = intent === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => setIntent(key)}
                      className={cn(
                        'rounded-xl px-3 py-3 text-left min-h-[44px] border transition-colors',
                        selected
                          ? 'border-[#075B5C] bg-[#55ddb1]/20 text-[#063f46]'
                          : 'border-[#DCE9EA] bg-white text-[#063f46] hover:bg-[#f7f9f7]'
                      )}
                    >
                      <div className="text-sm font-medium">{copy.title}</div>
                      <div className="text-xs text-[#4a6366] mt-0.5">{copy.desc}</div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-2" role="listbox" aria-label="Guidance level">
                {GUIDANCE_LEVELS.map((key) => {
                  const copy = GUIDANCE_COPY[key];
                  const selected = guidance === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => setGuidance(key)}
                      className={cn(
                        'rounded-xl px-3 py-3 text-left min-h-[44px] border transition-colors',
                        selected
                          ? 'border-[#075B5C] bg-[#55ddb1]/20 text-[#063f46]'
                          : 'border-[#DCE9EA] bg-white text-[#063f46] hover:bg-[#f7f9f7]'
                      )}
                    >
                      <div className="text-sm font-medium">{copy.title}</div>
                      <div className="text-xs text-[#4a6366] mt-0.5">{copy.desc}</div>
                    </button>
                  );
                })}
              </div>
            )}
            {error ? (
              <p className="mt-4 text-sm text-red-700" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="px-5 py-4 border-t border-[#DCE9EA] flex items-center justify-between gap-3 shrink-0 bg-[#f7f9f7]">
            {phase === 'loading' ? (
              <span className="text-xs text-[#4a6366] w-full text-center">One moment</span>
            ) : (
              <>
                <button
                  type="button"
                  className="text-sm text-[#4a6366] hover:text-[#063f46] min-h-[44px] px-2"
                  onClick={() => void finish(true, null, null)}
                  disabled={submitting}
                >
                  Skip for now
                </button>
                <div className="flex items-center gap-2">
                  {step !== 'welcome' ? (
                    <button
                      type="button"
                      className="text-sm text-[#4a6366] hover:text-[#063f46] min-h-[44px] px-3"
                      onClick={goBack}
                    >
                      Back
                    </button>
                  ) : null}
                  {step === 'guidance' ? (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={onGuidanceContinue}
                      className="inline-flex items-center justify-center min-h-[44px] rounded-xl bg-[#063f46] px-4 text-sm font-semibold text-white hover:bg-[#075B5C] disabled:opacity-50"
                    >
                      {submitting ? 'Saving…' : 'Continue'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={goNext}
                      className="inline-flex items-center justify-center min-h-[44px] rounded-xl bg-[#063f46] px-4 text-sm font-semibold text-white hover:bg-[#075B5C]"
                    >
                      {step === 'welcome' ? 'Get started' : 'Next'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
