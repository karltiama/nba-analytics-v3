import type { ReactNode } from 'react';

export function LabCard({
  title,
  children,
  badge,
}: {
  title: string;
  children: ReactNode;
  badge?: string;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {badge ? (
          <span className="text-[11px] tracking-wide text-muted-foreground">{badge}</span>
        ) : null}
      </header>
      {children}
    </section>
  );
}
