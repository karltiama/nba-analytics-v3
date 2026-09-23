import Link from 'next/link';
import { cn } from '@/lib/utils';
import { FOUNDING_PRO_UPGRADE_HREF } from '@/components/betting/betting-shell-paths';
import { UPGRADE_CLICKED, upgradeClickedProperties } from '@/lib/product-analytics/conversion-events';
import { trackEvent, type UpgradeClickedSurface } from '@/lib/product-analytics/track-event';

export { FOUNDING_PRO_UPGRADE_HREF };

/** Routes Upgrade through /billing. Does not start Checkout. */
export function FoundingProUpgradeLink({
  className,
  children,
  onClick,
  analyticsSurface,
}: {
  className?: string;
  children?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  /** Omit on Market Movement, which keeps its own historical event. */
  analyticsSurface?: UpgradeClickedSurface;
}) {
  return (
    <Link
      href={FOUNDING_PRO_UPGRADE_HREF}
      className={cn(
        'inline-flex items-center justify-center rounded-lg bg-[#063f46] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#075B5C]',
        className
      )}
      onClick={(event) => {
        try {
          if (analyticsSurface) {
            trackEvent(UPGRADE_CLICKED, upgradeClickedProperties(analyticsSurface));
          }
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
