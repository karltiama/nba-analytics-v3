import Link from 'next/link';
import { cn } from '@/lib/utils';
import { FOUNDING_PRO_UPGRADE_HREF } from '@/components/betting/betting-shell-paths';

export { FOUNDING_PRO_UPGRADE_HREF };

/** Routes Upgrade through /billing. Does not start Checkout. */
export function FoundingProUpgradeLink({
  className,
  children,
  onClick,
}: {
  className?: string;
  children?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <Link
      href={FOUNDING_PRO_UPGRADE_HREF}
      className={cn(
        'inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-[#00d4ff]/90 to-[#bf5af2]/90 px-3 py-1.5 text-xs font-medium text-white hover:opacity-95',
        className
      )}
      onClick={(event) => {
        try {
          onClick?.(event);
        } catch {
          // Tracking must never block navigation to /billing.
        }
      }}
    >
      {children ?? 'Upgrade to Founding Pro'}
    </Link>
  );
}
