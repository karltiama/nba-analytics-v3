'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { toContextCheckCardViewModel } from '@/lib/content/context-check/view-model';
import type { ContextCheckCardViewModel } from '@/lib/content/context-check/view-model';
import type {
  ContextCheckCardVariant,
  ContextCheckData,
  ContextVerdictType,
} from '@/lib/content/context-check/types';
import type { InstagramTypeVariantId } from '@/lib/content/context-check/instagram-type';
import { ContextCheckInstagramCard } from '@/components/content/context-check/ContextCheckInstagramCard';

const VERDICT_SURFACE: Record<ContextVerdictType, string> = {
  supports: 'border-neon-cyan/40 bg-neon-cyan/10',
  mixed: 'border-neon-orange/40 bg-neon-orange/10',
  pushes_back: 'border-white/20 bg-white/5',
  insufficient: 'border-white/15 bg-white/[0.03]',
};

const VERDICT_TEXT: Record<ContextVerdictType, string> = {
  supports: 'text-neon-cyan',
  mixed: 'text-neon-orange',
  pushes_back: 'text-foreground',
  insufficient: 'text-muted-foreground',
};

function PlayerMark({
  initials,
  src,
  compact,
}: {
  initials: string;
  src?: string;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const size = compact ? 'h-16 w-16 text-lg' : 'h-20 w-20 sm:h-24 sm:w-24 text-xl sm:text-2xl';

  if (!src || failed) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full border border-neon-cyan/30 bg-secondary font-semibold tracking-wide text-neon-cyan',
          size
        )}
      >
        {initials}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-full object-cover border border-neon-cyan/30 bg-secondary', size)}
    />
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </h3>
  );
}

function StatGrid({
  rows,
  compact,
}: {
  rows: { label: string; value: string; detail?: string }[];
  compact?: boolean;
}) {
  return (
    <dl className="space-y-1.5">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[minmax(0,1.2fr)_auto_auto] items-baseline gap-3 text-sm"
        >
          <dt className="truncate text-muted-foreground">{row.label}</dt>
          <dd className={cn('font-mono tabular-nums text-foreground', compact ? 'text-sm' : 'text-sm')}>
            {row.value}
          </dd>
          {row.detail ? (
            <dd className="min-w-[3.25rem] text-right font-mono tabular-nums text-foreground">
              {row.detail}
            </dd>
          ) : (
            <dd />
          )}
        </div>
      ))}
    </dl>
  );
}

function CardBody({
  vm,
  compact,
}: {
  vm: ContextCheckCardViewModel;
  compact: boolean;
}) {
  return (
    <>
      <header className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-neon-cyan">
          {vm.brandKicker}
        </p>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {vm.brandTitle}
        </p>
      </header>

      <div className={cn('flex items-center gap-4', compact ? 'mt-4' : 'mt-5')}>
        <PlayerMark initials={vm.playerInitials} src={vm.headshotUrl ?? vm.heroImageUrl} compact={compact} />
        <div className="min-w-0 space-y-1">
          <h2
            className={cn(
              'break-words font-semibold uppercase leading-tight tracking-wide text-foreground',
              compact ? 'text-lg' : 'text-xl sm:text-2xl'
            )}
          >
            {vm.playerName}
          </h2>
          <p className="text-sm text-muted-foreground">
            {vm.playerTeam ? `${vm.playerTeam} · ` : ''}
            {vm.marketClaim}
          </p>
        </div>
      </div>

      <section className={cn('rounded-lg border border-white/10 bg-white/[0.03]', compact ? 'mt-4 p-3' : 'mt-5 p-4')}>
        <SectionLabel>{vm.headlineKicker}</SectionLabel>
        <p className={cn('mt-2 font-semibold uppercase tracking-wide text-foreground', compact ? 'text-base' : 'text-lg')}>
          {vm.headlineText}
        </p>
        <p className="mt-1 font-mono text-2xl tabular-nums text-neon-cyan sm:text-3xl">
          {vm.headlineRate}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {vm.headlineFraction}
          </span>
        </p>
      </section>

      {vm.sampleRows.length > 0 && (
        <section className={compact ? 'mt-4' : 'mt-5'}>
          <SectionLabel>Zoom Out</SectionLabel>
          <div className="mt-2">
            <StatGrid rows={vm.sampleRows} compact={compact} />
          </div>
        </section>
      )}

      {vm.lineContextRows && (
        <section className={compact ? 'mt-4' : 'mt-5'}>
          <SectionLabel>Line Context</SectionLabel>
          <div className="mt-2">
            <StatGrid rows={vm.lineContextRows} compact={compact} />
          </div>
        </section>
      )}

      {vm.roleContextRows && (
        <section className={compact ? 'mt-4' : 'mt-5'}>
          <SectionLabel>Role Context</SectionLabel>
          <div className="mt-2">
            <StatGrid rows={vm.roleContextRows} compact={compact} />
          </div>
        </section>
      )}

      <section
        className={cn(
          'rounded-lg border p-3 sm:p-4',
          compact ? 'mt-4' : 'mt-5',
          VERDICT_SURFACE[vm.verdictType]
        )}
      >
        <SectionLabel>Context Verdict</SectionLabel>
        <p
          className={cn(
            'mt-2 text-sm font-semibold uppercase tracking-[0.16em]',
            VERDICT_TEXT[vm.verdictType]
          )}
        >
          {vm.verdictLabel}
        </p>
        <p className="mt-1 text-sm font-medium text-foreground">{vm.verdictTitle}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{vm.verdictExplanation}</p>
      </section>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{vm.contextTypeLabel}</span>
        <span>As of {vm.dataAsOfLabel}</span>
      </footer>
    </>
  );
}

export interface ContextCheckCardProps {
  data: ContextCheckData;
  variant?: ContextCheckCardVariant;
  className?: string;
  typeVariant?: InstagramTypeVariantId;
}

/**
 * Presentation-only Context Check. Receives a normalized ContextCheckData
 * object and never queries a database.
 */
export function ContextCheckCard({
  data,
  variant = 'web',
  className,
  typeVariant,
}: ContextCheckCardProps) {
  const vm = toContextCheckCardViewModel(data, variant);

  if (variant === 'social') {
    return (
      <ContextCheckInstagramCard vm={vm} className={className} typeVariant={typeVariant} />
    );
  }

  return (
    <article
      data-testid="context-check-card"
      data-variant="web"
      aria-label={`Context Check for ${vm.playerName}: ${vm.marketClaim}`}
      className={cn('glass-card w-full max-w-xl p-5 text-card-foreground sm:p-6', className)}
    >
      <CardBody vm={vm} compact={false} />
    </article>
  );
}
