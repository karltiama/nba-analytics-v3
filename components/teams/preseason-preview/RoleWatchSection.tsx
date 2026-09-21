import Link from 'next/link';
import { PreviewCard, PreviewSectionHeading } from './PreviewCard';
import type { PreviewRoleWatchRow } from '@/lib/teams/preseason-preview/types';
import { cn } from '@/lib/utils';

function watchTone(watch: string) {
  if (watch === 'Stable') return 'text-[#4a6366]';
  if (watch === 'Role TBD') return 'text-[#8aa0a3]';
  return 'text-[#075B5C] font-semibold';
}

export function RoleWatchSection({
  rows,
  seasonLabel,
}: {
  rows: PreviewRoleWatchRow[];
  seasonLabel: string;
}) {
  if (rows.length === 0) return null;

  return (
    <PreviewCard id="role-usage" className="scroll-mt-24">
      <PreviewSectionHeading
        title="Usage & Role Watch"
        subtitle="Editorial observations — not model predictions"
      />

      <div className="overflow-x-auto -mx-1">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="border-b border-[#DCE9EA] text-left">
              <th className="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wide text-[#8aa0a3]">
                Player
              </th>
              <th className="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wide text-[#8aa0a3]">
                Previous Role
              </th>
              <th className="py-2 text-[10px] font-semibold uppercase tracking-wide text-[#8aa0a3]">
                {seasonLabel} Watch
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = row.player.nbaPlayerId
                ? `/betting/players/${encodeURIComponent(row.player.nbaPlayerId)}`
                : null;
              return (
                <tr
                  key={row.player.name}
                  className="border-b border-[#DCE9EA] last:border-0"
                >
                  <td className="py-2.5 pr-3 font-medium text-[#063f46]">
                    {href ? (
                      <Link
                        href={href}
                        className="hover:text-[#075B5C] transition-colors"
                      >
                        {row.player.name}
                      </Link>
                    ) : (
                      row.player.name
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-[#4a6366]">{row.previousRole}</td>
                  <td className={cn('py-2.5', watchTone(row.watch))}>
                    {row.watch}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PreviewCard>
  );
}
