import { ArrowRight, type LucideIcon } from 'lucide-react';
import { LandingTrackedLink } from '@/components/landing/LandingTrackedLink';
import type { LandingCtaAction } from '@/lib/product-analytics/track-event';
import { cn } from '@/lib/utils';

const ACCENT_BOX: Record<'lime' | 'cyan' | 'orange', string> = {
  lime: 'bg-[#39ff14]/10 border-[#39ff14]/30',
  cyan: 'bg-[#00d4ff]/10 border-[#00d4ff]/30',
  orange: 'bg-[#ff6b35]/10 border-[#ff6b35]/30',
};

const ACCENT_ICON: Record<'lime' | 'cyan' | 'orange', string> = {
  lime: 'text-[#39ff14]',
  cyan: 'text-[#00d4ff]',
  orange: 'text-[#ff6b35]',
};

export type LandingSectionAccent = keyof typeof ACCENT_BOX;

type LandingSectionHeaderProps = {
  id?: string;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  action: LandingCtaAction;
  icon: LucideIcon;
  accent: LandingSectionAccent;
  /** Giant faded title that sits in the section background. */
  variant?: 'default' | 'watermark';
};

export function LandingSectionHeader({
  id,
  title,
  description,
  href,
  linkLabel,
  action,
  icon: Icon,
  accent,
  variant = 'default',
}: LandingSectionHeaderProps) {
  if (variant === 'watermark') {
    return (
      <div className="relative mb-4 md:mb-6 lg:mb-8">
        <h2
          id={id}
          className="font-display font-extrabold tracking-tight text-2xl leading-tight uppercase text-[#053F46] md:pointer-events-none md:select-none md:leading-[0.82] md:text-[clamp(2.75rem,11vw,7.25rem)]"
        >
          {title}
        </h2>
        <div className="relative z-10 mt-2 md:mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <p className="text-sm text-[#4a6366] max-w-md">{description}</p>
          <LandingTrackedLink
            href={href}
            location="feature_section"
            action={action}
            className="group flex items-center gap-2 text-sm font-semibold text-[#053F46] hover:text-[#053F46]/80 transition-colors shrink-0"
          >
            {linkLabel}
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </LandingTrackedLink>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8 pb-4 border-b border-white/5">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            'w-10 h-10 rounded-xl border flex items-center justify-center shrink-0',
            ACCENT_BOX[accent]
          )}
        >
          <Icon className={cn('w-5 h-5', ACCENT_ICON[accent])} />
        </div>
        <div className="min-w-0">
          <h2 id={id} className="text-2xl font-bold text-white tracking-tight">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      <LandingTrackedLink
        href={href}
        location="feature_section"
        action={action}
        className="group flex items-center gap-2 text-sm font-semibold text-[#00d4ff] hover:text-[#00e5ff] transition-colors shrink-0 self-start sm:self-center"
      >
        {linkLabel}
        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </LandingTrackedLink>
    </div>
  );
}
