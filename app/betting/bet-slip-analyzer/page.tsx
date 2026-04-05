'use client';

import { useCallback, useMemo, useState, type ComponentProps } from 'react';
import Link from 'next/link';
import { Loader2, RefreshCw } from 'lucide-react';
import { getTodayET } from '@/components/betting';
import { UploadPanel } from '@/components/betting/bet-slip/UploadPanel';
import {
  ReviewEditor,
  emptyEditableSlip,
  type EditableSlip,
} from '@/components/betting/bet-slip/ReviewEditor';
import { AnalysisResults } from '@/components/betting/bet-slip/AnalysisResults';
import type { BetSlipExtraction } from '@/lib/betting/bet-slip/schema';

function parseOptionalNumber(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function extractionToEditable(e: BetSlipExtraction): EditableSlip {
  const legs =
    e.legs.length > 0
      ? e.legs.map((l) => ({
          clientId:
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `leg-${Math.random()}`,
          player_name: l.player_name,
          prop_type: l.prop_type,
          side: l.side,
          line: String(l.line),
          odds_american: l.odds_american != null ? String(l.odds_american) : '',
          resolved_player_id: '',
        }))
      : emptyEditableSlip().legs;

  return {
    sportsbook: e.sportsbook ?? '',
    bet_type: e.bet_type,
    total_odds_american: e.total_odds_american != null ? String(e.total_odds_american) : '',
    total_odds_decimal: e.total_odds_decimal != null ? String(e.total_odds_decimal) : '',
    legs,
  };
}

export default function BetSlipAnalyzerPage() {
  const defaultDate = useMemo(() => getTodayET(), []);
  const [slateDate, setSlateDate] = useState(defaultDate);

  const [parseLoading, setParseLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploadHint, setUploadHint] = useState<string | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [slip, setSlip] = useState<EditableSlip>(() => emptyEditableSlip());
  const [hasExtraction, setHasExtraction] = useState(false);

  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<{
    legs: ComponentProps<typeof AnalysisResults>['legs'];
    parlay: ComponentProps<typeof AnalysisResults>['parlay'];
  } | null>(null);

  const ambiguousHints = useMemo(() => {
    if (!analysis?.legs) return [];
    return analysis.legs
      .filter(
        (l) =>
          l.matchStatus === 'ambiguous' &&
          l.ambiguousCandidates &&
          l.ambiguousCandidates.length > 0
      )
      .map((l) => ({ index: l.index, candidates: l.ambiguousCandidates! }));
  }, [analysis]);

  const handleFile = useCallback(async (file: File) => {
    setUploadHint(null);
    setParseError(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setUploadHint('Use JPEG, PNG, or WebP.');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setUploadHint('File is too large (max 6 MB).');
      return;
    }

    setParseLoading(true);
    setAnalysis(null);
    setAnalyzeError(null);
    try {
      const fd = new FormData();
      fd.set('image', file);
      const res = await fetch('/api/betting/bet-slip/parse', {
        method: 'POST',
        body: fd,
      });
      const j = (await res.json().catch(() => ({}))) as {
        extraction?: BetSlipExtraction;
        error?: string;
        code?: string;
      };
      if (res.status === 503 && j?.code === 'NO_OPENAI_KEY') {
        setParseError('OpenAI is not configured. Set OPENAI_API_KEY on the server.');
        return;
      }
      if (!res.ok) {
        setParseError(j?.error ?? 'Parse failed');
        return;
      }
      if (!j.extraction) {
        setParseError('No extraction returned');
        return;
      }
      setSlip(extractionToEditable(j.extraction));
      setNeedsReview(Boolean(j.extraction.needs_review));
      setHasExtraction(true);
      if (!j.extraction.legs.length) {
        setParseError('No legs found — add legs manually below or try a clearer screenshot.');
      }
    } catch {
      setParseError('Network error while parsing');
    } finally {
      setParseLoading(false);
    }
  }, []);

  const runAnalyze = useCallback(async () => {
    setAnalyzeError(null);
    const legsPayload = slip.legs.map((l) => {
      const line = parseOptionalNumber(l.line);
      const odds = parseOptionalNumber(l.odds_american);
      return {
        player_name: l.player_name.trim(),
        prop_type: l.prop_type.trim(),
        side: l.side,
        line,
        odds_american: odds,
        resolved_player_id: l.resolved_player_id.trim() || undefined,
      };
    });

    for (let i = 0; i < legsPayload.length; i++) {
      const leg = legsPayload[i]!;
      if (!leg.player_name) {
        setAnalyzeError(`Leg ${i + 1}: player name is required.`);
        return;
      }
      if (!leg.prop_type) {
        setAnalyzeError(`Leg ${i + 1}: prop type is required.`);
        return;
      }
      if (leg.line == null) {
        setAnalyzeError(`Leg ${i + 1}: line must be a valid number.`);
        return;
      }
    }

    setAnalyzeLoading(true);
    try {
      const res = await fetch('/api/betting/bet-slip/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: slateDate,
          sportsbook: slip.sportsbook.trim() || null,
          bet_type: slip.bet_type,
          total_odds_american: parseOptionalNumber(slip.total_odds_american),
          total_odds_decimal: parseOptionalNumber(slip.total_odds_decimal),
          legs: legsPayload,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        legs?: ComponentProps<typeof AnalysisResults>['legs'];
        parlay?: ComponentProps<typeof AnalysisResults>['parlay'];
        error?: string;
      };
      if (!res.ok) {
        setAnalyzeError(j?.error ?? 'Analysis failed');
        return;
      }
      if (!j.legs || !j.parlay) {
        setAnalyzeError('Invalid analysis response');
        return;
      }
      setAnalysis({ legs: j.legs, parlay: j.parlay });
    } catch {
      setAnalyzeError('Network error during analysis');
    } finally {
      setAnalyzeLoading(false);
    }
  }, [slateDate, slip]);

  const resetAll = useCallback(() => {
    setSlip(emptyEditableSlip());
    setHasExtraction(false);
    setNeedsReview(false);
    setParseError(null);
    setUploadHint(null);
    setAnalyzeError(null);
    setAnalysis(null);
    setSlateDate(getTodayET());
  }, []);

  return (
    <main className="max-w-[900px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-12">
      <div className="mb-8">
        <p className="text-xs text-muted-foreground mb-1">
          <Link href="/betting" className="hover:text-[#00d4ff]">
            Dashboard
          </Link>
          <span className="mx-1">/</span>
          Bet slip analyzer
        </p>
        <h1 className="text-2xl font-bold text-white tracking-tight">Bet slip analyzer</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Upload a screenshot, fix any parsing mistakes, then run the same EV and projection model as Props
          Explorer — including parlay-level estimates (independent legs).
        </p>
      </div>

      <section className="rounded-xl border border-white/10 bg-secondary/20 p-5 space-y-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 justify-between">
          <label className="flex flex-col gap-1 text-sm max-w-xs">
            <span className="text-muted-foreground">Slate date (ET)</span>
            <input
              type="date"
              className="rounded-lg bg-secondary/80 border border-white/10 px-3 py-2 text-white"
              value={slateDate}
              onChange={(e) => setSlateDate(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
            Reset
          </button>
        </div>

        <UploadPanel
          disabled={parseLoading}
          onFile={handleFile}
          error={uploadHint || parseError}
        />
        {parseLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin text-[#00d4ff]" />
            Parsing screenshot…
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-white/10 bg-secondary/20 p-5 space-y-4 mb-6">
        <h2 className="text-lg font-semibold text-white">Review & edit</h2>
        <p className="text-sm text-muted-foreground">
          Correct any misread names, lines, or odds before analysis. Add or remove legs for parlays.
        </p>
        <ReviewEditor
          value={slip}
          onChange={setSlip}
          needsReview={needsReview && hasExtraction}
          ambiguousHints={ambiguousHints}
        />
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            onClick={runAnalyze}
            disabled={analyzeLoading || slip.legs.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#00d4ff] to-[#bf5af2] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {analyzeLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing…
              </>
            ) : (
              'Run analysis'
            )}
          </button>
        </div>
        {analyzeError ? <p className="text-sm text-red-400">{analyzeError}</p> : null}
      </section>

      {analysis ? (
        <section className="rounded-xl border border-white/10 bg-secondary/20 p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Results</h2>
          <AnalysisResults slip={slip} legs={analysis.legs} parlay={analysis.parlay} />
        </section>
      ) : null}
    </main>
  );
}
