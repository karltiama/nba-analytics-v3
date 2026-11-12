'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatEtTimestamp } from '@/lib/quick-builds/preview';
import { marketDisplayLabel, type SelectedParlayLeg } from '@/lib/parlay/selection';
import {
  formatSampleAverage,
  HISTORICAL_PLAYER_FORM_BASIS,
  HISTORICAL_PLAYER_FORM_COPY,
  HISTORICAL_PLAYER_FORM_TITLE,
  researchSnapshotFormKey,
  researchSnapshotFormRequestFromSelection,
  researchSnapshotFormResponseMatches,
  type ResearchSnapshotFormLegResult,
} from '@/lib/parlay/research-snapshot-form';

type FormBody = {
  basis?: string;
  legs?: ResearchSnapshotFormLegResult[];
};

type FormState = {
  key: string;
  status: 'loading' | 'ready' | 'error';
  message: string | null;
  legs: ResearchSnapshotFormLegResult[] | null;
};

export function ResearchSnapshotFormPanel({ legs }: { legs: SelectedParlayLeg[] }) {
  const request = useMemo(() => researchSnapshotFormRequestFromSelection(legs), [legs]);
  const key = request ? researchSnapshotFormKey(request) : '';
  const [state, setState] = useState<FormState>({ key: '', status: 'loading', message: null, legs: null });

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    let active = true;
    const requestedKey = researchSnapshotFormKey(request);
    fetch('/api/parlay-workspace/research-snapshot-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      body: JSON.stringify({ legs: request }),
    })
      .then(async (response) => {
        if (response.status === 401) throw new Error('Sign in to load historical player form.');
        if (!response.ok) throw new Error('Historical player form could not be loaded.');
        const body = (await response.json()) as FormBody;
        if (!active) return;
        if (!researchSnapshotFormResponseMatches(request, body.legs)) {
          setState({
            key: requestedKey,
            status: 'error',
            message: 'Historical player form could not be loaded.',
            legs: null,
          });
          return;
        }
        setState({ key: requestedKey, status: 'ready', message: null, legs: body.legs ?? null });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name === 'AbortError' || !active) return;
        const message = error instanceof Error ? error.message : 'Historical player form could not be loaded.';
        setState({ key: requestedKey, status: 'error', message, legs: null });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [key, request]);

  if (!request) {
    return (
      <section className="rounded-2xl border border-[#DCE9EA] bg-white p-4 shadow-sm" aria-label={HISTORICAL_PLAYER_FORM_TITLE}>
        <FormHeading />
        <p className="type-secondary mt-2" role="status">
          Historical player form supports up to four Research Snapshot legs.
        </p>
      </section>
    );
  }

  const current = state.key === key ? state : { key, status: 'loading' as const, message: null, legs: null };
  return (
    <section className="rounded-2xl border border-[#DCE9EA] bg-white p-4 shadow-sm" aria-label={HISTORICAL_PLAYER_FORM_TITLE}>
      <FormHeading />
      {current.status === 'loading' ? (
        <p className="type-secondary mt-3" role="status">
          Loading historical player form…
        </p>
      ) : null}
      {current.status === 'error' ? (
        <p className="type-body mt-3 text-[#9a3412]" role="status">
          {current.message}
        </p>
      ) : null}
      {current.status === 'ready' && current.legs ? (
        <ul className="mt-3 space-y-2">
          {current.legs.map((result, index) => (
            <FormLeg
              key={`${result.playerId}-${result.gameId}-${result.market}-${result.line}`}
              result={result}
              playerName={legs[index]?.offer.playerDisplayName ?? result.playerId}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function FormHeading() {
  return (
    <>
      <h2 className="type-section-heading text-[#063f46]">{HISTORICAL_PLAYER_FORM_TITLE}</h2>
      <p className="type-secondary mt-1">{HISTORICAL_PLAYER_FORM_COPY}</p>
      <p className="type-metadata mt-1">{HISTORICAL_PLAYER_FORM_BASIS}</p>
    </>
  );
}

function FormLeg({ result, playerName }: { result: ResearchSnapshotFormLegResult; playerName: string }) {
  const side = result.side === 'over' ? 'Over' : 'Under';
  const cutoff = result.cutoffAt ? formatEtTimestamp(result.cutoffAt) : null;
  return (
    <li className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] p-3">
      <p className="type-body text-[#063f46]">
        {playerName} {side} {result.line} {marketDisplayLabel(result.market)}
      </p>
      <p className="type-metadata mt-1">Observed cutoff {cutoff ?? 'unavailable'}</p>
      {result.scheduledGame ? (
        <p className="type-metadata mt-1">
          Scheduled game {result.scheduledGame.awayAbbr} @ {result.scheduledGame.homeAbbr}
        </p>
      ) : null}
      {result.teamAssignment.status === 'resolved' ? (
        <p className="type-metadata mt-1">
          Prior-game team {result.teamAssignment.playerTeamAbbr} vs {result.teamAssignment.opponentAbbr}. From the most recent final box score stored before the observation.
        </p>
      ) : (
        <p className="type-metadata mt-1">Player team was not established from a prior game.</p>
      )}
      {result.status === 'unavailable' ? (
        <p className="type-body mt-2 text-[#9a3412]" role="status">
          {result.reason ?? 'Historical player form is unavailable for this leg.'}
        </p>
      ) : (
        <div className="mt-2 space-y-1">
          {result.reason ? <p className="type-metadata">{result.reason}</p> : null}
          <WindowLine label="Season" stat={result.season} />
          <WindowLine label="Last 5" stat={result.last5} />
          <WindowLine label="Last 10" stat={result.last10} />
          {result.lineRelative ? (
            <p className="type-secondary">
              Above {result.line}: {result.lineRelative.above}. Below {result.line}: {result.lineRelative.below}. Push: {result.lineRelative.equal}. Sample: {result.lineRelative.sampleCount} {result.lineRelative.sampleCount === 1 ? 'game' : 'games'}.
            </p>
          ) : null}
          {result.minutes ? (
            <p className="type-secondary">
              Minutes: prior {result.minutes.priorGame ?? 'unavailable'}
              {result.minutes.last5.average != null ? `, last 5 ${formatSampleAverage(result.minutes.last5.average, result.minutes.last5.gameCount)}` : ''}
              {result.minutes.season.average != null ? `, season ${formatSampleAverage(result.minutes.season.average, result.minutes.season.gameCount)}` : ''}.
            </p>
          ) : null}
        </div>
      )}
    </li>
  );
}

function WindowLine({
  label,
  stat,
}: {
  label: string;
  stat: { gameCount: number; average: number | null } | null;
}) {
  const text = stat ? formatSampleAverage(stat.average, stat.gameCount) : null;
  return (
    <p className="type-secondary">
      {label}: {text ?? 'unavailable'}
    </p>
  );
}
