'use client';

import { Search, SlidersHorizontal, ArrowUpDown, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { getTodayET, addDaysET, getDateLabel } from './DateNav';

export type SortOption = 'time' | 'spread' | 'total' | 'probability';

interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  showFavoritesOnly: boolean;
  onFavoritesToggle: () => void;
  showCloseMatchups: boolean;
  onCloseMatchupsToggle: () => void;
  /** When provided, show date nav (prev/next + quick dates) in the same bar */
  selectedDate?: string;
  onDateChange?: (date: string) => void;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  sortBy,
  onSortChange,
  showFavoritesOnly,
  onFavoritesToggle,
  showCloseMatchups,
  onCloseMatchupsToggle,
  selectedDate,
  onDateChange,
}: FilterBarProps) {
  const [showSortMenu, setShowSortMenu] = useState(false);

  const sortOptions: { value: SortOption; label: string }[] = [
    { value: 'time', label: 'Start Time' },
    { value: 'spread', label: 'Spread Size' },
    { value: 'total', label: 'Over/Under' },
    { value: 'probability', label: 'Market Probability' }
  ];

  const showDateNav = selectedDate != null && onDateChange != null;
  const today = showDateNav ? getTodayET() : '';

  return (
    <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-2 sm:p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
      {/* Date nav (when props provided) */}
      {showDateNav && (
        <>
          <div className="flex items-center gap-0.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onDateChange(addDaysET(selectedDate, -1))}
              className="p-1.5 sm:p-2 rounded-lg hover:bg-[#f7f9f7] transition-colors text-[#4a6366] hover:text-[#063f46]"
              aria-label="Previous day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="type-interactive min-w-[72px] text-center text-[#063f46] sm:min-w-[120px]">
              {getDateLabel(selectedDate)}
            </span>
            <button
              type="button"
              onClick={() => onDateChange(addDaysET(selectedDate, 1))}
              className="p-1.5 sm:p-2 rounded-lg hover:bg-[#f7f9f7] transition-colors text-[#4a6366] hover:text-[#063f46]"
              aria-label="Next day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="hidden sm:flex items-center gap-1 ml-1">
              <button
                type="button"
                onClick={() => onDateChange(addDaysET(today, -1))}
                className="type-interactive rounded px-2 py-1 text-cc-secondary hover:bg-[#f7f9f7] hover:text-[#063f46]"
              >
                Yesterday
              </button>
              <button
                type="button"
                onClick={() => onDateChange(today)}
                className="type-interactive rounded px-2 py-1 text-cc-secondary hover:bg-[#f7f9f7] hover:text-[#063f46]"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => onDateChange(addDaysET(today, 1))}
                className="type-interactive rounded px-2 py-1 text-cc-secondary hover:bg-[#f7f9f7] hover:text-[#063f46]"
              >
                Tomorrow
              </button>
            </div>
          </div>
          <div className="h-px sm:h-6 sm:w-px sm:min-h-0 bg-[#DCE9EA] shrink-0" aria-hidden />
        </>
      )}

      {/* Search + sort + filters: wrap together in 640–950px so search keeps room */}
      <div className="flex flex-1 min-w-0 flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative flex-1 min-w-[200px] w-full lg:min-w-0 lg:w-auto">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cc-secondary sm:left-3" />
          <input
            type="text"
            placeholder="Search teams..."
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className="type-interactive w-full rounded-lg border border-[#DCE9EA] bg-[#f7f9f7] py-1.5 pl-8 pr-8 text-[#063f46] placeholder:text-[#4a6366] transition-all focus:outline-none focus:ring-2 focus:ring-[#55ddb1]/40 sm:py-2 sm:pl-9 sm:pr-9"
          />
          {searchValue && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 sm:right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[#e8f0ee] transition-colors"
            >
              <X className="h-3.5 w-3.5 text-cc-secondary" />
            </button>
          )}
        </div>

        <div className="relative shrink-0">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 bg-[#f7f9f7] border border-[#DCE9EA] rounded-lg hover:bg-[#eef4f3] transition-colors whitespace-nowrap"
          >
            <ArrowUpDown className="w-4 h-4 text-[#4a6366] shrink-0" />
            <span className="type-interactive text-[#063f46]">
              {sortOptions.find(o => o.value === sortBy)?.label}
            </span>
          </button>
          {showSortMenu && (
            <>
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setShowSortMenu(false)} 
              />
              <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-white rounded-lg border border-[#DCE9EA] shadow-sm py-1 fade-in">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      onSortChange(option.value);
                      setShowSortMenu(false);
                    }}
                    className={`type-interactive w-full px-3 py-2 text-left hover:bg-[#f7f9f7] transition-colors ${
                      sortBy === option.value ? 'text-[#075B5C]' : 'text-[#063f46]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
          <button
            onClick={onFavoritesToggle}
            title="Games involving your favorite teams"
            className={`type-interactive whitespace-nowrap rounded-lg border px-2 py-1.5 transition-colors sm:px-3 sm:py-2 ${
              showFavoritesOnly 
                ? 'bg-[#55ddb1]/25 border-[#55ddb1] text-[#075B5C]' 
                : 'bg-[#f7f9f7] border-[#DCE9EA] text-[#4a6366] hover:bg-[#eef4f3]'
            }`}
          >
            Favorites
          </button>
          <button
            onClick={onCloseMatchupsToggle}
            title="Market implied probabilities within 10 points (vig-free display)"
            className={`type-interactive whitespace-nowrap rounded-lg border px-2 py-1.5 transition-colors sm:px-3 sm:py-2 ${
              showCloseMatchups 
                ? 'bg-amber-50 border-amber-200 text-amber-800' 
                : 'bg-[#f7f9f7] border-[#DCE9EA] text-[#4a6366] hover:bg-[#eef4f3]'
            }`}
          >
            Close Matchups
          </button>
          <button className="p-1.5 sm:p-2 bg-[#f7f9f7] border border-[#DCE9EA] rounded-lg hover:bg-[#eef4f3] transition-colors shrink-0" aria-label="Filters">
            <SlidersHorizontal className="w-4 h-4 text-[#4a6366]" />
          </button>
        </div>
      </div>
    </div>
  );
}






























