'use client';

import { cn } from '@/lib/utils';

export function FutureOddsPlaceholderCard() {
  return (
    <section
      className={cn(
        'glass-card rounded-xl p-6 border border-dashed border-white/20',
        'flex flex-col items-center justify-center min-h-[120px] text-center'
      )}
    >
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Odds Analysis
      </h3>
      <p className="text-sm text-muted-foreground">Odds integration coming soon.</p>
      <p className="text-xs text-muted-foreground/80 mt-1 max-w-md">
        This section will compare player trends and matchup context against current sportsbook
        lines.
      </p>
    </section>
  );
}
