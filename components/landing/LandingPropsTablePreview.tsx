import { Table2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { LandingSection } from '@/components/landing/LandingSection';
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

function confBadgeClass(conf: string): string {
  const c = conf.toLowerCase();
  if (c === 'high') return 'bg-[#56D6A3]/25 text-[#075B5C] rounded-full font-semibold';
  if (c === 'medium') return 'bg-amber-50 text-amber-700 rounded-full font-semibold';
  return 'bg-[#F3F8F8] text-[#72869A] rounded-full font-medium';
}

function evClass(ev: string): string {
  if (ev.startsWith('+')) return 'text-[#20B95A]';
  return 'text-[#063F46]';
}

function SkeletonRow() {
  return (
    <tr className="border-b border-[#DCE9EA]" aria-hidden>
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2 min-w-0 max-w-[160px]">
          <Skeleton className="h-3.5 flex-1 max-w-[100px] bg-[#E8F0F1]" />
          <Skeleton className="h-3.5 w-3.5 shrink-0 rounded bg-[#E8F0F1]" />
        </div>
      </td>
      <td className="py-2.5 px-3">
        <Skeleton className="h-3.5 w-14 bg-[#E8F0F1]" />
      </td>
      <td className="py-2.5 px-3">
        <Skeleton className="h-3.5 w-10 bg-[#E8F0F1]" />
      </td>
      <td className="py-2.5 px-3 text-right">
        <Skeleton className="h-3.5 w-8 ml-auto bg-[#E8F0F1]" />
      </td>
      <td className="py-2.5 px-3">
        <Skeleton className="h-3.5 w-16 max-w-[100px] bg-[#E8F0F1]" />
      </td>
      <td className="py-2.5 px-3 text-right">
        <Skeleton className="h-3.5 w-9 ml-auto bg-[#E8F0F1]" />
      </td>
      <td className="py-2.5 px-3 text-right">
        <Skeleton className="h-3.5 w-10 ml-auto bg-[#E8F0F1]" />
      </td>
      <td className="py-2.5 px-3 text-right">
        <Skeleton className="h-3.5 w-8 ml-auto bg-[#E8F0F1]" />
      </td>
      <td className="py-2.5 px-3 text-right">
        <Skeleton className="h-3.5 w-10 ml-auto bg-[#E8F0F1]" />
      </td>
      <td className="py-2.5 px-3 text-right">
        <Skeleton className="h-3.5 w-10 ml-auto bg-[#56D6A3]/25" />
      </td>
      <td className="py-2.5 px-3 text-right">
        <Skeleton className="h-3.5 w-8 ml-auto bg-[#E8F0F1]" />
      </td>
      <td className="py-2.5 px-3">
        <Skeleton className="h-3 w-24 bg-[#E8F0F1]" />
      </td>
      <td className="py-2.5 px-2">
        <Skeleton className="h-6 w-11 rounded-lg mx-auto bg-[#E8F0F1]" />
      </td>
      <td className="py-2.5 px-2">
        <Skeleton className="h-6 w-10 rounded-lg mx-auto bg-[#E8F0F1]" />
      </td>
    </tr>
  );
}

/**
 * Marketing preview: same shell as Props Explorer table, demo rows + skeleton tail.
 */
export function LandingPropsTablePreview() {
  return (
    <LandingSection
      className="slide-up"
      style={{ animationDelay: '550ms' }}
      aria-labelledby="landing-props-preview-heading"
    >
      <LandingSectionHeader
        id="landing-props-preview-heading"
        icon={Table2}
        accent="cyan"
        variant="watermark"
        title="Props Explorer snapshot"
        description="Model vs market — same grid you get inside the terminal (sample rows; tail as loading placeholders)."
        href="/betting/props-explorer"
        linkLabel="Open props board"
      />

      <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[min(420px,70vh)] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#F8FBFA] border-b border-[#DCE9EA]">
              <tr className="text-[11px] uppercase tracking-wide text-[#72869A]">
                <th className="py-2.5 px-3 font-medium">Player</th>
                <th className="py-2.5 px-3 font-medium">Prop</th>
                <th className="py-2.5 px-3 font-medium">Side</th>
                <th className="py-2.5 px-3 font-medium text-right">Line</th>
                <th className="py-2.5 px-3 font-medium">Book</th>
                <th className="py-2.5 px-3 font-medium text-right">Odds</th>
                <th className="py-2.5 px-3 font-medium text-right">Implied</th>
                <th className="py-2.5 px-3 font-medium text-right" title="Track B.1 confidence tier">
                  Conf
                </th>
                <th className="py-2.5 px-3 font-medium text-right">Model</th>
                <th className="py-2.5 px-3 font-medium text-right">EV</th>
                <th className="py-2.5 px-3 font-medium text-right">Proj</th>
                <th className="py-2.5 px-3 font-medium">Updated</th>
                <th className="py-2.5 px-3 font-medium w-[72px]">Save</th>
                <th className="py-2.5 px-3 font-medium w-[72px]">Paper</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_ROWS.map((r, idx) => (
                <tr
                  key={`${r.player}-${r.prop}-${idx}`}
                  className="border-b border-[#DCE9EA] hover:bg-[#F8FBFA]"
                >
                  <td className="py-2.5 px-3">
                    <span className="font-bold text-[#063F46] truncate min-w-0 max-w-[160px] inline-block align-middle">
                      {r.player}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-[#063F46] capitalize">{r.prop.replace(/_/g, ' ')}</td>
                  <td className="py-2.5 px-3 text-[#063F46] capitalize">{r.side}</td>
                  <td className="py-2.5 px-3 text-right font-semibold tabular-nums text-[#063F46]">{r.line}</td>
                  <td className="py-2.5 px-3 text-[#72869A] truncate max-w-[100px]">{r.book}</td>
                  <td className="py-2.5 px-3 text-right font-semibold tabular-nums text-[#063F46]">{r.odds}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-[#063F46]">{r.implied}</td>
                  <td className="py-2.5 px-3 text-right">
                    <span className={`text-[10px] px-2 py-0.5 capitalize ${confBadgeClass(r.conf)}`}>
                      {r.conf}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-[#063F46]">{r.model}</td>
                  <td className={`py-2.5 px-3 text-right font-semibold tabular-nums ${evClass(r.ev)}`}>
                    {r.ev}
                  </td>
                  <td className="py-2.5 px-3 text-right font-semibold tabular-nums text-[#168DD8]">{r.proj}</td>
                  <td className="py-2.5 px-3 text-[10px] text-[#72869A] whitespace-nowrap">
                    {r.updated}
                  </td>
                  <td className="py-2.5 px-2">
                    <span className="text-[10px] px-2 py-1 rounded-lg bg-[#F3F8F8] border border-[#DCE9EA] text-[#063F46] font-semibold inline-block">
                      Save
                    </span>
                  </td>
                  <td className="py-2.5 px-2">
                    <span className="text-[10px] px-2 py-1 rounded-lg bg-[#F3F8F8] border border-[#DCE9EA] text-[#063F46] font-semibold inline-block">
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
    </LandingSection>
  );
}
