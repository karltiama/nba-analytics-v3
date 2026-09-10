import Script from 'next/script';
import { umamiScriptConfig } from '@/lib/product-analytics/umami';

/** Renders Umami only when website id + script src are configured. */
export function UmamiScript() {
  const config = umamiScriptConfig();
  if (!config) return null;
  return (
    <Script
      src={config.src}
      data-website-id={config.websiteId}
      strategy="afterInteractive"
    />
  );
}
