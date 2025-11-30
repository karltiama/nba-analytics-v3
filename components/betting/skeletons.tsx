'use client';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * Game Card Skeleton
 */
export function GameCardSkeleton() {
  return (
    <div className="glass-card rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/5 bg-white/[0.02]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="w-3.5 h-3.5 rounded" />
            <Skeleton className="w-20 h-3" />
          </div>
          <Skeleton className="w-24 h-4 rounded-full" />
        </div>
      </div>

      {/* Teams Section */}
      <div className="p-4 space-y-3">
        {/* Away Team */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="w-12 h-12 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="w-32 h-4" />
              <Skeleton className="w-12 h-3" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right space-y-1">
              <Skeleton className="w-12 h-4 ml-auto" />
              <Skeleton className="w-6 h-2 ml-auto" />
            </div>
            <div className="text-right space-y-1">
              <Skeleton className="w-10 h-4 ml-auto" />
              <Skeleton className="w-8 h-2 ml-auto" />
            </div>
          </div>
        </div>

        {/* VS Divider */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-white/10" />
          <Skeleton className="w-6 h-3" />
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Home Team */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="w-12 h-12 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="w-28 h-4" />
              <Skeleton className="w-12 h-3" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right space-y-1">
              <Skeleton className="w-12 h-4 ml-auto" />
              <Skeleton className="w-6 h-2 ml-auto" />
            </div>
            <div className="text-right space-y-1">
              <Skeleton className="w-10 h-4 ml-auto" />
              <Skeleton className="w-8 h-2 ml-auto" />
            </div>
          </div>
        </div>
      </div>

      {/* O/U Section */}
      <div className="px-4 py-3 border-t border-white/5 bg-white/[0.02]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-8" />
            <Skeleton className="w-24 h-3" />
          </div>
          <div className="flex items-center gap-4">
            <Skeleton className="w-8 h-4" />
            <Skeleton className="w-20 h-1.5 rounded-full" />
            <Skeleton className="w-8 h-4" />
          </div>
        </div>
      </div>

      {/* Action Button */}
      <div className="px-4 py-2.5 bg-[#00d4ff]/5">
        <Skeleton className="w-32 h-4 mx-auto" />
      </div>
    </div>
  );
}

/**
 * Player Card Skeleton
 */
export function PlayerCardSkeleton() {
  return (
    <div className="glass-card rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-start gap-3">
        {/* Avatar */}
        <div className="relative">
          <Skeleton className="w-14 h-14 rounded-xl" />
          <Skeleton className="absolute -bottom-1 -right-1 w-6 h-6 rounded-md" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1.5">
              <Skeleton className="w-32 h-4" />
              <Skeleton className="w-24 h-3" />
            </div>
            <Skeleton className="w-12 h-4" />
          </div>

          {/* Sparklines */}
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1.5">
              <Skeleton className="w-6 h-3" />
              <Skeleton className="w-12 h-5" />
            </div>
            <div className="flex items-center gap-1.5">
              <Skeleton className="w-6 h-3" />
              <Skeleton className="w-12 h-5" />
            </div>
            <div className="flex items-center gap-1.5">
              <Skeleton className="w-6 h-3" />
              <Skeleton className="w-12 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Props */}
      <div className="px-4 pb-3 space-y-2">
        <Skeleton className="w-full h-12 rounded-lg" />
        <Skeleton className="w-full h-12 rounded-lg" />
      </div>

      {/* Why Section */}
      <div className="border-t border-white/5 px-4 py-2.5">
        <Skeleton className="w-28 h-4" />
      </div>
    </div>
  );
}

/**
 * Insights Widget Skeleton
 */
export function InsightWidgetSkeleton() {
  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <Skeleton className="w-12 h-4" />
      </div>
      <div className="space-y-2">
        <Skeleton className="w-20 h-3" />
        <Skeleton className="w-16 h-7" />
        <Skeleton className="w-full h-3" />
      </div>
    </div>
  );
}

/**
 * AI Insight Panel Skeleton
 */
export function AIInsightPanelSkeleton() {
  return (
    <div className="glass-card rounded-xl overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="w-7 h-7 rounded-lg" />
          <div className="space-y-1">
            <Skeleton className="w-20 h-4" />
            <Skeleton className="w-16 h-2" />
          </div>
        </div>
        <Skeleton className="w-12 h-4" />
      </div>

      {/* Insights List */}
      <div className="flex-1 p-3 space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="p-3 rounded-lg bg-white/[0.03] border border-white/5">
            <div className="flex items-start gap-3">
              <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="w-3/4 h-4" />
                <Skeleton className="w-full h-3" />
                <Skeleton className="w-2/3 h-3" />
                <Skeleton className="w-16 h-2 mt-1" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-white/5 bg-white/[0.02]">
        <Skeleton className="w-48 h-3 mx-auto" />
      </div>
    </div>
  );
}

/**
 * Betting Insights Section Skeleton
 */
export function BettingInsightsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="w-44 h-5" />
        <Skeleton className="w-24 h-3" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {[...Array(5)].map((_, i) => (
          <InsightWidgetSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}








