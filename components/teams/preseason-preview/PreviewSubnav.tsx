'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { PREVIEW_SUBNAV, type PreviewSectionId } from '@/lib/teams/preseason-preview/types';

export function PreviewSubnav() {
  const [active, setActive] = useState<PreviewSectionId>('overview');

  useEffect(() => {
    const ids = PREVIEW_SUBNAV.map((s) => s.id);
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el != null);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target?.id as PreviewSectionId | undefined;
        if (top) setActive(top);
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0.1, 0.35, 0.6] }
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      aria-label="Preview sections"
      className="sticky top-0 z-20 -mx-4 sm:-mx-6 lg:-mx-8 border-b border-[#DCE9EA] bg-[#f7f9f7]/95 backdrop-blur-sm"
    >
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
        <ul className="flex gap-1 overflow-x-auto py-2 scrollbar-thin">
          {PREVIEW_SUBNAV.map((item) => {
            const isActive = active === item.id;
            return (
              <li key={item.id} className="shrink-0">
                <a
                  href={`#${item.id}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'inline-flex items-center px-3 py-2 text-sm whitespace-nowrap rounded-lg transition-colors',
                    isActive
                      ? 'text-[#063f46] font-semibold border-b-2 border-[#55ddb1] rounded-none'
                      : 'text-[#4a6366] hover:text-[#063f46]'
                  )}
                  onClick={() => setActive(item.id)}
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
