import { Table2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { LandingSectionHeader } from '@/components/landing/LandingSectionHeader';

type DemoRow = {
  player: string;
  prop: string;
  side: string;
  line: string;
  book: string;
  odds: string;
  implied: string;
  conf: string;
  model: string;
  ev: string;
  proj: string;
  updated: string;
};

const DEMO_ROWS: DemoRow[] = [
  {
    player: 'S. Castle',
    prop: 'rebounds',
    side: 'Under',
    line: '4.5',
    book: 'betrivers',
    odds: '+102',
    implied: '49.5%',
    conf: 'Low',
    model: '44.4%',
    ev: '-10.3%',
    proj: '5.1',
    updated: '4/4/2026, 8:00:30 AM',
  },
  {
    player: 'V. Wembanyama',
    prop: 'points',
    side: 'Over',
    line: '24.5',
    book: 'draftkings',
    odds: '-108',
    implied: '51.9%',
    conf: 'Medium',
    model: '54.2%',
    ev: '+4.4%',
    proj: '26.8',
    updated: '4/4/2026, 7:58:12 AM',
  },
  {
    player: 'J. Tatum',
    prop: 'threes',
    side: 'Over',
    line: '3.5',
    book: 'fanduel',
    odds: '+114',
    implied: '46.7%',
    conf: 'High',
    model: '52.1%',
    ev: '+11.5%',
    proj: '4.2',
    updated: '4/4/2026, 7:55:00 AM',
  },
  {
    player: 'S. Gilgeous-Alexander',
    prop: 'assists',
    side: 'Over',
    line: '6.5',
    book: 'betmgm',
    odds: '-115',
    implied: '53.5%',
    conf: 'Medium',
    model: '51.0%',
    ev: '−4.7%',
    proj: '6.9',
    updated: '4/4/2026, 7:52:44 AM',
  },
];

const SKELETON_TAIL_ROWS = 5;

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5" aria-hidden>
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
  );
}

/**
 * Marketing preview: same shell as Props Explorer table, demo rows + skeleton tail.
 */
export function LandingPropsTablePreview() {
  return (
    <section
      className="w-full max-w-6xl mx-auto mt-32 px-4 sm:px-6 slide-up"
      style={{ animationDelay: '550ms' }}
      aria-labelledby="landing-props-preview-heading"
    >
      <LandingSectionHeader
        id="landing-props-preview-heading"
        icon={Table2}
        accent="cyan"
        title="Props Explorer snapshot"
        description="Model vs market — same grid you get inside the terminal (sample rows; tail as loading placeholders)."
        href="/betting/props-explorer"
        linkLabel="Open props board"
      />

      <div className="glass-card rounded-xl overflow-hidden border border-white/5">
        <div className="overflow-x-auto max-h-[min(420px,70vh)] overflow-y-auto">
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
                <th className="py-2 px-2 font-medium text-right" title="Track B.1 confidence tier">
                  Conf
                </th>
                <th className="py-2 px-2 font-medium text-right">Model</th>
                <th className="py-2 px-2 font-medium text-right">EV</th>
                <th className="py-2 px-2 font-medium text-right">Proj</th>
                <th className="py-2 px-2 font-medium">Updated</th>
                <th className="py-2 px-2 font-medium w-[72px]">Save</th>
                <th className="py-2 px-2 font-medium w-[72px]">Paper</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_ROWS.map((r, idx) => (
                <tr
                  key={`${r.player}-${r.prop}-${idx}`}
                  className="border-b border-white/5 hover:bg-white/3"
                >
                  <td className="py-1.5 px-2">
                    <span className="text-[#00d4ff] truncate min-w-0 max-w-[160px] inline-block align-middle">
                      {r.player}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-white capitalize">{r.prop.replace(/_/g, ' ')}</td>
                  <td className="py-1.5 px-2 capitalize">{r.side}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-white">{r.line}</td>
                  <td className="py-1.5 px-2 text-muted-foreground truncate max-w-[100px]">{r.book}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-white">{r.odds}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{r.implied}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-muted-foreground capitalize">
                    {r.conf}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono">{r.model}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-[#39ff14]">{r.ev}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-white">{r.proj}</td>
                  <td className="py-1.5 px-2 text-[10px] text-muted-foreground whitespace-nowrap">
                    {r.updated}
                  </td>
                  <td className="py-1.5 px-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/20 text-white/50 inline-block">
                      Save
                    </span>
                  </td>
                  <td className="py-1.5 px-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-[#00d4ff]/25 text-[#8fefff]/50 inline-block">
                      Add
                    </span>
                  </td>
                </tr>
              ))}
              {Array.from({ length: SKELETON_TAIL_ROWS }, (_, i) => (
                <SkeletonRow key={i} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
