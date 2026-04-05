'use client';

import {
  Zap,
  TrendingUp,
  AlertTriangle,
  Target,
  DollarSign,
  Activity,
  Sparkles,
  Loader2,
} from 'lucide-react';

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
  /** OpenAI slate narrative for the selected ET date (analytics-backed context). */
  slateSummary?: string | null;
  slateSummaryLoading?: boolean;
  /** When summary is null: optional hint (e.g. missing API key). */
  slateSummaryHint?: string | null;
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

export function AIInsightPanel({
  insights,
  slateSummary = null,
  slateSummaryLoading = false,
  slateSummaryHint = null,
}: AIInsightPanelProps) {
  return (
    <div className="glass-card rounded-xl overflow-hidden flex flex-col max-h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#bf5af2]/20">
            <Zap className="w-4 h-4 text-[#bf5af2]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">AI Insights</h3>
            <p className="text-[10px] text-muted-foreground">Slate + analytics signals</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#39ff14] pulse-dot" />
          <span className="text-[10px] text-[#39ff14] font-medium">LIVE</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {/* LLM slate summary */}
        <div className="p-3 pb-0 shrink-0 border-b border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-[#bf5af2]" />
            <span className="text-[11px] font-medium text-white/90">Slate summary</span>
          </div>
          {slateSummaryLoading ? (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-[#00d4ff] shrink-0" />
              Generating summary…
            </div>
          ) : slateSummary ? (
            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {slateSummary}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/80 py-1">
              {slateSummaryHint ||
                'No AI summary for this slate. Add OPENAI_API_KEY on the server to enable.'}
            </p>
          )}
        </div>

        {/* Deterministic insight cards */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {insights.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4">No stat highlights yet.</p>
          ) : (
            insights.map((insight) => <InsightCard key={insight.id} insight={insight} />)
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-white/5 bg-white/[0.02] shrink-0">
        <p className="text-[10px] text-muted-foreground text-center">
          Stat cards from analytics DB • Slate text via OpenAI (cached) •{' '}
          <span className="text-[#00d4ff]">Not betting advice</span>
        </p>
      </div>
    </div>
  );
}






























