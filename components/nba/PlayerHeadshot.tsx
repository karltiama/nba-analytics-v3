'use client';

import { useState } from 'react';
import { nbaCdnHeadshotUrl } from '@/lib/nba/headshots';

function playerInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2);
}

export function PlayerHeadshot({
  nbaPlayerId,
  name,
  className = 'relative w-[72px] h-[88px] rounded-2xl overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0',
}: {
  nbaPlayerId?: string | null;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = playerInitials(name);

  if (!nbaPlayerId || failed) {
    return (
      <div className={`${className} flex items-center justify-center`} aria-hidden>
        <span className="text-sm font-bold text-[#8aa0a3]">{initials}</span>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={nbaCdnHeadshotUrl(nbaPlayerId)}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-[center_18%] origin-[center_18%] scale-[1.4]"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
