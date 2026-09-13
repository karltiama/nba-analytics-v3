import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type LandingSectionProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  'aria-labelledby'?: string;
};

/** Shared landing section shell. Vertical rhythm lives on the page column. */
export function LandingSection({
  children,
  className,
  style,
  'aria-labelledby': ariaLabelledBy,
}: LandingSectionProps) {
  return (
    <section
      className={cn('w-full max-w-6xl mx-auto min-w-0', className)}
      style={style}
      aria-labelledby={ariaLabelledBy}
    >
      {children}
    </section>
  );
}
