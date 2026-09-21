'use client';

import { useState } from 'react';
import Image from 'next/image';
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
  className = 'relative w-16 h-20 rounded-2xl overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0',
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
      <Image
        src={nbaCdnHeadshotUrl(nbaPlayerId)}
        alt=""
        fill
        sizes="128px"
        quality={95}
        className="object-cover object-[center_22%]"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
