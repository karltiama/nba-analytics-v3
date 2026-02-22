'use client';

interface TrendSparklineProps {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  showDots?: boolean;
  lineWidth?: number;
}

export function TrendSparkline({ 
  data, 
  color = '#00d4ff', 
  height = 24, 
  width = 80,
  showDots = true,
  lineWidth = 2
}: TrendSparklineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  
  const padding = 4;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1)) * chartWidth;
    const y = padding + chartHeight - ((value - min) / range) * chartHeight;
    return { x, y, value };
  });

  const pathD = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  // Determine trend
  const firstHalf = data.slice(0, Math.ceil(data.length / 2));
  const secondHalf = data.slice(Math.ceil(data.length / 2));
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const isUptrend = secondAvg > firstAvg;

  const trendColor = isUptrend ? '#39ff14' : '#ff4757';
  const actualColor = color === 'auto' ? trendColor : color;

  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* Gradient definition */}
      <defs>
        <linearGradient id={`sparkline-gradient-${actualColor.replace('#', '')}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={actualColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={actualColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      
      {/* Area fill */}
      <path
        d={`${pathD} L ${points[points.length - 1].x} ${height - padding} L ${padding} ${height - padding} Z`}
        fill={`url(#sparkline-gradient-${actualColor.replace('#', '')})`}
      />
      
      {/* Line */}
      <path
        d={pathD}
        fill="none"
        stroke={actualColor}
        strokeWidth={lineWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      
      {/* Dots */}
      {showDots && (
        <>
          {/* Last point highlighted */}
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r={3}
            fill={actualColor}
          />
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r={5}
            fill={actualColor}
            opacity={0.3}
          />
        </>
      )}
    </svg>
  );
}






























