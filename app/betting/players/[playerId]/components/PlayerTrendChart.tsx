'use client';

import { useState, useRef, useCallback } from 'react';

interface PlayerTrendChartProps {
  data: number[];
  seasonAvg: number;
  labels: string[];
  bettingLine?: number | null;
  metricLabel: string;
}

const CHART_HEIGHT = 220;
const PADDING = { top: 24, right: 24, bottom: 44, left: 48 };

export function PlayerTrendChart({
  data,
  seasonAvg,
  labels,
  bettingLine,
  metricLabel,
}: PlayerTrendChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || data.length === 0) return;
      const rect = svg.getBoundingClientRect();
      const svgWidth = rect.width;
      const chartWidth = svgWidth - PADDING.left - PADDING.right;
      const mouseX = e.clientX - rect.left - PADDING.left;
      const step = chartWidth / Math.max(data.length - 1, 1);
      const idx = Math.round(mouseX / step);
      setHoveredIndex(Math.max(0, Math.min(idx, data.length - 1)));
    },
    [data.length]
  );

  if (data.length === 0) {
    return (
      <div className="glass-card rounded-xl p-8 flex items-center justify-center h-[280px]">
        <span className="text-muted-foreground">No data to chart</span>
      </div>
    );
  }

  const allValues = [...data, seasonAvg, ...(bettingLine != null ? [bettingLine] : [])];
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;
  const yPad = range * 0.1;
  const yMin = minVal - yPad;
  const yMax = maxVal + yPad;
  const yRange = yMax - yMin;

  const toY = (v: number) => PADDING.top + ((yMax - v) / yRange) * (CHART_HEIGHT - PADDING.top - PADDING.bottom);

  const gridLines = 5;
  const yTicks: number[] = [];
  for (let i = 0; i <= gridLines; i++) {
    yTicks.push(yMin + (yRange * i) / gridLines);
  }

  return (
    <div className="glass-card rounded-xl p-5">
      <svg
        ref={svgRef}
        width="100%"
        height={CHART_HEIGHT}
        viewBox={`0 0 800 ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        className="overflow-visible cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <defs>
          <linearGradient id="betting-trend-fill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#00d4ff" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Y-axis grid lines */}
        {yTicks.map((tick, i) => {
          const y = toY(tick);
          return (
            <g key={i}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={800 - PADDING.right}
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
                fontSize={11}
                fontFamily="var(--font-geist-mono)"
              >
                {tick.toFixed(tick % 1 === 0 ? 0 : 1)}
              </text>
            </g>
          );
        })}

        {/* Season average reference line */}
        <line
          x1={PADDING.left}
          y1={toY(seasonAvg)}
          x2={800 - PADDING.right}
          y2={toY(seasonAvg)}
          stroke="#bf5af2"
          strokeWidth={1.5}
          strokeDasharray="6 4"
          strokeOpacity={0.7}
        />
        <text
          x={800 - PADDING.right + 4}
          y={toY(seasonAvg) + 4}
          fill="#bf5af2"
          fontSize={10}
          fontFamily="var(--font-geist-mono)"
        >
          Avg {seasonAvg.toFixed(1)}
        </text>

        {/* Betting line reference */}
        {bettingLine != null && (
          <>
            <line
              x1={PADDING.left}
              y1={toY(bettingLine)}
              x2={800 - PADDING.right}
              y2={toY(bettingLine)}
              stroke="#ff6b35"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
            <text
              x={PADDING.left + 4}
              y={toY(bettingLine) - 6}
              fill="#ff6b35"
              fontSize={10}
              fontFamily="var(--font-geist-mono)"
            >
              Line {bettingLine}
            </text>
          </>
        )}

        {/* Area fill */}
        {data.length > 1 && (() => {
          const chartWidth = 800 - PADDING.left - PADDING.right;
          const step = chartWidth / (data.length - 1);
          const areaPath = data
            .map((v, i) => {
              const x = PADDING.left + i * step;
              const y = toY(v);
              return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
            })
            .join(' ');
          const lastX = PADDING.left + (data.length - 1) * step;
          const bottomY = CHART_HEIGHT - PADDING.bottom;
          return (
            <path
              d={`${areaPath} L ${lastX} ${bottomY} L ${PADDING.left} ${bottomY} Z`}
              fill="url(#betting-trend-fill)"
            />
          );
        })()}

        {/* Main line */}
        {data.length > 1 && (() => {
          const chartWidth = 800 - PADDING.left - PADDING.right;
          const step = chartWidth / (data.length - 1);
          const pathD = data
            .map((v, i) => {
              const x = PADDING.left + i * step;
              const y = toY(v);
              return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
            })
            .join(' ');
          return (
            <path
              d={pathD}
              fill="none"
              stroke="#00d4ff"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })()}

        {/* Data points */}
        {data.map((v, i) => {
          const chartWidth = 800 - PADDING.left - PADDING.right;
          const step = chartWidth / Math.max(data.length - 1, 1);
          const x = PADDING.left + i * step;
          const y = toY(v);
          const isHovered = hoveredIndex === i;
          const overLine = bettingLine != null && v > bettingLine;
          const dotColor = bettingLine != null ? (overLine ? '#39ff14' : '#ff4757') : '#00d4ff';

          return (
            <g key={i}>
              <circle cx={x} cy={y} r={isHovered ? 6 : 3.5} fill={dotColor} opacity={isHovered ? 1 : 0.85} />
              {isHovered && (
                <circle cx={x} cy={y} r={10} fill={dotColor} opacity={0.2} />
              )}
            </g>
          );
        })}

        {/* X-axis labels */}
        {labels.map((label, i) => {
          const chartWidth = 800 - PADDING.left - PADDING.right;
          const step = chartWidth / Math.max(data.length - 1, 1);
          const x = PADDING.left + i * step;
          const showLabel = data.length <= 10 || i % Math.ceil(data.length / 10) === 0 || i === data.length - 1;
          if (!showLabel) return null;
          return (
            <text
              key={i}
              x={x}
              y={CHART_HEIGHT - 8}
              textAnchor="middle"
              fill="white"
              fillOpacity={0.3}
              fontSize={10}
              fontFamily="var(--font-geist-mono)"
            >
              {label}
            </text>
          );
        })}

        {/* Hover vertical line */}
        {hoveredIndex !== null && (() => {
          const chartWidth = 800 - PADDING.left - PADDING.right;
          const step = chartWidth / Math.max(data.length - 1, 1);
          const x = PADDING.left + hoveredIndex * step;
          return (
            <line
              x1={x}
              y1={PADDING.top}
              x2={x}
              y2={CHART_HEIGHT - PADDING.bottom}
              stroke="white"
              strokeOpacity={0.12}
              strokeDasharray="3 3"
            />
          );
        })()}
      </svg>

      {/* Tooltip */}
      {hoveredIndex !== null && (
        <div className="flex items-center gap-4 mt-3 px-1 text-sm font-mono">
          <span className="font-bold text-[#00d4ff] text-lg">
            {data[hoveredIndex]}
          </span>
          <span className="text-muted-foreground">{metricLabel}</span>
          <span className="text-muted-foreground">vs {labels[hoveredIndex] ?? '—'}</span>
          <span className="text-xs text-muted-foreground/60">(Game {hoveredIndex + 1} of {data.length})</span>
        </div>
      )}
    </div>
  );
}
