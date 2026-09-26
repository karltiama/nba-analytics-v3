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
  Lock,
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
            <h4 className="type-card-data min-w-0 truncate text-[#063f46]">{insight.title}</h4>
          </div>
          <p className="type-body text-cc-secondary">
            {insight.description}
          </p>
          <div className="type-metadata mt-2">
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
            <h3 className="type-section-heading text-[#063f46]">AI Insights</h3>
            <p className="type-metadata">Slate + analytics signals</p>
          </div>
        </div>
        {slateSummaryLoading ? null : slateEntitlementRequired ? (
          <span className="type-badge rounded-md border border-[#DCE9EA] bg-[#F8FBFA] px-2 py-0.5 text-[#075B5C]">
            Requires Founding Pro
          </span>
        ) : briefingEligible && slateSummary ? (
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#20B95A] pulse-dot" />
            <span className="type-badge text-[#20B95A]">LIVE</span>
          </div>
        ) : (
          <span className="type-badge text-cc-secondary">Unavailable</span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {/* LLM slate summary */}
        <div className="p-3 pb-3 border-b border-[#DCE9EA] flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-[#075B5C]" />
            <span className="type-secondary">Slate summary</span>
          </div>
          {slateSummaryLoading ? (
            <div className="type-secondary flex items-center gap-2 py-3">
              <Loader2 className="w-4 h-4 animate-spin text-[#075B5C] shrink-0" />
              Loading briefing…
            </div>
          ) : slateSummary ? (
            <p className="type-body whitespace-pre-wrap text-[#063f46]">
              {slateSummary}
            </p>
          ) : slateEntitlementRequired ? (
            <div className="rounded-xl border border-[#DCE9EA] bg-[#F8FBFA] p-3 space-y-3">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 rounded-lg border border-[#DCE9EA] bg-white p-1.5 shrink-0">
                  <Lock className="h-3.5 w-3.5 text-[#075B5C]" aria-hidden />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="type-section-heading text-[#063f46]">AI research briefing</p>
                  <p className="type-body text-cc-secondary">
                    This slate briefing is a Founding Pro feature. Free keeps the full research workflow;
                    Founding Pro adds a synthesized summary from the context you already see.
                  </p>
                </div>
              </div>
              <FoundingProUpgradeLink
                analyticsSurface="slate_briefing"
                className="w-full bg-[#063f46] from-[#063f46] to-[#063f46] hover:bg-[#0a525c]"
              >
                Unlock with Founding Pro
              </FoundingProUpgradeLink>
            </div>
          ) : (
            <p className="type-body py-1 text-cc-secondary">
              {slateSummaryHint || 'Briefing unavailable during offseason'}
            </p>
          )}
        </div>

      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-[#DCE9EA] bg-[#F8FBFA] shrink-0">
        <p className="type-metadata text-center">
          Slate text via OpenAI (cached) • Does not produce numerical projections •{' '}
          <span className="text-[#075B5C]">Not betting advice</span>
        </p>
      </div>
    </div>
  );
}






























