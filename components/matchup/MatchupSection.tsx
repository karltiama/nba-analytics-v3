import type { HTMLAttributes, ReactNode } from 'react';

const scrollMargin = { scrollMarginTop: 'var(--matchup-scroll-offset, 9rem)' } as const;

type Props = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  id?: string;
  headingId: string;
  title: ReactNode;
  /** Small text beside the heading, such as a sample label. */
  aside?: ReactNode;
  /** Flow sections sit in one shared surface, split by dividers. Cards stand alone. */
  flow?: boolean;
  bodyClassName?: string;
  children: ReactNode;
};

/** One matchup section, as a standalone card or as a divided block inside a shared surface. */
export function MatchupSection({ id, headingId, title, aside, flow = false, bodyClassName = '', children, ...rest }: Props) {
  if (flow) {
    return (
      <section
        id={id}
        className="min-w-0 border-t border-[#DCE9EA] py-6 first:border-t-0 first:pt-0 last:pb-0"
        style={scrollMargin}
        aria-labelledby={headingId}
        data-section-layout="flow"
        {...rest}
      >
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id={headingId} className="type-section-heading text-[#063f46]">
            {title}
          </h2>
          {aside ? <span className="type-metadata">{aside}</span> : null}
        </div>
        <div className={bodyClassName}>{children}</div>
      </section>
    );
  }
  return (
    <section
      id={id}
      className="min-w-0 overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm"
      style={scrollMargin}
      aria-labelledby={headingId}
      {...rest}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
        <h2 id={headingId} className="type-section-heading text-[#063f46]">
          {title}
        </h2>
        {aside ? <span className="type-metadata">{aside}</span> : null}
      </div>
      <div className={`p-3 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
