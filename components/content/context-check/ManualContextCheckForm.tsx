'use client';

import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  formatContextTypeLabel,
  formatMarketLabel,
} from '@/lib/content/context-check/format';
import { findStudioPlayer, searchStudioPlayers } from '@/lib/content/context-check/players';
import {
  validateManualContextCheckForm,
  type ManualFormErrors,
  type ManualFormValues,
} from '@/lib/content/context-check/validate';
import type { ContextCheckType, ContextMarketType } from '@/lib/content/context-check/types';

const MARKETS: ContextMarketType[] = ['points', 'rebounds', 'assists', 'threes', 'pra'];
const CONTEXT_TYPES: ContextCheckType[] = [
  'recent_form',
  'line_context',
  'role_change',
  'roster_change',
];

const EMPTY_VALUES: ManualFormValues = {
  playerId: '',
  marketType: 'points',
  direction: 'over',
  line: '',
  contextType: 'recent_form',
};

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: string;
}) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </label>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive">
      {message}
    </p>
  );
}

export function ManualContextCheckForm({
  onSubmit,
  isGenerating = false,
}: {
  onSubmit: (values: ManualFormValues) => void;
  isGenerating?: boolean;
}) {
  const formId = useId();
  const [values, setValues] = useState<ManualFormValues>(EMPTY_VALUES);
  const [playerQuery, setPlayerQuery] = useState('');
  const [errors, setErrors] = useState<ManualFormErrors>({});

  const matches = useMemo(() => {
    const found = searchStudioPlayers(playerQuery);
    const selectedPlayer = values.playerId ? findStudioPlayer(values.playerId) : undefined;
    if (selectedPlayer && !found.some((player) => player.id === selectedPlayer.id)) {
      return [selectedPlayer, ...found];
    }
    return found;
  }, [playerQuery, values.playerId]);
  const selected = values.playerId ? findStudioPlayer(values.playerId) : undefined;

  function update<K extends keyof ManualFormValues>(key: K, value: ManualFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const result = validateManualContextCheckForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(values);
  }

  const inputClass =
    'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-1">
        <FieldLabel htmlFor={`${formId}-player-search`}>Player</FieldLabel>
        <input
          id={`${formId}-player-search`}
          type="search"
          value={playerQuery}
          onChange={(event) => {
            setPlayerQuery(event.target.value);
            if (values.playerId) update('playerId', '');
          }}
          placeholder="Search by name or team"
          autoComplete="off"
          aria-invalid={Boolean(errors.playerId)}
          aria-describedby={errors.playerId ? `${formId}-player-error` : undefined}
          className={inputClass}
        />
        <div
          role="listbox"
          aria-label="Player matches"
          className="max-h-40 overflow-auto rounded-md border border-white/10 bg-card"
        >
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No matching studio players.</p>
          ) : (
            matches.map((player) => {
              const active = player.id === values.playerId;
              return (
                <button
                  key={player.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    update('playerId', player.id);
                    setPlayerQuery(player.name);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/5',
                    active && 'bg-neon-cyan/10 text-neon-cyan'
                  )}
                >
                  <span className="truncate">{player.name}</span>
                  <span className="ml-3 shrink-0 font-mono text-xs text-muted-foreground">
                    {player.teamAbbreviation}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {selected ? (
          <p className="text-xs text-muted-foreground">Selected: {selected.name}</p>
        ) : null}
        <FieldError id={`${formId}-player-error`} message={errors.playerId} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <FieldLabel htmlFor={`${formId}-market`}>Market</FieldLabel>
          <select
            id={`${formId}-market`}
            value={values.marketType}
            onChange={(event) => update('marketType', event.target.value)}
            aria-invalid={Boolean(errors.marketType)}
            className={inputClass}
          >
            {MARKETS.map((market) => (
              <option key={market} value={market}>
                {formatMarketLabel(market)}
              </option>
            ))}
          </select>
          <FieldError id={`${formId}-market-error`} message={errors.marketType} />
        </div>

        <div className="space-y-1">
          <FieldLabel htmlFor={`${formId}-direction`}>Direction</FieldLabel>
          <select
            id={`${formId}-direction`}
            value={values.direction}
            onChange={(event) => update('direction', event.target.value)}
            aria-invalid={Boolean(errors.direction)}
            className={inputClass}
          >
            <option value="over">Over</option>
            <option value="under">Under</option>
          </select>
          <FieldError id={`${formId}-direction-error`} message={errors.direction} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <FieldLabel htmlFor={`${formId}-line`}>Line</FieldLabel>
          <input
            id={`${formId}-line`}
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={values.line}
            onChange={(event) => update('line', event.target.value)}
            aria-invalid={Boolean(errors.line)}
            aria-describedby={errors.line ? `${formId}-line-error` : undefined}
            className={inputClass}
            placeholder="27.5"
          />
          <FieldError id={`${formId}-line-error`} message={errors.line} />
        </div>

        <div className="space-y-1">
          <FieldLabel htmlFor={`${formId}-context-type`}>Context Type</FieldLabel>
          <select
            id={`${formId}-context-type`}
            value={values.contextType}
            onChange={(event) => update('contextType', event.target.value)}
            aria-invalid={Boolean(errors.contextType)}
            className={inputClass}
          >
            {CONTEXT_TYPES.map((type) => (
              <option key={type} value={type}>
                {formatContextTypeLabel(type)}
              </option>
            ))}
          </select>
          <FieldError id={`${formId}-context-type-error`} message={errors.contextType} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        L5 / L10 / L20 / season figures are produced by the data layer. v1 uses a mock generator so
        this studio does not query the analytics database.
      </p>

      <button
        type="submit"
        disabled={isGenerating}
        className="rounded-md bg-neon-cyan px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {isGenerating ? 'Generating preview…' : 'Generate preview'}
      </button>
    </form>
  );
}
