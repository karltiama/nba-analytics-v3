import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const ROWS = 12;

function Bar({ className }: { className?: string }) {
  return <Skeleton className={cn('bg-[#E8F0F1]', className)} />;
}

/**
 * Placeholder for the Props Explorer results table while rows are loading.
 */
export function PropsExplorerTableSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading props">
      <div className="border-y border-[#DCE9EA] bg-white lg:hidden">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-[4.75rem] items-center gap-3 border-b border-[#DCE9EA] px-3 last:border-b-0">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <Bar className="h-3.5 w-28" />
                <Bar className="h-3.5 w-10" />
              </div>
              <Bar className="h-3.5 w-36" />
              <Bar className="h-3 w-24" />
            </div>
            <Bar className="h-8 w-8 shrink-0 rounded-lg" />
          </div>
        ))}
      </div>
    <div className="hidden bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden lg:block">
      <div className="overflow-x-auto max-h-[calc(100vh-16rem)] overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-[#F8FBFA] border-b border-[#DCE9EA]">
            <tr className="text-[#4a6366]">
              <th className="py-2 px-2 font-medium">Player</th>
              <th className="py-2 px-2 font-medium">Prop</th>
              <th className="py-2 px-2 font-medium">Side</th>
              <th className="py-2 px-2 font-medium text-right">Line</th>
              <th className="py-2 px-2 font-medium">Book</th>
              <th className="py-2 px-2 font-medium text-right">Odds</th>
              <th className="py-2 px-2 font-medium">Best price</th>
              <th className="py-2 px-2 font-medium text-right">vs Avg</th>
              <th className="py-2 px-2 font-medium text-right">Fair P</th>
              <th className="py-2 px-2 font-medium text-right">Sample</th>
              <th className="py-2 px-2 font-medium">Updated</th>
              <th className="py-2 px-2 font-medium text-right w-[168px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, i) => (
              <tr key={i} className="border-b border-[#DCE9EA]">
                <td className="py-2 px-2">
                  <div className="flex items-center gap-2 min-w-0 max-w-[160px]">
                    <Bar className="h-3.5 flex-1 max-w-[100px]" />
                    <Bar className="h-3.5 w-3.5 shrink-0 rounded" />
                  </div>
                </td>
                <td className="py-2 px-2">
                  <Bar className="h-3.5 w-14" />
                </td>
                <td className="py-2 px-2">
                  <Bar className="h-3.5 w-10" />
                </td>
                <td className="py-2 px-2 text-right">
                  <Bar className="h-3.5 w-8 ml-auto" />
                </td>
                <td className="py-2 px-2">
                  <Bar className="h-3.5 w-16 max-w-[100px]" />
                </td>
                <td className="py-2 px-2 text-right">
                  <Bar className="h-3.5 w-9 ml-auto" />
                </td>
                <td className="py-2 px-2">
                  <Bar className="h-3.5 w-16" />
                </td>
                <td className="py-2 px-2 text-right">
                  <Bar className="h-3.5 w-10 ml-auto" />
                </td>
                <td className="py-2 px-2 text-right">
                  <Bar className="h-3.5 w-10 ml-auto" />
                </td>
                <td className="py-2 px-2 text-right">
                  <Bar className="h-3.5 w-8 ml-auto" />
                </td>
                <td className="py-2 px-2">
                  <Bar className="h-3 w-24" />
                </td>
                <td className="py-2 px-1">
                  <Bar className="h-6 w-24 rounded-md ml-auto" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}
