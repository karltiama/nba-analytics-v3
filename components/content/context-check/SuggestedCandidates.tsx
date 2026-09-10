'use client';

import { formatMarketClaim } from '@/lib/content/context-check/format';
import type { ContextCheckCandidate } from '@/lib/content/context-check/types';

export function SuggestedCandidates({
  candidates,
  onPreview,
}: {
  candidates: ContextCheckCandidate[];
  onPreview: (candidate: ContextCheckCandidate) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Today&apos;s Context Check Candidates
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Candidate scores are editorial-only and never appear on the public card.
        </p>
      </div>
      <ul className="space-y-3">
        {candidates.map((candidate) => {
          const claim = formatMarketClaim(
            candidate.data.market.direction,
            candidate.data.market.line,
            candidate.data.market.type
          );
          return (
            <li
              key={candidate.id}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold text-foreground">
                    {candidate.data.player.name}{' '}
                    <span className="font-normal text-muted-foreground">{claim}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{candidate.reason}</p>
                  <p className="text-sm text-foreground/80">{candidate.summary}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    Candidate score: {candidate.score}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onPreview(candidate)}
                  className="rounded-md border border-neon-cyan/40 px-3 py-1.5 text-sm font-medium text-neon-cyan hover:bg-neon-cyan/10"
                >
                  Preview
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
