'use client';

import { cn } from '@/lib/utils';

export function FutureOddsPlaceholderCard() {
  return (
    <section
      className={cn(
        'bg-white border border-dashed border-[#DCE9EA] rounded-2xl shadow-sm p-6',
        'flex flex-col items-center justify-center min-h-[120px] text-center'
      )}
    >
      <h3 className="type-section-heading text-[#063f46] mb-2">
        Odds Analysis
      </h3>
      <p className="type-secondary">Odds integration coming soon.</p>
      <p className="type-body text-cc-secondary mt-1 max-w-md">
        This section will compare player trends and matchup context against current sportsbook
        lines.
      </p>
    </section>
  );
}
