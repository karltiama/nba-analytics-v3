import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

const SECTION_PILLS = 5;

function GlassSection({
  titleWidth,
  children,
  borderClass = 'border-white/5',
}: {
  titleWidth: string;
  children: ReactNode;
  borderClass?: string;
}) {
  return (
    <div className={`glass-card rounded-xl overflow-hidden border ${borderClass}`}>
      <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02] flex items-center gap-2">
        <Skeleton className="h-6 w-6 rounded-md shrink-0 bg-white/10" />
        <Skeleton className={`h-4 ${titleWidth} bg-white/10`} />
      </div>
      <div className="p-3 space-y-3">{children}</div>
    </div>
  );
}

/**
 * Mirrors the shell of `MatchupPageLayout` (sticky header, section nav, stacked glass cards)
 * while `/api/betting/games/...` requests are in flight.
 */
export function BettingGameDetailsPageSkeleton() {
  return (
    <main className="min-h-screen bg-background gradient-mesh max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-5">
      <div className="sticky top-0 z-10 glass-card rounded-xl overflow-hidden border border-white/5 bg-background/95 backdrop-blur-sm">
        <div className="px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-center gap-x-4 gap-y-2 min-w-0 bg-white/[0.02] relative">
          <Skeleton className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 h-9 w-9 rounded-lg bg-white/10" />
          <div className="flex items-center gap-2 min-w-0 shrink-0">
            <Skeleton className="h-4 w-4 rounded shrink-0 bg-white/10" />
            <Skeleton className="h-4 w-36 sm:w-44 bg-white/10" />
          </div>
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <div className="text-center space-y-1.5">
              <Skeleton className="h-5 w-10 mx-auto bg-white/10" />
              <Skeleton className="h-3 w-14 mx-auto bg-white/10" />
            </div>
            <Skeleton className="h-3 w-3 rounded-full bg-white/10" />
            <div className="text-center space-y-1.5">
              <Skeleton className="h-5 w-10 mx-auto bg-white/10" />
              <Skeleton className="h-3 w-14 mx-auto bg-white/10" />
            </div>
          </div>
        </div>
        <div className="px-3 sm:px-5 py-2 border-t border-white/5 flex flex-wrap items-center justify-center gap-1.5 bg-white/[0.02]">
          {Array.from({ length: SECTION_PILLS }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-[6.5rem] rounded-lg bg-white/10" />
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-col lg:flex-row lg:items-start gap-4 lg:gap-5">
        <div className="flex-1 min-w-0 space-y-4">
          <GlassSection titleWidth="w-48 max-w-[70%]" borderClass="border-[#bf5af2]/30">
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full sm:w-[calc(50%-0.25rem)] lg:w-[calc(25%-0.375rem)] max-w-[200px] rounded-lg bg-white/10" />
              ))}
            </div>
            <Skeleton className="h-20 w-full rounded-lg bg-white/10" />
            <Skeleton className="h-3 w-3/4 max-w-md bg-white/10" />
          </GlassSection>

          <GlassSection titleWidth="w-40 max-w-[60%]">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="space-y-2 rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <Skeleton className="h-3 w-24 bg-white/10" />
                <Skeleton className="h-24 w-full rounded-md bg-white/10" />
              </div>
              <div className="space-y-2 rounded-lg border border-white/5 bg-white/[0.02] p-3 min-h-[200px]">
                <Skeleton className="h-3 w-28 bg-white/10" />
                <Skeleton className="h-28 w-full rounded-md bg-white/10" />
              </div>
            </div>
          </GlassSection>

          <div className="glass-card rounded-xl overflow-hidden border border-white/5">
            <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
              <Skeleton className="h-4 w-28 bg-white/10" />
            </div>
            <div className="p-3 overflow-x-auto">
              <div className="space-y-2 min-w-[520px]">
                <div className="flex gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-3 flex-1 bg-white/10" />
                  ))}
                </div>
                {Array.from({ length: 6 }).map((_, row) => (
                  <div key={row} className="flex gap-2">
                    {Array.from({ length: 5 }).map((_, col) => (
                      <Skeleton
                        key={col}
                        className={`h-4 bg-white/10 ${col === 0 ? 'flex-[1.2]' : 'flex-1'}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
