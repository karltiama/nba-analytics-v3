'use client';

/**
 * DEV / flag-gated Level-3 prototype. Does not replace Phase 3 homepage handoff.
 * Multi-leg slips show per-leg actions only — never claims full betslip preload.
 */

import { useCallback, useState } from 'react';
import type { CanonicalBetLeg } from '@/lib/bet-slip/types';
import {
  HANDOFF_PROVIDER_DISPLAY,
  openSportsbookLabel,
  resolveSportsbookHandoff,
  type SportsbookHandoffProvider,
} from '@/lib/sportsbook-handoff';
import {
  isOddsApiHandoffSpikeEnabled,
  type GameMatchContext,
  type SportsbookSelectionResolution,
} from '@/lib/sportsbook-selection-deeplink';
import { marketDisplayLabel } from '@/lib/parlay/selection';

export type Level3SpikeResolveFn = (input: {
  leg: CanonicalBetLeg;
  sportsbook: SportsbookHandoffProvider;
  game?: GameMatchContext | null;
}) => Promise<SportsbookSelectionResolution>;

function legLabel(leg: CanonicalBetLeg): string {
  const side = leg.side === 'over' ? 'O' : 'U';
  return `${leg.playerName} ${side}${leg.line} ${marketDisplayLabel(leg.market)}`;
}

function openPickLabel(provider: SportsbookHandoffProvider): string {
  return `Open this pick on ${HANDOFF_PROVIDER_DISPLAY[provider]}`;
}

/**
 * Prototype panel. Parent must pass a resolve function (API route or fixture adapter).
 * When spike flag is off, renders nothing.
 */
export function SendToSportsbookLevel3Spike({
  legs,
  sportsbook,
  game,
  resolveSelection,
  className,
}: {
  legs: CanonicalBetLeg[];
  sportsbook: SportsbookHandoffProvider;
  game?: GameMatchContext | null;
  resolveSelection: Level3SpikeResolveFn;
  className?: string;
}) {
  const enabled = isOddsApiHandoffSpikeEnabled();
  const [byKey, setByKey] = useState<Record<string, SportsbookSelectionResolution | 'loading' | 'error'>>(
    {}
  );

  const homepage = resolveSportsbookHandoff({ sportsbook });

  const resolveOne = useCallback(
    async (leg: CanonicalBetLeg) => {
      const key = `${leg.selectionKey}|${sportsbook}`;
      setByKey((prev) => ({ ...prev, [key]: 'loading' }));
      try {
        const result = await resolveSelection({ leg, sportsbook, game });
        setByKey((prev) => ({ ...prev, [key]: result }));
      } catch {
        setByKey((prev) => ({ ...prev, [key]: 'error' }));
      }
    },
    [game, resolveSelection, sportsbook]
  );

  const openUrl = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  if (!enabled || legs.length === 0) return null;

  return (
    <div
      className={
        className ??
        'mt-4 rounded-xl border border-dashed border-amber-400/80 bg-amber-50/50 px-3 py-3'
      }
    >
      <p className="type-metadata font-medium text-amber-900">
        Level-3 spike (dev) — single selection only. Not a multi-leg betslip handoff.
      </p>
      <p className="type-metadata mt-1 text-[#4a6366]">
        Book: {HANDOFF_PROVIDER_DISPLAY[sportsbook]}. Homepage fallback always available.
      </p>

      <ul className="mt-3 space-y-3">
        {legs.map((leg) => {
          const key = `${leg.selectionKey}|${sportsbook}`;
          const state = byKey[key];
          const exactLink =
            state &&
            typeof state === 'object' &&
            state.status === 'EXACT' &&
            state.deeplink
              ? state.deeplink
              : null;

          return (
            <li key={key} className="rounded-lg border border-[#DCE9EA] bg-white px-3 py-2">
              <p className="type-card-data text-[#063f46]">{legLabel(leg)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="type-interactive min-h-[36px] rounded-lg border border-[#075B5C] px-2 text-[#075B5C]"
                  onClick={() => void resolveOne(leg)}
                >
                  Resolve pick
                </button>
                {exactLink ? (
                  <button
                    type="button"
                    className="type-interactive min-h-[36px] rounded-lg border border-[#075B5C] bg-[#075B5C] px-2 text-white"
                    onClick={() => openUrl(exactLink)}
                  >
                    {openPickLabel(sportsbook)}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="type-interactive min-h-[36px] rounded-lg border border-[#DCE9EA] px-2 text-[#063f46]"
                    onClick={() => openUrl(homepage.url)}
                  >
                    {openSportsbookLabel(sportsbook)}
                  </button>
                )}
              </div>
              {state === 'loading' ? (
                <p className="type-metadata mt-1">Resolving…</p>
              ) : null}
              {state === 'error' ? (
                <p className="type-metadata mt-1 text-red-700">Resolve failed — use homepage.</p>
              ) : null}
              {state && typeof state === 'object' ? (
                <p className="type-metadata mt-1 text-[#4a6366]">
                  {state.status}
                  {state.verifiedLevel != null ? ` · L${state.verifiedLevel}` : ''}
                  {state.notes ? ` · ${state.notes}` : ''}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="type-interactive mt-3 min-h-[40px] w-full rounded-lg border border-[#075B5C] px-3 text-[#075B5C]"
        onClick={() => openUrl(homepage.url)}
      >
        {openSportsbookLabel(sportsbook)} (Phase 3 homepage)
      </button>
    </div>
  );
}
