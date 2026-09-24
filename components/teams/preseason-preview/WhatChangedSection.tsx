import { Minus, Plus, Sparkles } from 'lucide-react';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
import { PreviewCard, PreviewSectionHeading } from './PreviewCard';
import type { PreviewRosterChange } from '@/lib/teams/preseason-preview/types';
import { cn } from '@/lib/utils';

function ChangeColumn({
  title,
  icon: Icon,
  tone,
  players,
}: {
  title: string;
  icon: typeof Plus;
  tone: 'add' | 'leave' | 'draft';
  players: PreviewRosterChange[];
}) {
  if (players.length === 0) return null;

  const toneClass =
    tone === 'add'
      ? 'bg-[#55ddb1]/25 text-[#075B5C]'
      : tone === 'leave'
        ? 'bg-red-50 text-red-700/80'
        : 'bg-[#E8F0F1] text-[#4a6366]';

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full',
            toneClass
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
        </span>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#063f46]">
          {title}
        </h3>
      </div>
      <ul className="space-y-3">
        {players.map((p) => (
          <li key={`${title}-${p.name}`} className="flex gap-2.5">
            <PlayerHeadshot
              nbaPlayerId={p.nbaPlayerId}
              name={p.name}
              className="relative w-12 h-14 rounded-lg overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#063f46] truncate">
                {p.name}
              </p>
              {p.position ? (
                <p className="type-metadata">
                  {p.position}
                </p>
              ) : null}
              <p className="text-xs text-[#4a6366] leading-snug mt-0.5">
                {p.context}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WhatChangedSection({
  additions,
  departures,
  draftPicks,
  variant = 'card',
}: {
  additions: PreviewRosterChange[];
  departures: PreviewRosterChange[];
  draftPicks: PreviewRosterChange[];
  /** `embedded` nests under another card (e.g. Big Picture) without extra chrome. */
  variant?: 'card' | 'embedded';
}) {
  const hasAny =
    additions.length > 0 || departures.length > 0 || draftPicks.length > 0;
  if (!hasAny) return null;

  const body = (
    <>
      <PreviewSectionHeading
        title="What Changed"
        subtitle="Key roster moves and draft picks — editorial framing"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
        <ChangeColumn
          title="Key Additions"
          icon={Plus}
          tone="add"
          players={additions}
        />
        <ChangeColumn
          title="Key Departures"
          icon={Minus}
          tone="leave"
          players={departures}
        />
        <ChangeColumn
          title="Draft Picks"
          icon={Sparkles}
          tone="draft"
          players={draftPicks}
        />
      </div>
    </>
  );

  if (variant === 'embedded') {
    return (
      <div id="roster-changes" className="mt-5 pt-5 border-t border-[#DCE9EA] scroll-mt-24">
        {body}
      </div>
    );
  }

  return (
    <PreviewCard id="roster-changes" className="scroll-mt-24">
      {body}
    </PreviewCard>
  );
}
