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
        color: '#00d4ff',
        bgColor: 'rgba(0, 212, 255, 0.1)',
      };
    case 'defense':
      return {
        icon: <Shield className="w-5 h-5" />,
        color: '#39ff14',
        bgColor: 'rgba(57, 255, 20, 0.1)',
      };
    case 'props':
      return {
        icon: <TrendingUp className="w-5 h-5" />,
        color: '#ff6b35',
        bgColor: 'rgba(255, 107, 53, 0.1)',
      };
    case 'disagreement':
      return {
        icon: <BarChart2 className="w-5 h-5" />,
        color: '#bf5af2',
        bgColor: 'rgba(191, 90, 242, 0.1)',
      };
    case 'general':
    default:
      return {
        icon: <Activity className="w-5 h-5" />,
        color: '#8888a0',
        bgColor: 'rgba(136, 136, 160, 0.1)',
      };
  }
}

function InsightWidgetCard({ widget }: { widget: InsightWidget }) {
  const config = getWidgetConfig(widget.type);
  
  return (
    <div className="glass-card rounded-xl p-4 card-hover">
      <div className="flex items-start justify-between mb-3">
        <div 
          className="p-2.5 rounded-xl"
          style={{ backgroundColor: config.bgColor }}
        >
          <div style={{ color: config.color }}>{config.icon}</div>
        </div>
        {widget.change && (
          <div className={`flex items-center gap-1 text-xs font-medium ${
            widget.changeDirection === 'up' ? 'text-[#39ff14]' : 'text-[#ff4757]'
          }`}>
            {widget.changeDirection === 'up' ? '↑' : '↓'} {widget.change}
          </div>
        )}
      </div>
      
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-muted-foreground">{widget.title}</h4>
        <div className="text-2xl font-bold" style={{ color: config.color }}>
          {widget.value}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
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
        <h2 className="text-lg font-semibold text-white">Betting Model Insights</h2>
        <span className="text-xs text-muted-foreground">Updated 2m ago</span>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {widgets.map((widget) => (
          <InsightWidgetCard key={widget.id} widget={widget} />
        ))}
      </div>
    </div>
  );
}

