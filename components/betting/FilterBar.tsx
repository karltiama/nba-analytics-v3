'use client';

import { Search, SlidersHorizontal, ArrowUpDown, X } from 'lucide-react';
import { useState } from 'react';

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
}

export function FilterBar({
  searchValue,
  onSearchChange,
  sortBy,
  onSortChange,
  showFavoritesOnly,
  onFavoritesToggle,
  showCloseMatchups,
  onCloseMatchupsToggle
}: FilterBarProps) {
  const [showSortMenu, setShowSortMenu] = useState(false);

  const sortOptions: { value: SortOption; label: string }[] = [
    { value: 'time', label: 'Start Time' },
    { value: 'spread', label: 'Spread Size' },
    { value: 'total', label: 'Over/Under' },
    { value: 'probability', label: 'Win Probability' }
  ];

  return (
    <div className="glass-card rounded-xl p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
      {/* Search */}
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search teams..."
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-9 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#00d4ff]/50 transition-all"
        />
        {searchValue && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10 transition-colors"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Sort Dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowSortMenu(!showSortMenu)}
          className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors"
        >
          <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-white">
            {sortOptions.find(o => o.value === sortBy)?.label}
          </span>
        </button>
        
        {showSortMenu && (
          <>
            <div 
              className="fixed inset-0 z-10" 
              onClick={() => setShowSortMenu(false)} 
            />
            <div className="absolute right-0 top-full mt-1 z-20 w-48 glass-card rounded-lg border border-white/10 py-1 fade-in">
              {sortOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    onSortChange(option.value);
                    setShowSortMenu(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-white/5 transition-colors ${
                    sortBy === option.value ? 'text-[#00d4ff]' : 'text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Filter Toggles */}
      <div className="flex items-center gap-2">
        <button
          onClick={onFavoritesToggle}
          className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
            showFavoritesOnly 
              ? 'bg-[#39ff14]/20 border-[#39ff14]/50 text-[#39ff14]' 
              : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10'
          }`}
        >
          Favorites
        </button>
        <button
          onClick={onCloseMatchupsToggle}
          className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
            showCloseMatchups 
              ? 'bg-[#ff6b35]/20 border-[#ff6b35]/50 text-[#ff6b35]' 
              : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10'
          }`}
        >
          Close Matchups
        </button>
        <button className="p-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors">
          <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}








