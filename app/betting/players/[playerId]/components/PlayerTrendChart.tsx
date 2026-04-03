'use client';

import { useState, useRef, useCallback, type ReactNode } from 'react';

interface PlayerTrendChartProps {
  data: number[];
  seasonAvg: number;
  labels: string[];
  bettingLine?: number | null;
  metricLabel: string;
  children?: ReactNode;
  /** Default 540. Use ~300–360 for narrow sidebars. */
  svgWidth?: number;
  /** Default 220. */
  chartHeight?: number;
  /** Chart + legend only: no hover hint column or “Hover to see…” placeholder (e.g. Props Explorer sidebar). */
  compactTrend?: boolean;
}

const DEFAULT_CHART_HEIGHT = 220;
const PADDING = { top: 24, right: 56, bottom: 44, left: 56 };
const DEFAULT_SVG_WIDTH = 540;

export function PlayerTrendChart({
  data,
  seasonAvg,
  labels,
  bettingLine,
  metricLabel,
  children,
  svgWidth: svgWidthProp,
  chartHeight: chartHeightProp,
  compactTrend = false,
}: PlayerTrendChartProps) {
  const CHART_HEIGHT = chartHeightProp ?? DEFAULT_CHART_HEIGHT;
  const svgWidth = svgWidthProp ?? DEFAULT_SVG_WIDTH;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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
      <div
        className="glass-card rounded-xl p-8 flex items-center justify-center"
        style={{ minHeight: CHART_HEIGHT + 60 }}
      >
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
      <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Trend Chart
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#bf5af2] rounded-full inline-block" />
            Season Avg
          </span>
          {bettingLine != null && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#ff6b35] rounded-full inline-block" />
              Line {bettingLine}
            </span>
          )}
        </div>
      </div>
      <div
        className={
          compactTrend
            ? 'p-3 flex flex-col gap-2'
            : 'p-4 flex flex-col lg:flex-row lg:items-start gap-4'
        }
      >
        {/* Chart SVG — fixed width, shrinks on small screens */}
        <div
          className={
            compactTrend
              ? 'w-full min-w-0 flex flex-col items-center'
              : 'w-full min-w-0 lg:w-auto lg:shrink-0 flex flex-col items-center lg:items-start'
          }
        >
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
            <linearGradient id="betting-trend-fill" x1="0%" y1="0%" x2="0%" y2="100%">
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

          {bettingLine != null && (
            <>
              <line
                x1={PADDING.left}
                y1={toY(bettingLine)}
                x2={svgWidth - PADDING.right}
                y2={toY(bettingLine)}
                stroke="#ff6b35"
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />
              <text
                x={PADDING.left + 4}
                y={toY(bettingLine) - 6}
                fill="#ff6b35"
                fontSize={11}
                fontFamily="var(--font-geist-mono)"
              >
                Line {bettingLine}
              </text>
            </>
          )}

          {data.length > 1 && (() => {
            const areaPath = data
              .map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(v)}`)
              .join(' ');
            const bottomY = CHART_HEIGHT - PADDING.bottom;
            return (
              <path
                d={`${areaPath} L ${toX(data.length - 1)} ${bottomY} L ${PADDING.left} ${bottomY} Z`}
                fill="url(#betting-trend-fill)"
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
            const overLine = bettingLine != null && v > bettingLine;
            const dotColor = bettingLine != null ? (overLine ? '#39ff14' : '#ff4757') : '#00d4ff';

            return (
              <g key={i}>
                <circle cx={x} cy={y} r={isHighlighted ? 6 : 3.5} fill={dotColor} opacity={isHighlighted ? 1 : 0.85} />
                {isHighlighted && (
                  <circle cx={x} cy={y} r={10} fill={dotColor} opacity={0.2} />
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

          {/* Game details — below chart on small/medium screens */}
          {!compactTrend && (
            <div className="lg:hidden mt-2 min-h-[28px]">
              {displayIndex !== null && (
                <div className="flex items-center gap-3 text-sm font-mono">
                  <span className="font-bold text-[#00d4ff] text-lg">{data[displayIndex]}</span>
                  <span className="text-muted-foreground">{metricLabel}</span>
                  <span className="text-muted-foreground">vs {labels[displayIndex] ?? '—'}</span>
                  <span className="text-xs text-muted-foreground/60">(Game {displayIndex + 1}/{data.length})</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right panel — hover info + children (line analysis) on lg+ */}
        {!compactTrend && (
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            {/* Game details — right of chart on lg+, fixed height; click point to pin */}
            <div className="hidden lg:block h-20">
              {displayIndex !== null ? (
                <div className="relative p-2 rounded-lg bg-white/5 font-mono h-full flex flex-col justify-center items-center text-center min-w-0 gap-0.5">
                  {pinnedIndex !== null && (
                    <button
                      type="button"
                      onClick={() => setPinnedIndex(null)}
                      className="absolute top-1.5 right-1.5 text-[10px] text-muted-foreground/60 hover:text-white transition-colors"
                    >
                      Unpin
                    </button>
                  )}
                  <div className="text-xl font-bold text-[#00d4ff] leading-tight">{data[displayIndex]} {metricLabel}</div>
                  <div className="text-sm text-muted-foreground w-full">
                    Opponent: {labels[displayIndex] ?? '—'}
                  </div>
                  <div className="text-xs text-muted-foreground/60">
                    Game {displayIndex + 1} of {data.length}
                  </div>
                </div>
              ) : (
                <div className="p-2 rounded-lg bg-white/5 h-full flex items-center justify-center">
                  <span className="text-base text-muted-foreground/50">
                    Hover to see {metricLabel} value, opponent and game number
                  </span>
                </div>
              )}
            </div>

            {children}
          </div>
        )}
        {compactTrend && children ? <div className="min-w-0">{children}</div> : null}
      </div>
    </div>
  );
}
