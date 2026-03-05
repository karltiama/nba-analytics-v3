'use client';

import { useState, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

export type Timeframe = 5 | 10 | 20 | 'season';
export type LocationFilter = 'all' | 'home' | 'away';
export type TeamTrendMetric = 'team_total' | 'game_total' | 'spread' | 'moneyline';

const TIMEFRAME_OPTIONS: { value: Timeframe; label: string }[] = [
  { value: 5, label: 'L5' },
  { value: 10, label: 'L10' },
  { value: 20, label: 'L20' },
  { value: 'season', label: 'Season' },
];
const LOCATION_OPTIONS: { value: LocationFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'home', label: 'Home' },
  { value: 'away', label: 'Away' },
];

const METRIC_BUTTONS: { value: TeamTrendMetric; label: string; disabled?: boolean }[] = [
  { value: 'team_total', label: 'Team total' },
  { value: 'game_total', label: 'Game total' },
  { value: 'spread', label: 'Spread', disabled: true },
  { value: 'moneyline', label: 'Money line', disabled: true },
];

const selectClass =
  'rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white focus:border-[#00d4ff]/50 focus:outline-none focus:ring-1 focus:ring-[#00d4ff]/30 min-w-0';

const CHART_HEIGHT = 220;
const PADDING = { top: 24, right: 72, bottom: 44, left: 56 };
const SVG_WIDTH = 540;

function getMetricLabel(metric: TeamTrendMetric): string {
  switch (metric) {
    case 'team_total': return 'pts';
    case 'game_total': return 'total pts';
    case 'spread': return 'margin';
    case 'moneyline': return 'result';
    default: return 'pts';
  }
}

interface TeamTrendChartProps {
  data: number[];
  seasonAvg: number;
  labels: string[];
  metric: TeamTrendMetric;
  onMetricChange: (v: TeamTrendMetric) => void;
  timeframe: Timeframe;
  onTimeframeChange: (v: Timeframe) => void;
  locationFilter: LocationFilter;
  onLocationFilterChange: (v: LocationFilter) => void;
}

export function TeamTrendChart({
  data,
  seasonAvg,
  labels,
  metric,
  onMetricChange,
  timeframe,
  onTimeframeChange,
  locationFilter,
  onLocationFilterChange,
}: TeamTrendChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const svgWidth = SVG_WIDTH;
  const chartWidth = svgWidth - PADDING.left - PADDING.right;

  const getIndexFromEvent = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || data.length === 0) return null;
      const rect = svg.getBoundingClientRect();
      const scaleX = svgWidth / rect.width;
      const mouseX = (e.clientX - rect.left) * scaleX - PADDING.left;
      const step = chartWidth / Math.max(data.length - 1, 1);
      const idx = Math.round(mouseX / step);
      return Math.max(0, Math.min(idx, data.length - 1));
    },
    [data.length, svgWidth, chartWidth]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const idx = getIndexFromEvent(e);
      if (idx !== null) setHoveredIndex(idx);
    },
    [getIndexFromEvent]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const idx = getIndexFromEvent(e);
      if (idx === null) return;
      setPinnedIndex((prev) => (prev === idx ? null : idx));
    },
    [getIndexFromEvent]
  );

  const displayIndex = pinnedIndex ?? hoveredIndex;

  if (data.length === 0) {
    return (
      <div className="glass-card rounded-xl p-8 flex items-center justify-center h-[280px]">
        <span className="text-muted-foreground">No data to chart</span>
      </div>
    );
  }

  const allValues = [...data, seasonAvg];
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;
  const yPad = range * 0.1;
  const yMin = minVal - yPad;
  const yMax = maxVal + yPad;
  const yRange = yMax - yMin;

  const toY = (v: number) =>
    PADDING.top + ((yMax - v) / yRange) * (CHART_HEIGHT - PADDING.top - PADDING.bottom);
  const step = chartWidth / Math.max(data.length - 1, 1);
  const toX = (i: number) => PADDING.left + i * step;

  const gridLines = 5;
  const yTicks: number[] = [];
  for (let i = 0; i <= gridLines; i++) {
    yTicks.push(yMin + (yRange * i) / gridLines);
  }

  const showEveryNthLabel = data.length <= 15 ? 1 : Math.ceil(data.length / 15);

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-white/5 space-y-3 bg-white/[0.02]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
            Trend
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={String(timeframe)}
              onChange={(e) => {
                const v = e.target.value;
                onTimeframeChange(v === 'season' ? 'season' : (Number(v) as 5 | 10 | 20));
              }}
              className={selectClass}
            >
              {TIMEFRAME_OPTIONS.map(({ value, label }) => (
                <option key={String(value)} value={String(value)} className="bg-background text-white">
                  {label}
                </option>
              ))}
            </select>
            <select
              value={locationFilter}
              onChange={(e) => onLocationFilterChange(e.target.value as LocationFilter)}
              className={selectClass}
            >
              {LOCATION_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value} className="bg-background text-white">
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground shrink-0">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#bf5af2] rounded-full inline-block" />
              Avg {seasonAvg.toFixed(1)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {METRIC_BUTTONS.map(({ value, label, disabled }) => (
            <button
              key={value}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onMetricChange(value)}
              title={disabled ? 'Coming soon' : undefined}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                disabled && 'opacity-50 cursor-not-allowed',
                !disabled && metric === value
                  ? 'bg-[#00d4ff] text-black shadow-[0_0_16px_rgba(0,212,255,0.5)] font-semibold'
                  : !disabled && 'glass-card text-muted-foreground hover:text-white hover:bg-white/10'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 flex flex-col items-center">
        <div className="w-full min-w-0 flex flex-col items-center max-w-full">
          <svg
            ref={svgRef}
            width={svgWidth}
            height={CHART_HEIGHT}
            viewBox={`0 0 ${svgWidth} ${CHART_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            className="cursor-pointer block max-w-full"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredIndex(null)}
            onClick={handleClick}
          >
            <defs>
              <linearGradient id="team-trend-fill" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#00d4ff" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            <rect x={0} y={0} width={svgWidth} height={CHART_HEIGHT} fill="transparent" />

            {yTicks.map((tick, i) => {
              const y = toY(tick);
              return (
                <g key={i}>
                  <line
                    x1={PADDING.left}
                    y1={y}
                    x2={svgWidth - PADDING.right}
                    y2={y}
                    stroke="white"
                    strokeOpacity={0.06}
                    strokeDasharray="4 4"
                  />
                  <text
                    x={PADDING.left - 8}
                    y={y + 4}
                    textAnchor="end"
                    fill="white"
                    fillOpacity={0.35}
                    fontSize={12}
                    fontFamily="var(--font-geist-mono)"
                  >
                    {tick.toFixed(tick % 1 === 0 ? 0 : 1)}
                  </text>
                </g>
              );
            })}

            <line
              x1={PADDING.left}
              y1={toY(seasonAvg)}
              x2={svgWidth - PADDING.right}
              y2={toY(seasonAvg)}
              stroke="#bf5af2"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              strokeOpacity={0.7}
            />
            <text
              x={svgWidth - 8}
              y={toY(seasonAvg) + 4}
              textAnchor="end"
              fill="#bf5af2"
              fontSize={11}
              fontFamily="var(--font-geist-mono)"
            >
              Avg {seasonAvg.toFixed(1)}
            </text>

            {data.length > 1 && (() => {
              const areaPath = data
                .map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(v)}`)
                .join(' ');
              const bottomY = CHART_HEIGHT - PADDING.bottom;
              return (
                <path
                  d={`${areaPath} L ${toX(data.length - 1)} ${bottomY} L ${PADDING.left} ${bottomY} Z`}
                  fill="url(#team-trend-fill)"
                />
              );
            })()}

            {data.length > 1 && (
              <path
                d={data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(v)}`).join(' ')}
                fill="none"
                stroke="#00d4ff"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {data.map((v, i) => {
              const x = toX(i);
              const y = toY(v);
              const isHighlighted = displayIndex === i;
              return (
                <g key={i}>
                  <circle
                    cx={x}
                    cy={y}
                    r={isHighlighted ? 6 : 3.5}
                    fill="#00d4ff"
                    opacity={isHighlighted ? 1 : 0.85}
                  />
                  {isHighlighted && (
                    <circle cx={x} cy={y} r={10} fill="#00d4ff" opacity={0.2} />
                  )}
                </g>
              );
            })}

            {labels.map((label, i) => {
              const x = toX(i);
              if (i % showEveryNthLabel !== 0 && i !== data.length - 1) return null;
              return (
                <text
                  key={i}
                  x={x}
                  y={CHART_HEIGHT - 8}
                  textAnchor="middle"
                  fill="white"
                  fillOpacity={0.3}
                  fontSize={11}
                  fontFamily="var(--font-geist-mono)"
                >
                  {label}
                </text>
              );
            })}

            {displayIndex !== null && (
              <line
                x1={toX(displayIndex)}
                y1={PADDING.top}
                x2={toX(displayIndex)}
                y2={CHART_HEIGHT - PADDING.bottom}
                stroke="white"
                strokeOpacity={0.12}
                strokeDasharray="3 3"
              />
            )}
          </svg>

          <div className="mt-2 min-h-[28px] w-full flex justify-center">
            {displayIndex !== null ? (
              <div className="flex items-center gap-3 text-sm font-mono flex-wrap justify-center">
                <span className="font-bold text-[#00d4ff] text-lg">{data[displayIndex]}</span>
                <span className="text-muted-foreground">{getMetricLabel(metric)}</span>
                <span className="text-muted-foreground">vs {labels[displayIndex] ?? '—'}</span>
                <span className="text-xs text-muted-foreground/60">
                  (Game {displayIndex + 1}/{data.length})
                </span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground/50">
                Hover or click a point for game details
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
