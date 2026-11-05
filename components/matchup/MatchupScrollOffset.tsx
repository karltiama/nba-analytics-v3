'use client';

import { useLayoutEffect } from 'react';

const OFFSET_VAR = '--matchup-scroll-offset';
/** Space between the sticky card and the section title after a nav jump. */
const GAP_PX = 12;

const DEFAULT_HASHES = [
  'section-story',
  'section-comparison',
  'section-signals',
  'section-personnel',
  'section-roster',
  'section-contributors',
];

function stickyTopPx(style: CSSStyleDeclaration): number {
  const top = Number.parseFloat(style.top);
  return Number.isFinite(top) ? top : 0;
}

/** The app's sticky site header (layout `<header>`), when present. */
function siteHeaderPx(): number {
  const site = document.querySelector('header');
  return site instanceof HTMLElement && getComputedStyle(site).position === 'sticky' ? site.offsetHeight : 0;
}

/**
 * Publishes the stuck matchup header's viewport height as a scroll offset.
 * Section anchors use it so their title bars stay below the sticky card.
 */
export function MatchupScrollOffset({
  headerId = 'matchup-overview',
  hashIds = DEFAULT_HASHES,
}: {
  headerId?: string;
  hashIds?: readonly string[];
}) {
  useLayoutEffect(() => {
    const header = document.getElementById(headerId);
    if (!header) return;

    const apply = () => {
      const style = getComputedStyle(header);
      // Below sm the card is not sticky (it scrolls away), so only the site header covers sections.
      const offset =
        style.position === 'sticky'
          ? Math.ceil(stickyTopPx(style) + header.offsetHeight + GAP_PX)
          : Math.ceil(siteHeaderPx() + GAP_PX);
      document.documentElement.style.setProperty(OFFSET_VAR, `${offset}px`);
    };

    apply();
    const hashId = window.location.hash.replace(/^#/, '');
    if (hashIds.includes(hashId)) {
      document.getElementById(hashId)?.scrollIntoView();
    }
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    window.addEventListener('resize', apply);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', apply);
      document.documentElement.style.removeProperty(OFFSET_VAR);
    };
  }, [headerId, hashIds]);

  return null;
}
