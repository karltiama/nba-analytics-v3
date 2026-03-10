'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

const ET = 'America/New_York';

/** Today's date in ET as YYYY-MM-DD */
export function getTodayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: ET });
}

/** Add days to a YYYY-MM-DD string (in ET calendar) and return YYYY-MM-DD */
export function addDaysET(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Human-friendly label for a YYYY-MM-DD date (Today / Yesterday / Tomorrow or formatted) */
export function getDateLabel(dateStr: string): string {
  const today = getTodayET();
  const yesterday = addDaysET(today, -1);
  const tomorrow = addDaysET(today, 1);
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  if (dateStr === tomorrow) return 'Tomorrow';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface DateNavProps {
  /** Current date YYYY-MM-DD (ET) */
  selectedDate: string;
  /** Called when user selects a new date (YYYY-MM-DD) */
  onDateChange: (date: string) => void;
}

export function DateNav({ selectedDate, onDateChange }: DateNavProps) {
  const today = getTodayET();
  const prevDate = addDaysET(selectedDate, -1);
  const nextDate = addDaysET(selectedDate, 1);
  const label = getDateLabel(selectedDate);

  return (
    <div className="glass-card rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onDateChange(prevDate)}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground hover:text-white"
          aria-label="Previous day"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="min-w-[140px] text-center">
          <span className="text-sm font-medium text-white">{label}</span>
        </div>
        <button
          type="button"
          onClick={() => onDateChange(nextDate)}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground hover:text-white"
          aria-label="Next day"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onDateChange(addDaysET(today, -1))}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-muted-foreground hover:bg-white/10 hover:text-white"
        >
          Yesterday
        </button>
        <button
          type="button"
          onClick={() => onDateChange(today)}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-muted-foreground hover:bg-white/10 hover:text-white"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => onDateChange(addDaysET(today, 1))}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-muted-foreground hover:bg-white/10 hover:text-white"
        >
          Tomorrow
        </button>
      </div>
    </div>
  );
}
