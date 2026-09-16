'use client';

import { Pencil } from 'lucide-react';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
import { TeamLogo } from '@/components/nba/TeamLogo';
import { formatAmericanOdds } from '@/lib/betting/market-movement-format';
import { extractionCounts } from '@/lib/parlay-xray/fields';
import { matchupDisplayFromLeg } from '@/lib/parlay-xray/matchup-display';
import { XRAY_PROP_KIND_LABEL, XRAY_PROP_KINDS } from '@/lib/parlay-xray/types';
import type { ExtractedParlayLeg, ParlayLegSide, XrayPropKind } from '@/lib/parlay-xray/types';
import { cn } from '@/lib/utils';

type ExtractedLegsPanelProps = {
  legs: ExtractedParlayLeg[];
  editing: boolean;
  extractionStatusLabel: string;
  canConfirm: boolean;
  confirmed: boolean;
  onToggleEditing: () => void;
  onEditLeg: (
    legId: string,
    edits: {
      playerDisplayName?: string;
      propKind?: XrayPropKind;
      side?: ParlayLegSide;
      line?: number | null;
      oddsAmerican?: number | null;
    }
  ) => void;
  onConfirm: () => void;
};

export function ExtractedLegsPanel({
  legs,
  editing,
  extractionStatusLabel,
  canConfirm,
  confirmed,
  onToggleEditing,
  onEditLeg,
  onConfirm,
}: ExtractedLegsPanelProps) {
  const counts = extractionCounts(legs);

  return (
    <section className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-5 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-bold text-[#063f46]">
            Extracted legs{counts.detected ? ` (${counts.detected})` : ''}
          </h2>
          <p className="text-xs text-[#4a6366] mt-1">{extractionStatusLabel}</p>
        </div>
        {counts.detected > 0 ? (
          <button
            type="button"
            onClick={onToggleEditing}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#075B5C] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/60 rounded"
            aria-pressed={editing}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {editing ? 'Done' : 'Edit'}
          </button>
        ) : null}
      </div>

      {counts.detected === 0 ? (
        <p className="text-sm text-[#4a6366] py-8 text-center">
          Extracted legs will appear here after a screenshot is read. Nothing is inferred from an unread image.
        </p>
      ) : (
        <ul className="space-y-3 flex-1">
          {legs.map((leg) => (
            <li key={leg.id}>
              {editing ? (
                <LegEditor leg={leg} onEdit={onEditLeg} />
              ) : (
                <LegRow leg={leg} />
              )}
            </li>
          ))}
        </ul>
      )}

      {counts.detected > 0 ? (
        <div className="mt-4 pt-4 border-t border-[#DCE9EA] space-y-2">
          <p className="text-xs text-[#4a6366]">
            {counts.detected} detected · {counts.resolved} resolved · {counts.needsConfirmation} need confirmation
            {counts.unresolved ? ` · ${counts.unresolved} unresolved` : ''}
          </p>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || confirmed}
            className="w-full rounded-lg bg-[#063f46] text-white text-sm font-semibold py-2.5 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#0a525c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/60"
          >
            {confirmed ? 'Legs confirmed' : 'Confirm legs'}
          </button>
          {!canConfirm ? (
            <p className="text-xs text-[#9a3412]">
              Confirm every highlighted field before analysis. Uncertain values stay marked until you verify them.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function LegRow({ leg }: { leg: ExtractedParlayLeg }) {
  const name = leg.playerDisplayName.value ?? 'Unknown player';
  const side = leg.side.value ? titleSide(leg.side.value) : '—';
  const line = leg.line.value != null ? String(leg.line.value) : '—';
  const prop = leg.propLabel.value ?? (leg.propKind.value ? XRAY_PROP_KIND_LABEL[leg.propKind.value] : '—');
  const odds = formatAmericanOdds(leg.oddsAmerican.status === 'known' ? leg.oddsAmerican.value : null);
  const uncertain = leg.resolution !== 'resolved';

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3 py-2.5',
        uncertain ? 'border-amber-300 bg-amber-50' : 'border-[#DCE9EA] bg-[#f7f9f7]'
      )}
    >
      <PlayerHeadshot
        nbaPlayerId={leg.nbaPlayerId.status === 'known' ? leg.nbaPlayerId.value : null}
        name={name}
        className="relative w-10 h-12 rounded-lg overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#063f46] truncate">{name}</p>
        <MatchupLine leg={leg} />
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-[#063f46]">
          {side} {line}
        </p>
        <p className="text-xs text-[#4a6366]">{prop}</p>
      </div>
      <p className="w-12 text-right text-sm tabular-nums text-[#063f46] shrink-0">{odds}</p>
      {uncertain ? (
        <span className="sr-only">Needs confirmation</span>
      ) : null}
    </div>
  );
}

function LegEditor({
  leg,
  onEdit,
}: {
  leg: ExtractedParlayLeg;
  onEdit: ExtractedLegsPanelProps['onEditLeg'];
}) {
  return (
    <div className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] p-3 space-y-2">
      <div className="flex items-start gap-3">
        <PlayerHeadshot
          nbaPlayerId={leg.nbaPlayerId.status === 'known' ? leg.nbaPlayerId.value : null}
          name={leg.playerDisplayName.value ?? 'Unknown player'}
          className="relative w-10 h-12 rounded-lg overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0"
        />
        <div className="min-w-0 flex-1">
          <Field
            label="Player"
            warning={leg.playerDisplayName.status !== 'known'}
            value={leg.playerDisplayName.value ?? ''}
            onChange={(value) => onEdit(leg.id, { playerDisplayName: value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-[#4a6366]">
          Prop
          <select
            className="rounded-lg border border-[#DCE9EA] bg-white px-2 py-1.5 text-sm text-[#063f46] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/60"
            value={leg.propKind.value ?? 'other'}
            onChange={(e) => onEdit(leg.id, { propKind: e.target.value as XrayPropKind })}
          >
            {XRAY_PROP_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {XRAY_PROP_KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#4a6366]">
          Side
          <select
            className="rounded-lg border border-[#DCE9EA] bg-white px-2 py-1.5 text-sm text-[#063f46] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/60"
            value={leg.side.value ?? 'over'}
            onChange={(e) => onEdit(leg.id, { side: e.target.value as ParlayLegSide })}
          >
            <option value="over">Over</option>
            <option value="under">Under</option>
          </select>
        </label>
        <Field
          label="Line"
          warning={leg.line.status !== 'known'}
          value={leg.line.value == null ? '' : String(leg.line.value)}
          inputMode="decimal"
          onChange={(value) => {
            const n = Number(value);
            onEdit(leg.id, { line: value.trim() === '' || !Number.isFinite(n) ? null : n });
          }}
        />
        <Field
          label="Odds"
          warning={false}
          value={
            leg.oddsAmerican.status === 'known' && leg.oddsAmerican.value != null
              ? String(leg.oddsAmerican.value)
              : ''
          }
          inputMode="numeric"
          onChange={(value) => {
            const n = Number(value);
            onEdit(leg.id, { oddsAmerican: value.trim() === '' || !Number.isFinite(n) ? null : n });
          }}
        />
      </div>
      {leg.resolution !== 'resolved' ? (
        <p className="text-xs font-medium text-[#9a3412]">Needs confirmation</p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  warning,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  warning: boolean;
  inputMode?: 'decimal' | 'numeric';
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[#4a6366]">
      {label}
      {warning ? <span className="sr-only">Needs confirmation</span> : null}
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'rounded-lg border bg-white px-2 py-1.5 text-sm text-[#063f46] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/60',
          warning ? 'border-amber-400' : 'border-[#DCE9EA]'
        )}
      />
    </label>
  );
}

function MatchupLine({ leg }: { leg: ExtractedParlayLeg }) {
  const display = matchupDisplayFromLeg(leg);
  if (!display) {
    return (
      <p className="text-xs text-[#4a6366] truncate">{leg.matchupLabel.value ?? 'Matchup unavailable'}</p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-xs text-[#4a6366] min-w-0">
      <TeamLogo team={display.left} size="xs" decorative />
      <span className="font-medium text-[#063f46]">{display.left}</span>
      <span>{display.separator}</span>
      <TeamLogo team={display.right} size="xs" decorative />
      <span className="font-medium text-[#063f46]">{display.right}</span>
    </p>
  );
}

function titleSide(side: ParlayLegSide): string {
  return side === 'over' ? 'Over' : 'Under';
}
