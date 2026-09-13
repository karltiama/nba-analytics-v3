'use client';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * Game Card Skeleton
 */
export function GameCardSkeleton() {
  return (
    <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 sm:px-6 py-2 border-b border-[#DCE9EA]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="w-4 h-4 rounded bg-[#DCE9EA]" />
            <Skeleton className="w-24 h-3.5 bg-[#E8F0F1]" />
          </div>
          <Skeleton className="w-12 h-4 rounded bg-[#E8F0F1]" />
        </div>
      </div>

      {/* Teams */}
      <div className="px-5 sm:px-6 pt-5 pb-5">
        <div className="flex items-start gap-3">
          <div className="flex items-start gap-2.5 flex-1 min-w-0">
            <Skeleton className="w-14 h-14 rounded-lg bg-[#E8F0F1] shrink-0" />
            <div className="flex-1 space-y-1.5 pt-0.5">
              <Skeleton className="w-20 h-4 bg-[#E8F0F1]" />
              <Skeleton className="w-16 h-4 bg-[#E8F0F1]" />
              <Skeleton className="w-12 h-3 bg-[#E8F0F1]" />
            </div>
          </div>
          <Skeleton className="w-5 h-3 mt-4 bg-[#E8F0F1]" />
          <div className="flex items-start gap-2.5 flex-1 min-w-0">
            <Skeleton className="w-14 h-14 rounded-lg bg-[#E8F0F1] shrink-0" />
            <div className="flex-1 space-y-1.5 pt-0.5">
              <Skeleton className="w-16 h-4 bg-[#E8F0F1]" />
              <Skeleton className="w-14 h-4 bg-[#E8F0F1]" />
              <Skeleton className="w-12 h-3 bg-[#E8F0F1]" />
            </div>
          </div>
        </div>
      </div>

      {/* 3-Column Odds Row */}
      <div className="mx-5 sm:mx-6 mb-5 grid grid-cols-3 rounded-xl border border-[#DCE9EA] overflow-hidden bg-[#F8FBFA]">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`px-2 py-3 text-center ${i < 2 ? 'border-r border-[#DCE9EA]' : ''}`}>
            <Skeleton className="w-12 h-2.5 mx-auto mb-2 bg-[#E8F0F1]" />
            <Skeleton className="w-16 h-4 mx-auto mb-1 bg-[#E8F0F1]" />
            <Skeleton className="w-16 h-4 mx-auto bg-[#E8F0F1]" />
          </div>
        ))}
      </div>

      {/* Pace */}
      {/* Matchup Context */}
      <div className="mx-5 sm:mx-6 mb-3 rounded-xl bg-[#F8FBFA] border border-[#DCE9EA] px-3 py-2 space-y-1">
        <Skeleton className="w-24 h-2 bg-[#E8F0F1]" />
        <Skeleton className="w-full h-3 bg-[#E8F0F1]" />
        <Skeleton className="w-4/5 h-3 bg-[#E8F0F1]" />
      </div>

      {/* Probability Bar */}
      <div className="px-5 sm:px-6 pb-5">
        <div className="flex items-center gap-2.5">
          <Skeleton className="w-8 h-8 bg-[#E8F0F1] shrink-0" />
          <Skeleton className="flex-1 h-2 rounded-full bg-[#E8F0F1]" />
          <Skeleton className="w-8 h-8 bg-[#E8F0F1] shrink-0" />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="px-5 sm:px-6 pb-5 flex flex-col sm:flex-row gap-3">
        <Skeleton className="sm:flex-[1.22] h-11 rounded-xl bg-[#DCE9EA]" />
        <Skeleton className="sm:flex-1 h-11 rounded-xl bg-[#E8F0F1]" />
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
    <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-4">
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
    <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#DCE9EA] flex items-center justify-between">
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
          <div key={i} className="p-3 rounded-lg bg-[#F8FBFA] border border-[#DCE9EA]">
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
      <div className="px-4 py-2.5 border-t border-[#DCE9EA] bg-[#F8FBFA]">
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






























