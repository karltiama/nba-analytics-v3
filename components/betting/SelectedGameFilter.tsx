'use client';

import { X } from 'lucide-react';
import { selectedGameDateLabel } from '@/lib/betting/selected-game-filter';

export function SelectedGameFilter({
  matchup,
  date,
  onClear,
}: {
  matchup: string;
  date: string;
  onClear: () => void;
}) {
  return (
    <div
      data-selected-game
      className="inline-flex max-w-full items-center gap-2 rounded-xl border border-[#DCE9EA] bg-white py-1.5 pl-3 pr-1"
    >
      <div className="min-w-0">
        <p className="type-metadata">Selected Game</p>
        <p className="type-interactive truncate text-[#063f46]">{matchup}</p>
        <p className="type-metadata truncate">{selectedGameDateLabel(date)}</p>
      </div>
      <button
        type="button"
        aria-label="Remove game filter"
        onClick={onClear}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-[#063f46] outline-none hover:bg-[#F8FBFA] focus-visible:ring-2 focus-visible:ring-[#55ddb1]"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
