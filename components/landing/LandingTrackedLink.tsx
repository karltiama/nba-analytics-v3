'use client';

import Link from 'next/link';
import { landingCtaProperties, LANDING_CTA_CLICKED } from '@/lib/product-analytics/landing-events';
import { trackEvent } from '@/lib/product-analytics/track-event';
import type { LandingCtaAction, LandingCtaLocation } from '@/lib/product-analytics/track-event';

/** Landing CTA that records destination intent and then navigates. */
export function LandingTrackedLink({
  href,
  location,
  action,
  className,
  children,
  ariaLabel,
}: {
  href: string;
  location: LandingCtaLocation;
  action: LandingCtaAction;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      className={className}
      aria-label={ariaLabel}
      onClick={() => {
        trackEvent(LANDING_CTA_CLICKED, landingCtaProperties(location, action));
      }}
    >
      {children}
    </Link>
  );
}
