'use client';

import { Zap, TrendingUp, AlertTriangle, Target, DollarSign, Activity } from 'lucide-react';

export interface Insight {
  id: string;
  type: 'pace' | 'trend' | 'sharp' | 'injury' | 'value' | 'general';
  title: string;
  description: string;
  timestamp: string;
  importance: 'high' | 'medium' | 'low';
}

interface AIInsightPanelProps {
  insights: Insight[];
}

function getInsightIcon(type: Insight['type']) {
  switch (type) {
    case 'pace':
      return <Activity className="w-4 h-4 text-[#00d4ff]" />;
    case 'trend':
      return <TrendingUp className="w-4 h-4 text-[#39ff14]" />;
    case 'sharp':
      return <DollarSign className="w-4 h-4 text-[#ff6b35]" />;
    case 'injury':
      return <AlertTriangle className="w-4 h-4 text-[#ff4757]" />;
    case 'value':
      return <Target className="w-4 h-4 text-[#bf5af2]" />;
    default:
      return <Zap className="w-4 h-4 text-[#00d4ff]" />;
  }
}

function getImportanceDot(importance: Insight['importance']) {
  const colors = {
    high: 'bg-[#ff4757]',
    medium: 'bg-[#ff6b35]',
    low: 'bg-[#39ff14]'
  };
  return colors[importance];
}

function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div className="p-3 rounded-lg bg-white/[0.03] hover:bg-white/[0.05] transition-colors border border-white/5 slide-up">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-white/5 shrink-0">
          {getInsightIcon(insight.type)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-1.5 h-1.5 rounded-full ${getImportanceDot(insight.importance)}`} />
            <h4 className="text-sm font-medium text-white truncate">{insight.title}</h4>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {insight.description}
          </p>
          <div className="mt-2 text-[10px] text-muted-foreground/60">
            {insight.timestamp}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AIInsightPanel({ insights }: AIInsightPanelProps) {
  return (
    <div className="glass-card rounded-xl overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#bf5af2]/20">
            <Zap className="w-4 h-4 text-[#bf5af2]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">AI Insights</h3>
            <p className="text-[10px] text-muted-foreground">Real-time analysis</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#39ff14] pulse-dot" />
          <span className="text-[10px] text-[#39ff14] font-medium">LIVE</span>
        </div>
      </div>

      {/* Insights List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {insights.map((insight) => (
          <InsightCard key={insight.id} insight={insight} />
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-white/5 bg-white/[0.02]">
        <p className="text-[10px] text-muted-foreground text-center">
          Insights updated every 30 seconds • <span className="text-[#00d4ff]">Powered by AI</span>
        </p>
      </div>
    </div>
  );
}



















