'use client';

import { useMemo, useState } from 'react';
import type { HistoricalBoxPlayer, HistoricalBoxScore } from '@/lib/betting/historical-final';
import type { HistoricalStarters } from '@/lib/betting/historical-starters';
import {
  defaultRoleProfilePlayerId,
  type HistoricalPlayerRoleProfile,
} from '@/lib/betting/historical-role-profile';
import {
  ROLE_METRIC_HELP,
  ROLE_MISSING,
  formatRolePerGame,
  hasCreationMetrics,
  hasShotProfile,
  shotProfileRows,
  visiblePlaytypes,
} from '@/lib/betting/historical-role-profile-format';
import { formatNbaSeasonLabel } from '@/lib/season';
import { trackEvent } from '@/lib/product-analytics/track-event';
import {
  HISTORICAL_PLAYER_OPENED,
  historicalPlayerOpenedProperties,
} from '@/lib/product-analytics/historical-explorer-events';

function findPlayer(
  box: HistoricalBoxScore,
  playerId: string | null
): HistoricalBoxPlayer | null {
  if (!playerId) return null;
  return (
    box.away.find((p) => p.playerId === playerId) ??
    box.home.find((p) => p.playerId === playerId) ??
    null
  );
}

function MetricAbbr({
  abbr,
  label,
  help,
}: {
  abbr: string;
  label: string;
  help: string;
}) {
  return (
    <abbr
      title={`${label}. ${help}`}
      aria-label={`${label}. ${help}`}
      className="no-underline cursor-help"
    >
      {abbr}
    </abbr>
  );
}

function PlaytypeCards({ profile }: { profile: HistoricalPlayerRoleProfile }) {
  const rows = visiblePlaytypes(profile);
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="type-secondary mb-2 text-[#063f46]">Primary actions</h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2"
          >
            <p className="type-secondary text-[#063f46]">{row.label}</p>
            <p className="type-card-data mt-1 font-mono tabular-nums text-[#063f46]">
              {row.frequency}
              <span className="type-metadata ml-1 font-sans">
                <MetricAbbr abbr="freq" label="Frequency" help={ROLE_METRIC_HELP.possPct} />
              </span>
            </p>
            <p className="type-table-data font-mono tabular-nums text-[#063f46]">
              {row.ppp}{' '}
              <MetricAbbr abbr="PPP" label="Points per possession" help={ROLE_METRIC_HELP.ppp} />
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreationBlock({ profile }: { profile: HistoricalPlayerRoleProfile }) {
  if (!hasCreationMetrics(profile)) return null;
  const items = [
    {
      label: 'Drives',
      value: formatRolePerGame(profile.drivesPerGame),
      help: ROLE_METRIC_HELP.drives,
    },
    {
      label: 'Drive pts',
      value: formatRolePerGame(profile.drivePointsPerGame),
      help: ROLE_METRIC_HELP.drivePts,
    },
    {
      label: 'Passes',
      value: formatRolePerGame(profile.passesPerGame),
      help: ROLE_METRIC_HELP.passes,
    },
    {
      label: 'Potential AST',
      value: formatRolePerGame(profile.potentialAssistsPerGame),
      help: ROLE_METRIC_HELP.potentialAst,
    },
  ].filter((item) => item.value !== ROLE_MISSING);

  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="type-secondary mb-2 text-[#063f46]">Creation</h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2"
          >
            <p className="type-metadata">
              <abbr title={item.help} className="no-underline cursor-help">
                {item.label}
              </abbr>
            </p>
            <p className="type-card-data font-mono tabular-nums text-[#063f46]">
              {item.value}
              <span className="type-metadata ml-1 font-sans">/ game</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShotProfile({ profile }: { profile: HistoricalPlayerRoleProfile }) {
  if (!hasShotProfile(profile)) return null;
  const zones = shotProfileRows(profile);
  return (
    <div>
      <h4 className="type-secondary mb-2 text-[#063f46]">Shot profile</h4>
      <ul className="space-y-1.5">
        {zones.map((zone) => (
          <li key={zone.id} className="min-w-0">
            <div className="type-table-data flex items-baseline justify-between gap-2">
              <span className="text-[#063f46]">{zone.label}</span>
              <span className="font-mono tabular-nums text-[#4a6366]">
                {zone.fga} FGA · {zone.fgPct}
              </span>
            </div>
            <div
              className="mt-0.5 h-1.5 rounded-full bg-[#F8FBFA] overflow-hidden"
              aria-hidden={zone.sharePct == null}
            >
              {zone.sharePct != null ? (
                <div
                  className="h-full rounded-full bg-[#075B5C]/70"
                  style={{ width: `${Math.min(100, Math.max(0, zone.sharePct))}%` }}
                />
              ) : null}
            </div>
            {zone.sharePct != null ? (
              <span className="sr-only">
                {zone.label} {zone.sharePct.toFixed(0)} percent of zone attempts, {zone.fga} per
                game, {zone.fgPct} field goal percentage
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HistoricalFinalRoleProfile({
  gameId,
  season,
  boxScore,
  starters,
  awayAbbr,
  homeAbbr,
}: {
  gameId: string;
  season: string;
  boxScore: HistoricalBoxScore;
  starters?: HistoricalStarters | null;
  awayAbbr: string;
  homeAbbr: string;
}) {
  const defaultId = useMemo(
    () => defaultRoleProfilePlayerId({ starters, box: boxScore }),
    [starters, boxScore]
  );
  const [selectedId, setSelectedId] = useState<string>(defaultId ?? '');
  const selected = findPlayer(boxScore, selectedId || defaultId);
  const profile = selected?.roleProfile ?? null;
  const seasonLabel = season ? formatNbaSeasonLabel(season) : season;

  return (
    <section
      id="section-context"
      className="scroll-mt-[10rem] bg-white rounded-2xl overflow-hidden border border-[#DCE9EA] shadow-sm"
      aria-labelledby="season-role-heading"
    >
      <div className="px-3 py-2 border-b border-[#DCE9EA] bg-[#F8FBFA]">
        <p className="type-metadata">Context</p>
        <h2 id="season-role-heading" className="type-section-heading text-[#063f46]">
          Season Role — {seasonLabel}
        </h2>
        <p className="type-body mt-1 text-cc-secondary">
          This season, not this game. Advanced above is game-level performance.
        </p>
      </div>
      <div className="p-3 space-y-4">
        <label className="block">
          <span className="type-secondary">Player</span>
          <select
            className="type-interactive mt-1 w-full rounded-lg border border-[#DCE9EA] bg-white px-3 py-2 text-[#063f46]"
            value={selected?.playerId ?? ''}
            onChange={(event) => {
              setSelectedId(event.target.value);
              trackEvent(
                HISTORICAL_PLAYER_OPENED,
                historicalPlayerOpenedProperties({ gameId, season })
              );
            }}
            aria-label="Select player for season role profile"
          >
            <optgroup label={awayAbbr}>
              {boxScore.away.map((player) => (
                <option key={`a-${player.playerId}`} value={player.playerId}>
                  {player.playerName}
                </option>
              ))}
            </optgroup>
            <optgroup label={homeAbbr}>
              {boxScore.home.map((player) => (
                <option key={`h-${player.playerId}`} value={player.playerId}>
                  {player.playerName}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        {selected ? (
          <div className="space-y-4">
            {profile ? (
              <>
                <PlaytypeCards profile={profile} />
                <CreationBlock profile={profile} />
                <ShotProfile profile={profile} />
                {!visiblePlaytypes(profile).length &&
                !hasCreationMetrics(profile) &&
                !hasShotProfile(profile) ? (
                  <p className="type-secondary">
                    Season role profile unavailable for this player.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="type-secondary">
                Season role profile unavailable for this player.
              </p>
            )}
          </div>
        ) : (
          <p className="type-secondary">No box-score players to profile.</p>
        )}

        <p className="type-body text-cc-secondary">
          Some play-type metrics appear only when a player meets provider qualification thresholds.
          Missing isolation or pick-and-roll numbers do not mean the player had no role.
        </p>
      </div>
    </section>
  );
}
