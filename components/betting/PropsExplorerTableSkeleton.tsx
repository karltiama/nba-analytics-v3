import { Skeleton } from '@/components/ui/skeleton';

const ROWS = 12;

/**
 * Initial-load placeholder for the Props Explorer results table (bar shapes read like tiny spark/chart strips).
 */
export function PropsExplorerTableSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading props">
      <div className="border-y border-[#DCE9EA] bg-white lg:hidden">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-[4.75rem] items-center gap-3 border-b border-[#DCE9EA] px-3 last:border-b-0">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-10" />
              </div>
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
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
              <th className="py-2 px-2 font-medium text-right">Market P</th>
              <th className="py-2 px-2 font-medium text-right">Conf</th>
              <th className="py-2 px-2 font-medium text-right">Est. P</th>
              <th className="py-2 px-2 font-medium text-right">Est. EV</th>
              <th className="py-2 px-2 font-medium text-right">Proj</th>
              <th className="py-2 px-2 font-medium">Updated</th>
              <th className="py-2 px-2 font-medium w-[72px]">Save</th>
              <th className="py-2 px-2 font-medium w-[72px]">Paper</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, i) => (
              <tr key={i} className="border-b border-[#DCE9EA]">
                <td className="py-2 px-2">
                  <div className="flex items-center gap-2 min-w-0 max-w-[160px]">
                    <Skeleton className="h-3.5 flex-1 max-w-[100px]" />
                    <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
                  </div>
                </td>
                <td className="py-2 px-2">
                  <Skeleton className="h-3.5 w-14" />
                </td>
                <td className="py-2 px-2">
                  <Skeleton className="h-3.5 w-10" />
                </td>
                <td className="py-2 px-2 text-right">
                  <Skeleton className="h-3.5 w-8 ml-auto" />
                </td>
                <td className="py-2 px-2">
                  <Skeleton className="h-3.5 w-16 max-w-[100px]" />
                </td>
                <td className="py-2 px-2 text-right">
                  <Skeleton className="h-3.5 w-9 ml-auto" />
                </td>
                <td className="py-2 px-2 text-right">
                  <Skeleton className="h-3.5 w-10 ml-auto" />
                </td>
                <td className="py-2 px-2 text-right">
                  <Skeleton className="h-3.5 w-8 ml-auto" />
                </td>
                <td className="py-2 px-2 text-right">
                  <Skeleton className="h-3.5 w-10 ml-auto" />
                </td>
                <td className="py-2 px-2 text-right">
                  <Skeleton className="h-3.5 w-10 ml-auto bg-[#55ddb1]/25" />
                </td>
                <td className="py-2 px-2 text-right">
                  <Skeleton className="h-3.5 w-8 ml-auto" />
                </td>
                <td className="py-2 px-2">
                  <Skeleton className="h-3 w-24" />
                </td>
                <td className="py-2 px-1">
                  <Skeleton className="h-6 w-11 rounded-md mx-auto" />
                </td>
                <td className="py-2 px-1">
                  <Skeleton className="h-6 w-10 rounded-md mx-auto" />
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
