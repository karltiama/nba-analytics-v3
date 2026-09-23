'use client';

import { Dialog } from 'radix-ui';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { addDaysET, getTodayET } from '@/components/betting/DateNav';
import {
  EXPLORER_BOOKS,
  EXPLORER_PROP_TYPES,
  EXPLORER_SORT_OPTIONS,
  explorerActiveFilterCount,
  explorerCalendarDateLabel,
  toggleSportsbookParam,
} from '@/lib/betting/props-explorer-filters';

const fieldClass =
  'type-body min-h-11 w-full rounded-xl border border-[#DCE9EA] bg-white px-3 text-[#063f46] focus:border-[#075B5C] focus:outline-none focus:ring-1 focus:ring-[#55ddb1]';

export function PropsExplorerMobileControls({
  searchDraft,
  onSearchChange,
  onSearchClear,
  date,
  gameId,
  games,
  propType,
  side,
  minEv,
  sportsbook,
  sort,
  dir,
  marketContext,
  lineLabel,
  showAdvancedMetrics,
  onToggleAdvanced,
  onUpdate,
}: {
  searchDraft: string;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  date: string;
  gameId: string;
  games: Array<{ id: string; label: string }>;
  propType: string;
  side: string;
  minEv: string;
  sportsbook: string;
  sort: string;
  dir: 'asc' | 'desc';
  marketContext: 'live' | 'historical';
  lineLabel: string;
  showAdvancedMetrics: boolean;
  onToggleAdvanced: () => void;
  onUpdate: (updates: Record<string, string | null>) => void;
}) {
  const today = getTodayET();
  const filterCount = explorerActiveFilterCount({
    date,
    today,
    gameId,
    propType,
    side,
    minEv,
    sportsbook,
  });
  const selectedGame = games.find((game) => game.id === gameId.trim());
  const gameContext = gameId.trim() ? selectedGame?.label ?? 'Selected game' : 'All games';
  const historical = marketContext === 'historical';
  const sortOptions = EXPLORER_SORT_OPTIONS.filter((option) =>
    historical ? option.value === 'snapshot_at' || option.value === 'odds_american' : true
  );

  return (
    <Dialog.Root>
      <div data-mobile-toolbar className="lg:hidden mb-4 min-w-0 space-y-2">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-4 w-4 text-cc-secondary" aria-hidden />
          </div>
          <input
            className={`${fieldClass} pl-10 ${searchDraft ? 'pr-12' : ''}`}
            placeholder="Search player..."
            value={searchDraft}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label="Player Name"
          />
          {searchDraft ? (
            <button
              type="button"
              aria-label="Clear player search"
              onClick={onSearchClear}
              className="type-interactive absolute right-0 top-0 inline-flex min-h-11 min-w-11 items-center justify-center text-cc-secondary"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Dialog.Trigger asChild>
            <button
              type="button"
              data-coachmark="props-discover"
              className="type-interactive inline-flex min-h-11 shrink-0 items-center rounded-xl border border-[#DCE9EA] bg-white px-3 text-[#063f46]"
            >
              {filterCount > 0 ? `Filters (${filterCount})` : 'Filters'}
            </button>
          </Dialog.Trigger>
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="type-secondary shrink-0">Sort</span>
            <select
              className={`${fieldClass} min-w-0`}
              value={sort}
              onChange={(event) => onUpdate({ sort: event.target.value, offset: '0' })}
              aria-label="Sort by"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === 'snapshot_at' && historical ? 'Closing time' : option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label="Sort direction"
            onClick={() => onUpdate({ dir: dir === 'desc' ? 'asc' : 'desc', offset: '0' })}
            className="type-interactive inline-flex min-h-11 shrink-0 items-center rounded-xl border border-[#DCE9EA] bg-white px-3 text-[#063f46]"
          >
            {dir === 'desc' ? 'Desc' : 'Asc'}
          </button>
        </div>

        <p className="type-metadata">
          {explorerCalendarDateLabel(date)}
          <span aria-hidden> · </span>
          {gameContext}
          <span aria-hidden> · </span>
          {lineLabel}
        </p>
      </div>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[190] bg-[#063f46]/40" />
        <Dialog.Content
          data-filter-sheet
          className="fixed inset-x-0 bottom-0 z-[191] flex max-h-[min(85dvh,40rem)] flex-col rounded-t-2xl border border-[#DCE9EA] bg-white shadow-xl outline-none"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#DCE9EA] px-4 py-2">
            <Dialog.Title className="type-section-heading text-[#063f46]">Filters</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="type-interactive inline-flex min-h-11 items-center rounded-xl px-3 text-[#063f46]"
              >
                Close
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Date, game, prop type, side, minimum EV, sportsbooks, and advanced metrics.
          </Dialog.Description>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div>
              <p className="type-secondary mb-2">Date</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Previous day"
                  onClick={() => onUpdate({ date: addDaysET(date, -1), offset: '0' })}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[#DCE9EA] text-[#063f46]"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden />
                </button>
                <p className="type-secondary min-w-0 flex-1 text-center text-[#063f46]">
                  {explorerCalendarDateLabel(date)}
                </p>
                <button
                  type="button"
                  aria-label="Next day"
                  onClick={() => onUpdate({ date: addDaysET(date, 1), offset: '0' })}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[#DCE9EA] text-[#063f46]"
                >
                  <ChevronRight className="h-5 w-5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-pressed={date === today}
                  onClick={() => onUpdate({ date: today, offset: '0' })}
                  className="type-interactive inline-flex min-h-11 items-center rounded-xl border border-[#DCE9EA] px-3 text-[#063f46]"
                >
                  Today
                </button>
              </div>
            </div>

            <label className="block">
              <span className="type-secondary mb-2 block">Game</span>
              <select
                className={fieldClass}
                aria-label="Game"
                value={gameId}
                onChange={(event) => onUpdate({ game_id: event.target.value || null, offset: '0' })}
              >
                <option value="">All games</option>
                {games.map((game) => (
                  <option key={game.id} value={game.id}>
                    {game.label}
                  </option>
                ))}
                {gameId.trim() && !games.some((game) => game.id === gameId.trim()) ? (
                  <option value={gameId.trim()}>Selected game</option>
                ) : null}
              </select>
            </label>

            <label className="block">
              <span className="type-secondary mb-2 block">Prop type</span>
              <select
                className={fieldClass}
                aria-label="Prop type"
                value={propType}
                onChange={(event) => onUpdate({ prop_type: event.target.value || null, offset: '0' })}
              >
                <option value="">All props</option>
                {EXPLORER_PROP_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="type-secondary mb-2 block">Side</span>
              <select
                className={fieldClass}
                aria-label="Side"
                value={side}
                onChange={(event) =>
                  onUpdate({ side: event.target.value === 'all' ? null : event.target.value, offset: '0' })
                }
              >
                <option value="all">All sides</option>
                <option value="over">Over</option>
                <option value="under">Under</option>
              </select>
            </label>

            <label className="block">
              <span className="type-secondary mb-2 block">Minimum EV</span>
              <input
                className={fieldClass}
                placeholder="0.0%"
                value={minEv}
                onChange={(event) => onUpdate({ min_ev: event.target.value || null, offset: '0' })}
                aria-label="Minimum EV"
                disabled={historical}
                title={historical ? 'EV filters do not apply to historical closing lines' : undefined}
              />
            </label>

            <div>
              <p className="type-secondary mb-2">Sportsbooks</p>
              <div className="flex flex-wrap gap-2" aria-label="Sportsbooks">
                {EXPLORER_BOOKS.map((book) => {
                  const active = sportsbook.split(',').filter(Boolean).includes(book.id);
                  return (
                    <button
                      key={book.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        onUpdate({
                          sportsbook: toggleSportsbookParam(sportsbook, book.id),
                          offset: '0',
                        })
                      }
                      className={`type-interactive inline-flex min-h-11 items-center rounded-full border px-3 ${
                        active
                          ? 'border-[#55ddb1] bg-[#55ddb1] text-[#063f46]'
                          : 'border-[#DCE9EA] bg-white text-cc-secondary'
                      }`}
                    >
                      {book.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              aria-pressed={showAdvancedMetrics}
              onClick={onToggleAdvanced}
              className="type-interactive inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[#DCE9EA] bg-white px-3 text-[#063f46]"
            >
              {showAdvancedMetrics ? 'Hide advanced metrics' : 'Show advanced metrics'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
