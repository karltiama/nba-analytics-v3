import { Skeleton } from '@/components/ui/skeleton';

const ROWS = 12;

/**
 * Initial-load placeholder for the Props Explorer results table (bar shapes read like tiny spark/chart strips).
 */
export function PropsExplorerTableSkeleton() {
  return (
    <div className="glass-card rounded-xl overflow-hidden border border-white/5" aria-busy="true" aria-label="Loading props">
      <div className="overflow-x-auto max-h-[calc(100vh-16rem)] overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-gray-950/95 border-b border-white/10">
            <tr className="text-muted-foreground">
              <th className="py-2 px-2 font-medium">Player</th>
              <th className="py-2 px-2 font-medium">Prop</th>
              <th className="py-2 px-2 font-medium">Side</th>
              <th className="py-2 px-2 font-medium text-right">Line</th>
              <th className="py-2 px-2 font-medium">Book</th>
              <th className="py-2 px-2 font-medium text-right">Odds</th>
              <th className="py-2 px-2 font-medium text-right">Implied</th>
              <th className="py-2 px-2 font-medium text-right">Conf</th>
              <th className="py-2 px-2 font-medium text-right">Model</th>
              <th className="py-2 px-2 font-medium text-right">EV</th>
              <th className="py-2 px-2 font-medium text-right">Proj</th>
              <th className="py-2 px-2 font-medium">Updated</th>
              <th className="py-2 px-2 font-medium w-[72px]">Save</th>
              <th className="py-2 px-2 font-medium w-[72px]">Paper</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, i) => (
              <tr key={i} className="border-b border-white/5">
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
                  <Skeleton className="h-3.5 w-10 ml-auto bg-[#39ff14]/15" />
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
  );
}
