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
      <h3 className="text-sm font-semibold uppercase tracking-wider text-[#4a6366] mb-2">
        Odds Analysis
      </h3>
      <p className="text-sm text-[#4a6366]">Odds integration coming soon.</p>
      <p className="text-xs text-[#8aa0a3] mt-1 max-w-md">
        This section will compare player trends and matchup context against current sportsbook
        lines.
      </p>
    </section>
  );
}
