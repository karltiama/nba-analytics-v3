'use client';

import { useState } from 'react';
import { PreviewCard, PreviewSectionHeading } from './PreviewCard';
import type {
  PreviewPosition,
  PreviewProjectedRotation,
} from '@/lib/teams/preseason-preview/types';
import { cn } from '@/lib/utils';

const POSITIONS: PreviewPosition[] = ['PG', 'SG', 'SF', 'PF', 'C'];

export function ProjectedRotationSection({
  rotation,
  variant = 'card',
}: {
  rotation: PreviewProjectedRotation | null;
  /** `embedded` nests under another card (e.g. Team Snapshot) without extra chrome. */
  variant?: 'card' | 'embedded';
}) {
  const [tab, setTab] = useState<'starters' | 'bench'>('starters');

  const body = !rotation ? (
    <>
      <PreviewSectionHeading
        title="Projected Depth Chart"
        subtitle="Not an official lineup"
      />
      <p className="text-sm text-[#4a6366]">
        Projected rotation will be updated as preseason approaches.
      </p>
    </>
  ) : (
    <>
      <PreviewSectionHeading
        title="Projected Depth Chart"
        subtitle="Curated projection — not an official lineup"
      />

      <div
        className="inline-flex rounded-full border border-[#DCE9EA] bg-[#F8FBFA] p-0.5 mb-4"
        role="tablist"
        aria-label="Rotation view"
      >
        {(
          [
            { id: 'starters', label: 'Starters' },
            { id: 'bench', label: 'Key Bench' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-3.5 py-1.5 text-xs font-medium rounded-full transition-colors',
              tab === t.id
                ? 'bg-[#063f46] text-white'
                : 'text-[#4a6366] hover:text-[#063f46]'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'starters' ? (
        <table className="w-full text-sm">
          <caption className="sr-only">Projected starters by position</caption>
          <tbody>
            {POSITIONS.map((pos) => {
              const player = rotation.starters[pos];
              return (
                <tr key={pos} className="border-b border-[#DCE9EA] last:border-0">
                  <th
                    scope="row"
                    className="py-2.5 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-[#8aa0a3] w-12"
                  >
                    {pos}
                  </th>
                  <td className="py-2.5 text-[#063f46] font-medium">
                    {player?.name ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : rotation.keyBench.length > 0 ? (
        <ul className="space-y-2">
          {rotation.keyBench.map((p) => (
            <li
              key={p.name}
              className="flex items-center justify-between gap-2 border-b border-[#DCE9EA] last:border-0 py-2"
            >
              <span className="text-sm font-medium text-[#063f46]">{p.name}</span>
              {p.position ? (
                <span className="text-[10px] uppercase tracking-wide text-[#8aa0a3]">
                  {p.position}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#4a6366]">No key bench notes yet.</p>
      )}
    </>
  );

  if (variant === 'embedded') {
    return (
      <div className="mt-5 pt-5 border-t border-[#DCE9EA]">{body}</div>
    );
  }

  return <PreviewCard>{body}</PreviewCard>;
}
