import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

const SECTION_PILLS = 5;

function SectionSkeleton({
  titleWidth,
  children,
  borderClass = 'border-[#DCE9EA]',
}: {
  titleWidth: string;
  children: ReactNode;
  borderClass?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl overflow-hidden border ${borderClass} shadow-sm`}>
      <div className="px-3 py-2 border-b border-[#DCE9EA] bg-[#F8FBFA] flex items-center gap-2">
        <Skeleton className="h-6 w-6 rounded-md shrink-0 bg-[#DCE9EA]" />
        <Skeleton className={`h-4 ${titleWidth} bg-[#DCE9EA]`} />
      </div>
      <div className="p-3 space-y-3">{children}</div>
    </div>
  );
}

/**
 * Mirrors the shell of `MatchupPageLayout` (sticky header, section nav, stacked cards)
 * while `/api/betting/games/...` requests are in flight.
 */
export function BettingGameDetailsPageSkeleton() {
  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-5">
      <div className="sticky top-16 z-10 bg-white/95 rounded-2xl overflow-hidden border border-[#DCE9EA] shadow-sm backdrop-blur-sm">
        <div className="px-3 sm:px-5 py-3 sm:py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6 min-w-0 bg-[#F8FBFA]">
          <div className="flex items-center gap-2 min-w-0 sm:w-64 lg:w-80 shrink-0">
            <Skeleton className="h-9 w-9 rounded-lg shrink-0 bg-[#DCE9EA]" />
            <Skeleton className="h-4 w-28 sm:w-36 bg-[#DCE9EA]" />
            <Skeleton className="h-5 w-12 rounded-full bg-[#DCE9EA]" />
          </div>
          <div className="flex-1 flex items-center justify-between min-w-0 sm:px-6 lg:px-12">
            <div className="flex items-center gap-2 sm:gap-3">
              <Skeleton className="h-12 w-12 rounded-full bg-[#DCE9EA]" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-10 bg-[#DCE9EA]" />
                <Skeleton className="h-6 w-12 bg-[#DCE9EA]" />
              </div>
            </div>
            <Skeleton className="h-3 w-3 rounded-full bg-[#DCE9EA]" />
            <div className="flex items-center gap-2 sm:gap-3">
              <Skeleton className="h-12 w-12 rounded-full bg-[#DCE9EA]" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-10 bg-[#DCE9EA]" />
                <Skeleton className="h-6 w-12 bg-[#DCE9EA]" />
              </div>
            </div>
          </div>
          <div className="hidden sm:block sm:w-16 lg:w-24 shrink-0" aria-hidden />
        </div>
        <div className="px-3 sm:px-5 py-2 border-t border-[#DCE9EA] flex flex-wrap items-center justify-center gap-1.5 bg-[#F8FBFA]">
          {Array.from({ length: SECTION_PILLS }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-[6.5rem] rounded-lg bg-[#DCE9EA]" />
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-col lg:flex-row lg:items-start gap-4 lg:gap-5">
        <div className="flex-1 min-w-0 space-y-4">
          <SectionSkeleton titleWidth="w-36 max-w-[50%]">
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 2 }).map((_, col) => (
                <div key={col} className="space-y-2">
                  {Array.from({ length: 5 }).map((_, row) => (
                    <Skeleton key={row} className="h-4 w-full bg-[#DCE9EA]" />
                  ))}
                </div>
              ))}
            </div>
          </SectionSkeleton>

          <SectionSkeleton titleWidth="w-40 max-w-[60%]">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="space-y-2 rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] p-3">
                <Skeleton className="h-3 w-24 bg-[#DCE9EA]" />
                <Skeleton className="h-24 w-full rounded-md bg-[#DCE9EA]" />
              </div>
              <div className="space-y-2 rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] p-3 min-h-[200px]">
                <Skeleton className="h-3 w-28 bg-[#DCE9EA]" />
                <Skeleton className="h-28 w-full rounded-md bg-[#DCE9EA]" />
              </div>
            </div>
          </SectionSkeleton>

          <div className="bg-white rounded-2xl overflow-hidden border border-[#DCE9EA] shadow-sm">
            <div className="px-3 py-2 border-b border-[#DCE9EA] bg-[#F8FBFA]">
              <Skeleton className="h-4 w-28 bg-[#DCE9EA]" />
            </div>
            <div className="p-3 overflow-x-auto">
              <div className="space-y-2 min-w-[520px]">
                <div className="flex gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-3 flex-1 bg-[#DCE9EA]" />
                  ))}
                </div>
                {Array.from({ length: 6 }).map((_, row) => (
                  <div key={row} className="flex gap-2">
                    {Array.from({ length: 5 }).map((_, col) => (
                      <Skeleton
                        key={col}
                        className={`h-4 bg-[#DCE9EA] ${col === 0 ? 'flex-[1.2]' : 'flex-1'}`}
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
