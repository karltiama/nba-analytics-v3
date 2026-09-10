'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ContextCheckCardViewModel } from '@/lib/content/context-check/view-model';
import type { ContextVerdictType, PlayerVisualKind } from '@/lib/content/context-check/types';
import {
  DEFAULT_INSTAGRAM_TYPE_VARIANT,
  type InstagramTypeVariantId,
} from '@/lib/content/context-check/instagram-type';
import { instagramFontVariableClassName } from '@/components/content/context-check/instagram-fonts';
import '@/components/content/context-check/instagram-type.css';

const VERDICT_ACCENT: Record<ContextVerdictType, string> = {
  supports: 'text-[#7EF0D0]',
  mixed: 'text-[#F3C57A]',
  pushes_back: 'text-white',
  insufficient: 'text-white/70',
};

const VERDICT_PANEL: Record<ContextVerdictType, string> = {
  supports: 'border-[#7EF0D0]/35 bg-[#7EF0D0]/10',
  mixed: 'border-[#F3C57A]/35 bg-[#F3C57A]/10',
  pushes_back: 'border-white/20 bg-white/8',
  insufficient: 'border-white/15 bg-white/5',
};

function nextVisualKind(
  current: PlayerVisualKind,
  headshotUrl?: string
): PlayerVisualKind {
  if (current === 'hero' && headshotUrl) return 'headshot';
  return 'fallback';
}

function InstagramHero({
  vm,
}: {
  vm: ContextCheckCardViewModel;
}) {
  const [kind, setKind] = useState<PlayerVisualKind>(vm.visual.kind);

  useEffect(() => {
    setKind(vm.visual.kind);
  }, [vm.visual.kind, vm.heroImageUrl, vm.headshotUrl]);
  const src = useMemo(() => {
    if (kind === 'hero') return vm.heroImageUrl;
    if (kind === 'headshot') return vm.headshotUrl;
    return undefined;
  }, [kind, vm.heroImageUrl, vm.headshotUrl]);

  return (
    <div
      className="pointer-events-none absolute inset-y-0 -right-[8%] w-[62%] select-none"
      data-visual-kind={kind}
      aria-hidden="true"
    >
      <div className="absolute left-[8%] top-[18%] h-[58%] w-[58%] rounded-full border border-[#7EF0D0]/15" />
      <div className="absolute left-[18%] top-[26%] h-[42%] w-[42%] rounded-full border border-[#7EF0D0]/10" />
      <div className="absolute right-[12%] top-[22%] h-40 w-40 rounded-full bg-[#7EF0D0]/10 blur-3xl" />

      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          onError={() => setKind((prev) => nextVisualKind(prev, vm.headshotUrl))}
          className="absolute inset-0 h-full w-full object-cover object-[center_12%]"
        />
      ) : (
        <div className="absolute inset-y-[18%] right-[8%] flex w-[70%] items-center justify-center">
          <div className="flex h-36 w-36 items-center justify-center rounded-full border border-[#7EF0D0]/30 bg-[#0b2f2a] text-4xl font-semibold text-[#7EF0D0] shadow-[0_0_40px_rgba(126,240,208,0.18)] cc-ig-display">
            {vm.playerInitials}
          </div>
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-r from-[#041512] via-[#041512]/72 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#041512] to-transparent" />
    </div>
  );
}

function CompactStats({ rows }: { rows: { label: string; value: string; detail?: string }[] }) {
  return (
    <dl className="space-y-1">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[6.1rem_minmax(0,1fr)_auto] items-baseline gap-2 text-[11px] leading-none">
          <dt className="cc-ig-stat-label truncate uppercase text-white/55">{row.label}</dt>
          <dd className="cc-ig-nums text-white">{row.value}</dd>
          {row.detail ? <dd className="cc-ig-nums text-[#7EF0D0]">{row.detail}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

export function ContextCheckInstagramCard({
  vm,
  className,
  typeVariant = DEFAULT_INSTAGRAM_TYPE_VARIANT,
}: {
  vm: ContextCheckCardViewModel;
  className?: string;
  typeVariant?: InstagramTypeVariantId;
}) {
  return (
    <article
      data-testid="context-check-card"
      data-variant="social"
      data-ig-type={typeVariant}
      aria-label={`Context Check for ${vm.playerName}: ${vm.marketClaim}`}
      className={cn(
        instagramFontVariableClassName,
        'cc-ig-card relative isolate aspect-[4/5] w-full max-w-[432px] overflow-hidden text-white',
        className
      )}
      style={{
        background:
          'linear-gradient(165deg, #062822 0%, #041512 42%, #03110f 72%, #020c0b 100%)',
      }}
    >
      <div className="pointer-events-none absolute -left-16 top-10 h-48 w-48 rounded-full bg-[#7EF0D0]/8 blur-3xl" />
      <InstagramHero vm={vm} />

      <div className="relative z-10 flex h-full min-h-0 flex-col px-5 pb-4 pt-5 sm:px-6">
        <header className="max-w-[68%]">
          <p className="cc-ig-label text-[10px] uppercase text-[#7EF0D0]">{vm.brandKicker}</p>
          <p className="cc-ig-series mt-1 text-[11px] uppercase text-white/60">{vm.brandTitle}</p>
        </header>

        <div className="mt-3 max-w-[66%]">
          <h2 className="cc-ig-display break-words text-[1.4rem] uppercase leading-[0.95] sm:text-[1.65rem]">
            {vm.playerName}
          </h2>
          <p className="cc-ig-market mt-1.5 text-sm text-[#7EF0D0]">{vm.marketClaim}</p>
        </div>

        <section className="mt-3 max-w-[66%]">
          <p className="cc-ig-label text-[10px] uppercase text-white/50">{vm.headlineKicker}</p>
          <p className="cc-ig-display mt-1 text-base uppercase leading-tight sm:text-lg">
            {vm.headlineText}
          </p>
          <p className="cc-ig-pct mt-1 text-[1.75rem] leading-none text-[#7EF0D0] sm:text-[2rem]">
            {vm.headlineRate}
            <span className="cc-ig-nums ml-2 align-middle text-sm font-normal text-white/55">
              {vm.headlineFraction}
            </span>
          </p>
        </section>

        {vm.sampleRows.length > 0 && (
          <section className="mt-3 max-w-[66%]">
            <p className="cc-ig-label mb-1.5 text-[10px] uppercase text-white/50">Zoom Out</p>
            <CompactStats rows={vm.sampleRows} />
          </section>
        )}

        {vm.primaryContext && (
          <section className="mt-3 max-w-[66%]">
            <p className="cc-ig-label mb-1.5 text-[10px] uppercase text-white/50">
              {vm.primaryContext.title}
            </p>
            <CompactStats rows={vm.primaryContext.rows} />
          </section>
        )}

        <section className={cn('mt-auto rounded-xl border px-3 py-2.5', VERDICT_PANEL[vm.verdictType])}>
          <p className="cc-ig-label text-[10px] uppercase text-white/55">Context Verdict</p>
          <p className={cn('cc-ig-display mt-1 text-sm uppercase', VERDICT_ACCENT[vm.verdictType])}>
            {vm.verdictLabel}
          </p>
          <p className="cc-ig-body mt-1 line-clamp-3 text-[13px] leading-snug text-white/80">
            {vm.verdictExplanation}
          </p>
        </section>

        <footer className="cc-ig-footer mt-3 flex items-center justify-between text-[10px] uppercase text-white/40">
          <span>{vm.footerBrand}</span>
          <span>{vm.footerTagline}</span>
        </footer>
      </div>
    </article>
  );
}
