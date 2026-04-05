'use client';

import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type EditableLeg = {
  clientId: string;
  player_name: string;
  prop_type: string;
  side: 'over' | 'under';
  line: string;
  odds_american: string;
  resolved_player_id: string;
};

export type EditableSlip = {
  sportsbook: string;
  bet_type: 'single' | 'parlay';
  total_odds_american: string;
  total_odds_decimal: string;
  legs: EditableLeg[];
};

type AmbiguousHint = {
  index: number;
  candidates: Array<{ playerId: string; fullName: string }>;
};

type ReviewEditorProps = {
  value: EditableSlip;
  onChange: (next: EditableSlip) => void;
  needsReview?: boolean;
  ambiguousHints?: AmbiguousHint[];
};

function newLeg(): EditableLeg {
  return {
    clientId:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `leg-${Date.now()}-${Math.random()}`,
    player_name: '',
    prop_type: 'points',
    side: 'over',
    line: '20.5',
    odds_american: '',
    resolved_player_id: '',
  };
}

export function ReviewEditor({ value, onChange, needsReview, ambiguousHints }: ReviewEditorProps) {
  const ambByIndex = new Map(ambiguousHints?.map((h) => [h.index, h.candidates]) ?? []);

  const updateLeg = (i: number, patch: Partial<EditableLeg>) => {
    const legs = value.legs.map((l, j) => (j === i ? { ...l, ...patch } : l));
    if (patch.player_name !== undefined || patch.prop_type !== undefined) {
      legs[i] = { ...legs[i]!, resolved_player_id: '' };
    }
    onChange({ ...value, legs });
  };

  return (
    <div className="space-y-4">
      {needsReview ? (
        <p className="text-sm rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 px-3 py-2">
          Parser flagged this slip for review — double-check every leg before running analysis.
        </p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Sportsbook</span>
          <input
            className="rounded-lg bg-secondary/80 border border-white/10 px-3 py-2 text-white"
            value={value.sportsbook}
            onChange={(e) => onChange({ ...value, sportsbook: e.target.value })}
            placeholder="e.g. DraftKings"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Bet type</span>
          <select
            className="rounded-lg bg-secondary/80 border border-white/10 px-3 py-2 text-white"
            value={value.bet_type}
            onChange={(e) =>
              onChange({ ...value, bet_type: e.target.value as 'single' | 'parlay' })
            }
          >
            <option value="single">Single</option>
            <option value="parlay">Parlay</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Total odds (American)</span>
          <input
            className="rounded-lg bg-secondary/80 border border-white/10 px-3 py-2 text-white"
            value={value.total_odds_american}
            onChange={(e) => onChange({ ...value, total_odds_american: e.target.value })}
            placeholder="+800 or -150"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Total odds (decimal)</span>
          <input
            className="rounded-lg bg-secondary/80 border border-white/10 px-3 py-2 text-white"
            value={value.total_odds_decimal}
            onChange={(e) => onChange({ ...value, total_odds_decimal: e.target.value })}
            placeholder="9.0"
          />
        </label>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Legs</h3>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-[#00d4ff] hover:underline"
          onClick={() => onChange({ ...value, legs: [...value.legs, newLeg()] })}
        >
          <Plus className="w-3.5 h-3.5" />
          Add leg
        </button>
      </div>

      <div className="space-y-3">
        {value.legs.map((leg, i) => {
          const amb = ambByIndex.get(i);
          return (
            <div
              key={leg.clientId}
              className={cn(
                'rounded-xl border border-white/10 bg-secondary/30 p-4 space-y-3',
                amb && amb.length > 0 && 'border-amber-500/40'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Leg {i + 1}</span>
                <button
                  type="button"
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                  aria-label="Remove leg"
                  onClick={() => {
                    if (value.legs.length <= 1) return;
                    onChange({ ...value, legs: value.legs.filter((_, j) => j !== i) });
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {amb && amb.length > 0 ? (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-amber-200/90">Multiple roster matches — pick the player</span>
                  <select
                    className="rounded-lg bg-secondary/80 border border-amber-500/30 px-3 py-2 text-white"
                    value={leg.resolved_player_id}
                    onChange={(e) => updateLeg(i, { resolved_player_id: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {amb.map((c) => (
                      <option key={c.playerId} value={c.playerId}>
                        {c.fullName} ({c.playerId})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  <span className="text-muted-foreground">Player name</span>
                  <input
                    className="rounded-lg bg-secondary/80 border border-white/10 px-3 py-2 text-white"
                    value={leg.player_name}
                    onChange={(e) => updateLeg(i, { player_name: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Prop</span>
                  <input
                    className="rounded-lg bg-secondary/80 border border-white/10 px-3 py-2 text-white"
                    value={leg.prop_type}
                    onChange={(e) => updateLeg(i, { prop_type: e.target.value })}
                    placeholder="points, threes, PRA…"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Side</span>
                  <select
                    className="rounded-lg bg-secondary/80 border border-white/10 px-3 py-2 text-white"
                    value={leg.side}
                    onChange={(e) =>
                      updateLeg(i, { side: e.target.value as 'over' | 'under' })
                    }
                  >
                    <option value="over">Over</option>
                    <option value="under">Under</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Line</span>
                  <input
                    className="rounded-lg bg-secondary/80 border border-white/10 px-3 py-2 text-white"
                    value={leg.line}
                    onChange={(e) => updateLeg(i, { line: e.target.value })}
                    inputMode="decimal"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Odds (American, optional)</span>
                  <input
                    className="rounded-lg bg-secondary/80 border border-white/10 px-3 py-2 text-white"
                    value={leg.odds_american}
                    onChange={(e) => updateLeg(i, { odds_american: e.target.value })}
                    placeholder="-110"
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function emptyEditableSlip(): EditableSlip {
  return {
    sportsbook: '',
    bet_type: 'parlay',
    total_odds_american: '',
    total_odds_decimal: '',
    legs: [newLeg()],
  };
}
