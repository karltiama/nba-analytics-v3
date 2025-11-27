'use client';

interface DataPoint {
  time: string;
  value: number;
}

interface LineMovementChartProps {
  data: DataPoint[];
  label: string;
  color?: string;
  height?: number;
}

export function LineMovementChart({ 
  data, 
  label, 
  color = '#00d4ff',
  height = 120 
}: LineMovementChartProps) {
  if (data.length < 2) return null;

  const values = data.map(d => d.value);
  const min = Math.min(...values) - 0.5;
  const max = Math.max(...values) + 0.5;
  const range = max - min || 1;

  const padding = { top: 20, right: 40, bottom: 30, left: 10 };
  const width = 280;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = data.map((d, index) => {
    const x = padding.left + (index / (data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - ((d.value - min) / range) * chartHeight;
    return { x, y, ...d };
  });

  const pathD = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  // Calculate opening vs current change
  const openingValue = data[0].value;
  const currentValue = data[data.length - 1].value;
  const change = currentValue - openingValue;
  const changeColor = change > 0 ? '#39ff14' : change < 0 ? '#ff4757' : '#8888a0';

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-white">{label}</h4>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Open: <span className="text-white font-mono">{openingValue > 0 ? `+${openingValue}` : openingValue}</span>
          </span>
          <span className="text-xs" style={{ color: changeColor }}>
            {change > 0 ? '+' : ''}{change.toFixed(1)}
          </span>
        </div>
      </div>

      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <linearGradient id={`line-gradient-${label.replace(/\s/g, '')}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
          const y = padding.top + chartHeight * ratio;
          const value = max - ratio * range;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="rgba(255,255,255,0.05)"
                strokeDasharray="2,2"
              />
              <text
                x={width - padding.right + 5}
                y={y + 3}
                fill="#8888a0"
                fontSize="9"
                fontFamily="monospace"
              >
                {value.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path
          d={`${pathD} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`}
          fill={`url(#line-gradient-${label.replace(/\s/g, '')})`}
        />

        {/* Line */}
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Current point */}
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={4}
          fill={color}
        />
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={8}
          fill={color}
          opacity={0.2}
        />

        {/* Time labels */}
        {points.filter((_, i) => i === 0 || i === points.length - 1).map((point, i) => (
          <text
            key={i}
            x={point.x}
            y={height - 8}
            fill="#8888a0"
            fontSize="9"
            textAnchor="middle"
          >
            {point.time}
          </text>
        ))}
      </svg>

      {/* Current Value */}
      <div className="mt-2 flex items-center justify-center gap-2">
        <span className="text-xs text-muted-foreground">Current:</span>
        <span className="text-lg font-mono font-bold" style={{ color }}>
          {currentValue > 0 ? `+${currentValue}` : currentValue}
        </span>
      </div>
    </div>
  );
}




