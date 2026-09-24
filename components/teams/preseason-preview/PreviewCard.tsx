import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

/** Shared Court Context card chrome used across team preview sections. */
export function PreviewCard({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        'bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-4 sm:p-5',
        className
      )}
    >
      {children}
    </section>
  );
}

export function PreviewSectionHeading({
  title,
  icon: Icon,
  subtitle,
}: {
  title: string;
  icon?: LucideIcon;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 mb-3">
      {Icon ? (
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#55ddb1]/25">
          <Icon className="h-3.5 w-3.5 text-[#075B5C]" strokeWidth={2} aria-hidden />
        </span>
      ) : null}
      <div className="min-w-0">
        <h2 className="type-section-heading text-[#063f46]">
          {title}
        </h2>
        {subtitle ? (
          <p className="type-metadata mt-0.5">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}
