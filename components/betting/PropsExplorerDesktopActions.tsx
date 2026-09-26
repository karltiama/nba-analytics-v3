'use client';

import Link from 'next/link';
import { DropdownMenu } from 'radix-ui';
import { Bookmark, MoreHorizontal } from 'lucide-react';

const itemClass =
  'flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm text-[#063f46] outline-none hover:bg-[#f7f9f7] focus:bg-[#f7f9f7] data-[disabled]:pointer-events-none data-[disabled]:opacity-40';

export function PropsExplorerDesktopActions({
  isSaved,
  isSaving,
  saveBusy,
  isOnParlay,
  isAddingPaper,
  paperDisabled,
  profileHref,
  onSave,
  onParlay,
  onCompare,
  onPaper,
  onPlayerContext,
}: {
  isSaved: boolean;
  isSaving: boolean;
  saveBusy: boolean;
  isOnParlay: boolean;
  isAddingPaper: boolean;
  paperDisabled: boolean;
  profileHref: string;
  onSave: () => void;
  onParlay: () => void;
  onCompare: () => void;
  onPaper: () => void;
  onPlayerContext: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label={isSaved ? 'Remove saved prop' : 'Save prop'}
        aria-pressed={isSaved}
        disabled={saveBusy}
        onClick={onSave}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#4a6366] outline-none hover:bg-[#f7f9f7] hover:text-[#075B5C] focus-visible:ring-2 focus-visible:ring-[#55ddb1] disabled:opacity-40"
      >
        <Bookmark
          className={`h-4 w-4 ${isSaved ? 'fill-[#075B5C] text-[#075B5C]' : ''}`}
          aria-hidden
        />
        <span className="sr-only">{isSaving ? 'Saving' : isSaved ? 'Saved' : 'Save'}</span>
      </button>
      <button
        type="button"
        aria-label={isOnParlay ? 'Added to parlay' : 'Add to parlay'}
        aria-pressed={isOnParlay}
        data-coachmark="props-add-parlay"
        onClick={onParlay}
        className={`type-interactive inline-flex h-8 items-center rounded-lg px-2 outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1] ${
          isOnParlay
            ? 'border border-[#075B5C] bg-[#F8FBFA] text-[#075B5C]'
            : 'bg-[#55ddb1] text-[#063f46]'
        }`}
      >
        {isOnParlay ? 'Added' : '+ Parlay'}
      </button>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="More actions"
            data-coachmark="props-compare"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#4a6366] outline-none hover:bg-[#f7f9f7] hover:text-[#063f46] focus-visible:ring-2 focus-visible:ring-[#55ddb1]"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={6}
            align="end"
            className="z-[300] min-w-[12.5rem] rounded-xl border border-[#DCE9EA] bg-white p-1 shadow-xl"
          >
            <DropdownMenu.Item className={itemClass} onSelect={onCompare}>
              Compare Sportsbooks
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={itemClass}
              disabled={paperDisabled}
              onSelect={onPaper}
              title={
                paperDisabled && !isAddingPaper
                  ? 'Paper bets cannot be placed on completed historical games'
                  : 'Add to paper bets'
              }
            >
              {isAddingPaper ? 'Adding…' : 'Add to Paper'}
            </DropdownMenu.Item>
            <DropdownMenu.Item className={itemClass} asChild>
              <Link href={profileHref}>View Player Profile</Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={itemClass} onSelect={onPlayerContext}>
              Player context
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
