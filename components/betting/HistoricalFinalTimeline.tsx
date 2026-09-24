'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { NormalizedTimelineEvent } from '@/lib/betting/historical-timeline';
import { shouldShowHistoricalTimeline } from '@/lib/betting/historical-timeline';
import {
  HISTORICAL_TIMELINE_VIEW_DEFAULT,
  HISTORICAL_TIMELINE_VIEW_FULL,
  HISTORICAL_TIMELINE_VIEW_KEY,
  TIMELINE_CATEGORY_LABEL,
  TIMELINE_SCORE_MISMATCH_COPY,
  TIMELINE_UNAVAILABLE_COPY,
  formatTimelineClock,
  formatTimelineRunningScore,
  gameFlowSummaryItems,
  shouldShowTimelineMismatchWarning,
  shouldShowTimelineScoreSummary,
  timelineEventHeadline,
  timelineTeamAbbr,
  type HistoricalTimelinePayload,
  type HistoricalTimelineView,
} from '@/lib/betting/historical-timeline-format';
import type { HistoricalModuleAvailability } from '@/lib/betting/historical-final';

function EventRow({
  event,
  homeTeamId,
  awayTeamId,
  homeAbbr,
  awayAbbr,
}: {
  event: NormalizedTimelineEvent;
  homeTeamId: string;
  awayTeamId: string;
  homeAbbr: string;
  awayAbbr: string;
}) {
  const team = timelineTeamAbbr(event.teamId, homeTeamId, awayTeamId, homeAbbr, awayAbbr);
  const score = formatTimelineRunningScore(event.scoreHome, event.scoreAway);
  const headline = timelineEventHeadline(event);
  const category = TIMELINE_CATEGORY_LABEL[event.category];
  const scoring = event.category === 'scoring' || (event.scoringPlay && event.category === 'free_throw');
  const periodBoundary = event.category === 'period';

  return (
    <li className="min-w-0 py-2 border-t border-[#DCE9EA] first:border-t-0">
      <div className="flex gap-2 sm:gap-3 min-w-0 items-start">
        <span
          className="type-metadata w-[3.25rem] shrink-0 pt-0.5 text-right font-mono tabular-nums sm:w-14"
          aria-label={event.clock ? `Clock ${event.clock}` : undefined}
        >
          {formatTimelineClock(event.clock) || '—'}
        </span>
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
            periodBoundary ? 'bg-[#063f46]' : scoring ? 'bg-[#075B5C]' : 'bg-[#DCE9EA]'
          }`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="type-metadata">{category}</span>
            {team ? (
              <span className="type-secondary">{team}</span>
            ) : null}
            {score ? (
              <span className="type-table-data ml-auto whitespace-nowrap font-mono tabular-nums text-[#063f46]">
                {score}
              </span>
            ) : null}
          </div>
          <p
            className={`type-secondary break-words ${
              periodBoundary ? 'font-semibold text-[#063f46]' : 'text-[#063f46]'
            }`}
          >
            {headline}
          </p>
        </div>
      </div>
    </li>
  );
}

function EventList({
  events,
  homeTeamId,
  awayTeamId,
  homeAbbr,
  awayAbbr,
}: {
  events: NormalizedTimelineEvent[];
  homeTeamId: string;
  awayTeamId: string;
  homeAbbr: string;
  awayAbbr: string;
}) {
  const blocks: { periodLabel: string; events: NormalizedTimelineEvent[] }[] = [];
  for (const event of events) {
    const label = event.periodLabel || 'Play-by-play';
    const last = blocks[blocks.length - 1];
    if (!last || last.periodLabel !== label) blocks.push({ periodLabel: label, events: [event] });
    else last.events.push(event);
  }

  return (
    <div className="min-w-0">
      {blocks.map((block) => (
        <section key={block.periodLabel} className="min-w-0">
          <h3 className="type-section-heading sticky top-0 z-[1] border-b border-[#DCE9EA] bg-white/95 px-1 py-1.5 text-[#063f46] backdrop-blur-sm">
            {block.periodLabel}
          </h3>
          <ol className="min-w-0">
            {block.events.map((event) => (
              <EventRow
                key={`${event.gameId}-${event.order}`}
                event={event}
                homeTeamId={homeTeamId}
                awayTeamId={awayTeamId}
                homeAbbr={homeAbbr}
                awayAbbr={awayAbbr}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function HistoricalFinalTimeline({
  gameId,
  availability,
  homeTeamId,
  awayTeamId,
  homeAbbr,
  awayAbbr,
  officialHomeScore,
  officialAwayScore,
  loadNow = false,
}: {
  gameId: string;
  availability?: HistoricalModuleAvailability | null;
  homeTeamId: string;
  awayTeamId: string;
  homeAbbr: string;
  awayAbbr: string;
  officialHomeScore?: number | null;
  officialAwayScore?: number | null;
  loadNow?: boolean;
}) {
  const show = shouldShowHistoricalTimeline(availability);
  const [view, setView] = useState<HistoricalTimelineView>(HISTORICAL_TIMELINE_VIEW_DEFAULT);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [payload, setPayload] = useState<HistoricalTimelinePayload | null>(null);
  const fetched = useRef(false);
  const rootRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    if (fetched.current) return;
    fetched.current = true;
    setStatus('loading');
    try {
      const res = await fetch(`/api/betting/games/${encodeURIComponent(gameId)}/timeline`);
      const body = (await res.json().catch(() => null)) as HistoricalTimelinePayload | null;
      if (!res.ok || !body) {
        setStatus('error');
        return;
      }
      setPayload(body);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [gameId]);

  useEffect(() => {
    if (!show) return;
    if (loadNow) void load();
  }, [show, loadNow, load]);

  useEffect(() => {
    if (!show || fetched.current) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load();
      },
      { rootMargin: '240px 0px', threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [show, load]);

  if (!show) return null;

  const quality = payload?.quality;
  const showSummary = shouldShowTimelineScoreSummary(quality);
  const showWarning = shouldShowTimelineMismatchWarning(quality);
  const summaryItems = showSummary
    ? gameFlowSummaryItems(payload?.gameFlow, homeAbbr, awayAbbr)
    : [];
  const timelineOff =
    status === 'ready' && payload != null && payload.available === false;

  return (
    <section
      ref={rootRef}
      id="section-timeline"
      className="scroll-mt-[10rem] bg-white rounded-2xl overflow-hidden border border-[#DCE9EA] shadow-sm min-w-0"
      aria-labelledby="timeline-heading"
    >
      <div className="px-3 py-2 border-b border-[#DCE9EA] bg-[#F8FBFA]">
        <p className="type-metadata">Timeline</p>
        <h2 id="timeline-heading" className="type-section-heading text-[#063f46]">
          Game chronology
        </h2>
        <p className="type-body mt-1 text-cc-secondary">
          Play-by-play order. Official final stays in the header
          {showWarning && officialAwayScore != null && officialHomeScore != null
            ? ` (${officialAwayScore}–${officialHomeScore})`
            : ''}
          .
        </p>
      </div>

      <div className="p-3 space-y-3 min-w-0 min-h-[6rem]">
        {status === 'idle' || status === 'loading' ? (
          <p className="type-secondary" role="status">
            Loading play-by-play…
          </p>
        ) : null}

        {status === 'error' || timelineOff ? (
          <p className="type-secondary" role="status">
            {TIMELINE_UNAVAILABLE_COPY}
          </p>
        ) : null}

        {status === 'ready' && payload?.available ? (
          <>
            {showWarning ? (
              <p
                className="type-body rounded-lg border border-amber-200/20 bg-amber-200/5 px-3 py-2 text-amber-800"
                role="note"
              >
                {TIMELINE_SCORE_MISMATCH_COPY}
              </p>
            ) : null}

            {summaryItems.length > 0 ? (
              <dl className="grid grid-cols-2 gap-2">
                {summaryItems.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2 min-w-0"
                  >
                    <dt className="type-metadata">
                      {item.label}
                    </dt>
                    <dd className="type-card-data break-words font-mono tabular-nums text-[#063f46]">{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <Tabs
              value={view}
              onValueChange={(next) => {
                if (next === HISTORICAL_TIMELINE_VIEW_KEY || next === HISTORICAL_TIMELINE_VIEW_FULL) {
                  setView(next);
                }
              }}
              className="gap-3 min-w-0"
            >
              <TabsList
                aria-label="Timeline view"
                className="h-8 w-full sm:w-fit max-w-full bg-white border border-[#DCE9EA]"
              >
                <TabsTrigger
                  value={HISTORICAL_TIMELINE_VIEW_KEY}
                  className="type-interactive flex-1 px-3 text-cc-secondary data-[state=active]:bg-[#063f46]! data-[state=active]:text-white! sm:flex-none"
                >
                  Key Events
                </TabsTrigger>
                <TabsTrigger
                  value={HISTORICAL_TIMELINE_VIEW_FULL}
                  className="type-interactive flex-1 px-3 text-cc-secondary data-[state=active]:bg-[#063f46]! data-[state=active]:text-white! sm:flex-none"
                >
                  Full Play-by-Play
                </TabsTrigger>
              </TabsList>
              <TabsContent value={HISTORICAL_TIMELINE_VIEW_KEY} className="mt-0 min-w-0">
                <EventList
                  events={payload.keyEvents}
                  homeTeamId={homeTeamId}
                  awayTeamId={awayTeamId}
                  homeAbbr={homeAbbr}
                  awayAbbr={awayAbbr}
                />
              </TabsContent>
              <TabsContent value={HISTORICAL_TIMELINE_VIEW_FULL} className="mt-0 min-w-0">
                {view === HISTORICAL_TIMELINE_VIEW_FULL ? (
                  <EventList
                    events={payload.events}
                    homeTeamId={homeTeamId}
                    awayTeamId={awayTeamId}
                    homeAbbr={homeAbbr}
                    awayAbbr={awayAbbr}
                  />
                ) : null}
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </div>
    </section>
  );
}
