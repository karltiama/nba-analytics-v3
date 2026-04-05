'use client';

import type { EditableSlip } from './ReviewEditor';

type LegAnalysis = {
  index: number;
  playerNameInput: string;
  propType: string;
  side: string;
  line: number;
  oddsAmerican: number | null;
  matchStatus: 'matched' | 'ambiguous' | 'unmatched';
  matchedPlayer: { playerId: string; fullName: string } | null;
  ambiguousCandidates: Array<{ playerId: string; fullName: string }> | null;
  unmatchedReason: string | null;
  propTypeError: string | null;
  analysis: {
    modelProbability: number | null;
    ev: number | null;
    projection: number | null;
    marketImpliedProbability: number | null;
    confidenceTier: string | null;
    sigmaSummary: string | null;
    modelProbabilityTrackBRaw: number | null;
    modelProbabilityTrackBCalibrated: number | null;
    modelProbabilityTrackBAnchored: number | null;
    calibrationVersion: string;
  } | null;
  evSelectedTrack: string;
};

type ParlayBlock = {
  combinedModelProbability: number | null;
  impliedProbabilityFromTotal: number | null;
  estimatedParlayEv: number | null;
  strongestLegIndex: number | null;
  weakestLegIndex: number | null;
  independenceNote: string;
};

type AnalysisResultsProps = {
  slip: EditableSlip;
  legs: LegAnalysis[];
  parlay: ParlayBlock;
};

function formatPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

function formatOdds(odds: number | null): string {
  if (odds == null) return '—';
  return odds > 0 ? `+${Math.round(odds)}` : String(Math.round(odds));
}

export function AnalysisResults({ slip, legs, parlay }: AnalysisResultsProps) {
  const isParlay = slip.bet_type === 'parlay' && legs.length > 1;

  return (
    <div className="space-y-6">
      {isParlay ? (
        <div className="rounded-xl border border-white/10 bg-secondary/20 p-4 space-y-2">
          <h3 className="text-sm font-semibold text-white">Parlay summary (independent legs)</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>
              Combined model probability:{' '}
              <span className="text-white tabular-nums">
                {formatPct(parlay.combinedModelProbability)}
              </span>
            </li>
            <li>
              Implied probability (total odds):{' '}
              <span className="text-white tabular-nums">
                {formatPct(parlay.impliedProbabilityFromTotal)}
              </span>
            </li>
            <li>
              Estimated parlay EV (from total decimal odds):{' '}
              <span className="text-white tabular-nums">
                {parlay.estimatedParlayEv != null && Number.isFinite(parlay.estimatedParlayEv)
                  ? `${(parlay.estimatedParlayEv * 100).toFixed(2)}%`
                  : '—'}
              </span>
            </li>
            {parlay.strongestLegIndex != null ? (
              <li>
                Strongest leg (by EV): <span className="text-[#39ff14]">Leg {parlay.strongestLegIndex + 1}</span>
              </li>
            ) : null}
            {parlay.weakestLegIndex != null ? (
              <li>
                Weakest leg (by EV): <span className="text-orange-300">Leg {parlay.weakestLegIndex + 1}</span>
              </li>
            ) : null}
          </ul>
          <p className="text-xs text-amber-200/80 border-t border-white/10 pt-2 mt-2">
            {parlay.independenceNote}
          </p>
        </div>
      ) : null}

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-white">Leg analysis</h3>
        {legs.map((leg) => (
          <div
            key={leg.index}
            className="rounded-xl border border-white/10 bg-secondary/30 p-4 space-y-2"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-white font-medium">
                Leg {leg.index + 1}: {leg.playerNameInput} — {leg.propType} {leg.side} {leg.line}
              </span>
              <span className="text-xs text-muted-foreground">Book: {formatOdds(leg.oddsAmerican)}</span>
            </div>

            {leg.matchStatus === 'unmatched' && leg.unmatchedReason ? (
              <p className="text-sm text-red-400">{leg.unmatchedReason}</p>
            ) : null}
            {leg.matchStatus === 'ambiguous' ? (
              <p className="text-sm text-amber-200">{leg.unmatchedReason ?? 'Ambiguous player match.'}</p>
            ) : null}
            {leg.propTypeError ? (
              <p className="text-sm text-orange-300">{leg.propTypeError}</p>
            ) : null}

            {leg.matchedPlayer ? (
              <p className="text-xs text-muted-foreground">
                Matched: {leg.matchedPlayer.fullName}{' '}
                <span className="text-white/60">({leg.matchedPlayer.playerId})</span>
              </p>
            ) : null}

            {leg.analysis ? (
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm mt-2">
                <div>
                  <dt className="text-muted-foreground">Projection</dt>
                  <dd className="text-white tabular-nums">
                    {leg.analysis.projection != null && Number.isFinite(leg.analysis.projection)
                      ? leg.analysis.projection.toFixed(1)
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Model P</dt>
                  <dd className="text-white tabular-nums">{formatPct(leg.analysis.modelProbability)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Implied P</dt>
                  <dd className="text-white tabular-nums">{formatPct(leg.analysis.marketImpliedProbability)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">EV</dt>
                  <dd
                    className={
                      leg.analysis.ev != null && leg.analysis.ev >= 0
                        ? 'text-[#39ff14] tabular-nums'
                        : 'text-white tabular-nums'
                    }
                  >
                    {leg.analysis.ev != null && Number.isFinite(leg.analysis.ev)
                      ? `${(leg.analysis.ev * 100).toFixed(2)}%`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Confidence</dt>
                  <dd className="text-white capitalize">{leg.analysis.confidenceTier ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Track</dt>
                  <dd className="text-white text-xs">{leg.evSelectedTrack}</dd>
                </div>
              </dl>
            ) : null}

            {leg.analysis?.sigmaSummary ? (
              <p className="text-xs text-muted-foreground mt-2 border-t border-white/5 pt-2">
                {leg.analysis.sigmaSummary}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
