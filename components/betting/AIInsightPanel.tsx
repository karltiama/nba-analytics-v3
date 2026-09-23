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
import { FoundingProUpgradeLink } from '@/components/betting/FoundingProUpgradeLink';

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
  /** True when the user is Free and AI is Founding Pro. */
  slateEntitlementRequired?: boolean;
  /** False under freeze/offseason or when there is no current slate. */
  briefingEligible?: boolean;
}

function getInsightIcon(type: Insight['type']) {
  switch (type) {
    case 'pace':
      return <Activity className="w-4 h-4 text-[#075B5C]" />;
    case 'trend':
      return <TrendingUp className="w-4 h-4 text-[#20B95A]" />;
    case 'sharp':
      return <DollarSign className="w-4 h-4 text-amber-600" />;
    case 'injury':
      return <AlertTriangle className="w-4 h-4 text-red-600" />;
    case 'value':
      return <Target className="w-4 h-4 text-[#063f46]" />;
    default:
      return <Zap className="w-4 h-4 text-[#075B5C]" />;
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
    <div className="p-3 rounded-lg bg-[#F8FBFA] hover:bg-[#eef4f3] transition-colors border border-[#DCE9EA] slide-up">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-white border border-[#DCE9EA] shrink-0">
          {getInsightIcon(insight.type)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-1.5 h-1.5 rounded-full ${getImportanceDot(insight.importance)}`} />
            <h4 className="text-sm font-medium text-[#063f46] truncate">{insight.title}</h4>
          </div>
          <p className="text-xs text-[#4a6366] leading-relaxed">
            {insight.description}
          </p>
          <div className="mt-2 text-[10px] text-[#8aa0a3]">
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
  slateEntitlementRequired = false,
  briefingEligible = true,
}: AIInsightPanelProps) {
  void insights;
  return (
    <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-[70vh] max-h-[calc(100vh-5rem)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#DCE9EA] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#55ddb1]/25">
            <Zap className="w-4 h-4 text-[#075B5C]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#063f46]">AI Insights</h3>
            <p className="text-[10px] text-[#4a6366]">Slate + analytics signals</p>
          </div>
        </div>
        {slateSummaryLoading ? null : slateEntitlementRequired ? (
          <span className="text-[10px] text-[#075B5C] font-medium">Founding Pro</span>
        ) : briefingEligible && slateSummary ? (
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#20B95A] pulse-dot" />
            <span className="text-[10px] text-[#20B95A] font-medium">LIVE</span>
          </div>
        ) : (
          <span className="text-[10px] text-[#8aa0a3] font-medium">Unavailable</span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {/* LLM slate summary */}
        <div className="p-3 pb-3 border-b border-[#DCE9EA] flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-[#075B5C]" />
            <span className="text-[11px] font-medium text-[#063f46]">Slate summary</span>
          </div>
          {slateSummaryLoading ? (
            <div className="flex items-center gap-2 py-3 text-xs text-[#4a6366]">
              <Loader2 className="w-4 h-4 animate-spin text-[#075B5C] shrink-0" />
              Loading briefing…
            </div>
          ) : slateSummary ? (
            <p className="text-xs text-[#4a6366] leading-relaxed whitespace-pre-wrap">
              {slateSummary}
            </p>
          ) : slateEntitlementRequired ? (
            <div className="space-y-2 py-1">
              <p className="text-xs font-medium text-[#063f46]">AI research briefing — Founding Pro</p>
              <p className="text-xs text-[#4a6366]">
                Founding Pro adds a synthesized slate briefing from the research context you already see.
              </p>
              <FoundingProUpgradeLink
                analyticsSurface="slate_briefing"
                className="bg-[#063f46] from-[#063f46] to-[#063f46] hover:bg-[#0a525c]"
              />
            </div>
          ) : (
            <p className="text-xs text-[#8aa0a3] py-1">
              {slateSummaryHint || 'Briefing unavailable during offseason'}
            </p>
          )}
        </div>

      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-[#DCE9EA] bg-[#F8FBFA] shrink-0">
        <p className="text-[10px] text-[#4a6366] text-center">
          Slate text via OpenAI (cached) • Does not produce numerical projections •{' '}
          <span className="text-[#075B5C]">Not betting advice</span>
        </p>
      </div>
    </div>
  );
}






























