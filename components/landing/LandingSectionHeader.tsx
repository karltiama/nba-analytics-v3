import Link from 'next/link';
import { ArrowRight, type LucideIcon } from 'lucide-react';
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
  icon: LucideIcon;
  accent: LandingSectionAccent;
};

export function LandingSectionHeader({
  id,
  title,
  description,
  href,
  linkLabel,
  icon: Icon,
  accent,
}: LandingSectionHeaderProps) {
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
      <Link
        href={href}
        className="group flex items-center gap-2 text-sm font-semibold text-[#00d4ff] hover:text-[#00e5ff] transition-colors shrink-0 self-start sm:self-center"
      >
        {linkLabel}
        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </Link>
    </div>
  );
}
