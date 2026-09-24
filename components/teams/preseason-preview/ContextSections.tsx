import Link from 'next/link';
import { ArrowRight, Lightbulb } from 'lucide-react';
import { PreviewCard, PreviewSectionHeading } from './PreviewCard';
import type { PreviewWowyContextItem } from '@/lib/teams/preseason-preview/types';

export function WowyContextSection({
  items,
  outlook,
}: {
  items: PreviewWowyContextItem[];
  outlook?: string | null;
}) {
  return (
    <PreviewCard id="wowy-context" className="scroll-mt-24">
      <PreviewSectionHeading
        title="Context to Watch"
        subtitle="Historical with/without framing — not a causal model"
        icon={Lightbulb}
      />

      {items.length > 0 ? (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.title} className="border-b border-[#DCE9EA] last:border-0 pb-4 last:pb-0">
              <p className="type-card-data text-[#063f46]">{item.title}</p>
              <p className="type-body text-cc-secondary mt-1">
                {item.detail}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#4a6366]">
          Historical lineup context is still being evaluated.
        </p>
      )}

      <p className="type-secondary mt-4">
        Historical with/without results describe what occurred in previous games
        and do not guarantee the same effect in a new lineup.
      </p>

      <Link
        href="/wowy"
        className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#075B5C] hover:text-[#063f46]"
      >
        Open WOWY explorer
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>

      {outlook ? (
        <OutlookSection outlook={outlook} variant="embedded" />
      ) : null}
    </PreviewCard>
  );
}

export function ScheduleSection({
  schedule,
  unavailableReason,
  teamScheduleHref,
}: {
  schedule: {
    dateLabel: string;
    opponentAbbr: string;
    isHome: boolean;
    timeLabel: string | null;
    href: string | null;
  }[];
  unavailableReason: string | null;
  teamScheduleHref: string;
}) {
  return (
    <PreviewCard>
      <PreviewSectionHeading
        title="Upcoming Schedule"
        subtitle="Secondary to context — shown when available"
      />

      {schedule.length > 0 ? (
        <>
          <ul className="space-y-2">
            {schedule.map((g) => {
              const matchup = g.isHome
                ? `vs ${g.opponentAbbr}`
                : `@ ${g.opponentAbbr}`;
              const inner = (
                <>
                  <span className="text-xs text-[#4a6366] w-14 shrink-0">
                    {g.dateLabel}
                  </span>
                  <span className="text-sm font-medium text-[#063f46] flex-1">
                    {matchup}
                  </span>
                  <span className="type-metadata tabular-nums">
                    {g.timeLabel ?? 'TBD'}
                  </span>
                </>
              );
              return (
                <li key={`${g.dateLabel}-${g.opponentAbbr}-${g.isHome}`}>
                  {g.href ? (
                    <Link
                      href={g.href}
                      className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-[#f7f9f7] transition-colors"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2 px-2 py-2">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <Link
            href={teamScheduleHref}
            className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#075B5C] hover:text-[#063f46]"
          >
            View full schedule
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </>
      ) : (
        <p className="text-sm text-[#4a6366]">
          {unavailableReason ??
            'Preseason schedule not available yet for this season.'}
        </p>
      )}
    </PreviewCard>
  );
}

export function OutlookSection({
  outlook,
  variant = 'card',
}: {
  outlook: string;
  /** `embedded` nests under another card (e.g. WOWY Context) without extra chrome. */
  variant?: 'card' | 'embedded';
}) {
  const body = (
    <>
      <PreviewSectionHeading title="Court Context Outlook" icon={Lightbulb} />
      <p className="type-body text-cc-secondary">
        {outlook}
      </p>
      <p className="type-metadata mt-3">
        Editorial analysis — not a numerical prediction or model output.
      </p>
    </>
  );

  if (variant === 'embedded') {
    return (
      <div id="outlook" className="mt-5 pt-5 border-t border-[#DCE9EA] scroll-mt-24">
        {body}
      </div>
    );
  }

  return (
    <PreviewCard id="outlook" className="scroll-mt-24 relative overflow-hidden">
      <div className="relative z-10 max-w-3xl">{body}</div>
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 bottom-0 h-24 w-40 opacity-[0.12] bg-[radial-gradient(ellipse_at_bottom_right,#55ddb1,transparent_70%)]"
      />
    </PreviewCard>
  );
}
