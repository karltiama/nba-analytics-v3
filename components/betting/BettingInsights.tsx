'use client';

import { AlertCircle, Zap, Shield, TrendingUp, BarChart2, Activity } from 'lucide-react';

interface InsightWidget {
  id: string;
  title: string;
  value: string;
  description: string;
  type: 'upset' | 'pace' | 'defense' | 'props' | 'disagreement' | 'general';
  change?: string;
  changeDirection?: 'up' | 'down';
}

interface BettingInsightsProps {
  widgets: InsightWidget[];
}

function getWidgetConfig(type: InsightWidget['type']) {
  switch (type) {
    case 'upset':
      return {
        icon: <AlertCircle className="w-5 h-5" />,
        color: '#ff4757',
        bgColor: 'rgba(255, 71, 87, 0.1)',
      };
    case 'pace':
      return {
        icon: <Zap className="w-5 h-5" />,
        color: '#075B5C',
        bgColor: 'rgba(85, 221, 177, 0.2)',
      };
    case 'defense':
      return {
        icon: <Shield className="w-5 h-5" />,
        color: '#20B95A',
        bgColor: 'rgba(32, 185, 90, 0.12)',
      };
    case 'props':
      return {
        icon: <TrendingUp className="w-5 h-5" />,
        color: '#d97706',
        bgColor: 'rgba(217, 119, 6, 0.12)',
      };
    case 'disagreement':
      return {
        icon: <BarChart2 className="w-5 h-5" />,
        color: '#063f46',
        bgColor: 'rgba(6, 63, 70, 0.08)',
      };
    case 'general':
    default:
      return {
        icon: <Activity className="w-5 h-5" />,
        color: '#72869A',
        bgColor: 'rgba(114, 134, 154, 0.12)',
      };
  }
}

function InsightWidgetCard({ widget }: { widget: InsightWidget }) {
  const config = getWidgetConfig(widget.type);
  
  return (
    <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-4">
      <div className="flex items-start justify-between mb-3">
        <div 
          className="p-2.5 rounded-xl"
          style={{ backgroundColor: config.bgColor }}
        >
          <div style={{ color: config.color }}>{config.icon}</div>
        </div>
        {widget.change && (
          <div className={`flex items-center gap-1 text-xs font-medium ${
            widget.changeDirection === 'up' ? 'text-[#20B95A]' : 'text-red-600'
          }`}>
            {widget.changeDirection === 'up' ? '↑' : '↓'} {widget.change}
          </div>
        )}
      </div>
      
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-[#4a6366]">{widget.title}</h4>
        <div className="text-2xl font-bold" style={{ color: config.color }}>
          {widget.value}
        </div>
        <p className="text-xs text-[#4a6366] leading-relaxed">
          {widget.description}
        </p>
      </div>
    </div>
  );
}

export function BettingInsights({ widgets }: BettingInsightsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#063f46]">Betting Model Insights</h2>
        <span className="text-xs text-[#4a6366]">Updated 2m ago</span>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {widgets.map((widget) => (
          <InsightWidgetCard key={widget.id} widget={widget} />
        ))}
      </div>
    </div>
  );
}

