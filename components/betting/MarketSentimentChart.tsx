'use client';

import type { MarketSentimentSnapshot } from '@/lib/betting/market-sentiment-types';

export type SentimentHistoryPoint = { time: string; homeWinPct: number };

export type SentimentChartMode = 'history' | 'snapshot' | 'demo';

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i);
  return Math.abs(h);
}

function pseudoRand(seed: number, i: number): number {
  const x = Math.sin(seed * 0.001 + i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Placeholder series for UI until Polymarket (or another public feed) supplies real history. */
export function demoSentimentHistory(gameId: string): SentimentHistoryPoint[] {
  const seed = hashString(gameId);
  const anchor = 42 + (seed % 17);
  const labels = ['96h', '72h', '48h', '36h', '24h', '12h', '6h', 'Now'];
  return labels.map((time, i) => {
    const t = i / Math.max(labels.length - 1, 1);
    const drift = (pseudoRand(seed, i) - 0.5) * 14;
    const smooth = anchor + drift * (1 - t * 0.35);
    return { time, homeWinPct: clamp(Math.round(smooth * 10) / 10, 8, 92) };
  });
}

/**
 * Prefer API history → snapshot (flat line) → demo series so the chart always has something to draw.
 */
export function resolveSentimentChartData(
  gameId: string,
  sentiment: MarketSentimentSnapshot | null | undefined
): { points: SentimentHistoryPoint[]; mode: SentimentChartMode } {
  const h = sentiment?.history;
  if (h && h.length >= 2) {
    return { points: h, mode: 'history' };
  }

  let homePct = sentiment?.homeWinPct ?? null;
  const awayPct = sentiment?.awayWinPct ?? null;
  if (awayPct != null && homePct == null) homePct = Math.round((100 - awayPct) * 10) / 10;
  if (homePct != null && awayPct == null) {
    /* keep homePct */
  }

  if (homePct != null) {
    return {
      points: [
        { time: 'Open', homeWinPct: homePct },
        { time: 'Now', homeWinPct: homePct },
      ],
      mode: 'snapshot',
    };
  }

  return { points: demoSentimentHistory(gameId), mode: 'demo' };
}

const W = 480;
const H = 148;

export function MarketSentimentChart({
  data,
  homeTeamAbbr,
  color = '#39ff14',
}: {
  data: SentimentHistoryPoint[];
  homeTeamAbbr: string;
  color?: string;
}) {
  const safeData: SentimentHistoryPoint[] =
    data.length >= 2
      ? data
      : [
          { time: '—', homeWinPct: 50 },
          { time: '—', homeWinPct: 50 },
        ];

  const values = safeData.map((d) => d.homeWinPct);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max(3, (rawMax - rawMin) * 0.15, 2);
  const min = Math.max(0, rawMin - pad);
  const max = Math.min(100, rawMax + pad);
  const range = max - min || 1;

  const padding = { top: 10, right: 30, bottom: 22, left: 4 };
  const chartWidth = W - padding.left - padding.right;
  const chartHeight = H - padding.top - padding.bottom;

  const points = safeData.map((d, index) => {
    const x = padding.left + (index / Math.max(safeData.length - 1, 1)) * chartWidth;
    const y = padding.top + chartHeight - ((d.homeWinPct - min) / range) * chartHeight;
    return { x, y, ...d };
  });

  const pathD = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  const gradId = `sentiment-grad-${homeTeamAbbr.replace(/\W/g, '')}`;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <h4 className="text-[11px] font-medium text-white truncate">
          Home win % ({homeTeamAbbr})
        </h4>
        <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
          {safeData[safeData.length - 1].homeWinPct.toFixed(1)}%
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto max-h-[180px]"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
          const y = padding.top + chartHeight * ratio;
          const value = max - ratio * range;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={W - padding.right}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="2,2"
              />
              <text x={W - padding.right + 4} y={y + 3} fill="#8888a0" fontSize="9" fontFamily="monospace">
                {value.toFixed(0)}
              </text>
            </g>
          );
        })}

        <path
          d={`${pathD} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`}
          fill={`url(#${gradId})`}
        />

        <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={4} fill={color} />
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={8} fill={color} opacity={0.2} />

        {points
          .filter((_, i) => i === 0 || i === points.length - 1 || (safeData.length > 5 && i === Math.floor(safeData.length / 2)))
          .map((point, i) => (
            <text
              key={i}
              x={point.x}
              y={H - 6}
              fill="#8888a0"
              fontSize="9"
              textAnchor="middle"
            >
              {point.time}
            </text>
          ))}
      </svg>
    </div>
  );
}
