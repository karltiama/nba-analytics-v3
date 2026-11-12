'use client';

import type { ReactNode } from 'react';
import { WorkspaceTrueCost } from '@/components/parlay/WorkspaceTrueCost';
import type { SelectedParlayLeg } from '@/lib/parlay/selection';

/**
 * Right rail: what the ticket is, what it costs, and what you can do with it.
 * Sticky beside the legs on desktop. On phones the actions become a bottom bar.
 */
export function WorkspaceTicketRail({
  legs,
  book,
  totalOddsLabel,
  impliedLabel,
  actions,
  children,
}: {
  legs: SelectedParlayLeg[];
  book: string;
  totalOddsLabel: string;
  impliedLabel: string | null;
  /** Share / post controls. Omit when the ticket cannot be shared. */
  actions?: ReactNode;
  /** Extra rail content under True cost. */
  children?: ReactNode;
}) {
  const legCount = legs.length;
  return (
    <aside
      className="min-w-0 space-y-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
      aria-label="Ticket"
    >
      <section className="rounded-2xl border border-[#DCE9EA] bg-white p-3 shadow-sm sm:p-4" aria-labelledby="ticket-heading">
        <h2 id="ticket-heading" className="type-section-heading text-[#063f46]">
          Ticket
        </h2>
        <p className="type-card-data mt-1 text-[#063f46]">
          {legCount} {legCount === 1 ? 'Leg' : 'Legs'}
          {book !== '—' ? ` — ${book}` : ''}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] px-3 py-2">
            <dt className="type-metadata">Total odds</dt>
            <dd className="type-card-data text-[#063f46]">{totalOddsLabel}</dd>
          </div>
          <div className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] px-3 py-2">
            <dt className="type-metadata">Implied probability</dt>
            <dd className="type-card-data text-[#063f46]">{impliedLabel ?? '—'}</dd>
          </div>
        </dl>
        {actions ? (
          <div
            className="fixed inset-x-0 bottom-0 z-40 border-t border-[#DCE9EA] bg-white/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_12px_rgba(6,63,70,0.08)] lg:static lg:z-auto lg:mt-3 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
            data-workspace-ticket-actions
          >
            <div className="mx-auto flex max-w-xl items-center gap-2 lg:max-w-none">
              <p className="type-card-data min-w-0 flex-1 truncate text-[#063f46] lg:hidden">
                {legCount} {legCount === 1 ? 'leg' : 'legs'} · {totalOddsLabel}
              </p>
              <div className="flex shrink-0 gap-2 lg:w-full lg:[&>*]:flex-1">{actions}</div>
            </div>
          </div>
        ) : null}
      </section>
      <WorkspaceTrueCost legs={legs} layout="rail" />
      {children}
    </aside>
  );
}
