/**
 * Server-side create/read for immutable shared bet-slip snapshots.
 *
 * Security: public reads never return internal `id` or `created_by`.
 * Reads prefer `public.get_shared_bet_slip_public(share_id)` (SECURITY DEFINER,
 * safe columns only). App also projects only public fields when mapping results.
 * Table RLS denies direct anon SELECT of full rows.
 */

import { randomBytes } from 'node:crypto';
import {
  CANONICAL_PROP_TYPES,
  isPlayerPropV1Vendor,
  type CanonicalPropType,
  type PlayerPropV1Vendor,
} from '@/lib/betting/market-movement';
import { queryOne } from '@/lib/db';
import { PARLAY_SELECTION_SOFT_CAP } from '@/lib/parlay/selection';
import type { ParlayLegSide } from '@/lib/parlay-xray/types';
import { canonicalSelectionKey, coerceSelectionLine } from './selection-key';
import {
  BET_SLIP_SPORT_NBA,
  CANONICAL_BET_SLIP_SOURCES,
  SHARED_BET_SLIP_SNAPSHOT_VERSION,
  type CanonicalBetLeg,
  type CanonicalBetSlip,
  type CanonicalBetSlipSource,
  type PublicSharedBetSlip,
} from './types';

export const SHARED_SLIP_LEG_CAP = PARLAY_SELECTION_SOFT_CAP;

const PROP_TYPE_SET = new Set<string>(CANONICAL_PROP_TYPES);
const SOURCE_SET = new Set<string>(CANONICAL_BET_SLIP_SOURCES);
const SIDE_SET = new Set<string>(['over', 'under']);

export type CreateSharedBetSlipInput = {
  slip: CanonicalBetSlip;
  createdBy: string;
};

export type CreateSharedBetSlipFailureCode =
  | 'EMPTY_SLIP'
  | 'LEG_CAP'
  | 'INVALID_LEG'
  | 'INVALID_SOURCE'
  | 'INVALID_USER'
  | 'PERSIST_FAILED';

export type CreateSharedBetSlipResult =
  | { ok: true; share: PublicSharedBetSlip }
  | { ok: false; code: CreateSharedBetSlipFailureCode; message?: string };

export type GetSharedBetSlipResult =
  | { ok: true; share: PublicSharedBetSlip }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_SNAPSHOT'; message?: string };

type PublicSlipDbRow = {
  share_id: string;
  title: string | null;
  source: string;
  snapshot_version: number;
  legs_snapshot: unknown;
  created_at: string | Date;
};

/** Opaque URL-safe share token (~144 bits). */
export function generateShareId(): string {
  return randomBytes(18).toString('base64url');
}

export function sharedSlipPath(shareId: string): string {
  return `/slip/${shareId}`;
}

function isCanonicalPropType(value: string): value is CanonicalPropType {
  return PROP_TYPE_SET.has(value);
}

function isParlayLegSide(value: string): value is ParlayLegSide {
  return SIDE_SET.has(value);
}

function isSlipSource(value: string): value is CanonicalBetSlipSource {
  return SOURCE_SET.has(value);
}

function asVendor(value: unknown): PlayerPropV1Vendor | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return isPlayerPropV1Vendor(v) ? v : null;
}

function asOdds(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function asOptionalString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/**
 * Fail-closed parse of one frozen leg. Does not rewrite line/odds/book.
 * Recomputes selectionKey from identity fields and rejects mismatch.
 */
export function parseCanonicalBetLeg(raw: unknown): CanonicalBetLeg | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const gameId = typeof o.gameId === 'string' ? o.gameId.trim() : '';
  const playerId = typeof o.playerId === 'string' ? o.playerId.trim() : '';
  const marketRaw = typeof o.market === 'string' ? o.market.trim().toLowerCase() : '';
  const sideRaw = typeof o.side === 'string' ? o.side.trim().toLowerCase() : '';
  const line = coerceSelectionLine(o.line);
  const playerName = typeof o.playerName === 'string' ? o.playerName : '';
  const selectedAt = typeof o.selectedAt === 'string' ? o.selectedAt.trim() : '';
  const sport = o.sport === BET_SLIP_SPORT_NBA ? BET_SLIP_SPORT_NBA : null;

  if (!sport || !gameId || !playerId || !selectedAt || line == null) return null;
  if (!isCanonicalPropType(marketRaw) || !isParlayLegSide(sideRaw)) return null;

  const expectedKey = canonicalSelectionKey({
    sport,
    gameId,
    playerId,
    market: marketRaw,
    side: sideRaw,
    line,
  });
  const storedKey = typeof o.selectionKey === 'string' ? o.selectionKey.trim() : '';
  if (!storedKey || storedKey !== expectedKey) return null;

  let source: CanonicalBetLeg['source'];
  if (o.source != null) {
    if (typeof o.source !== 'object' || Array.isArray(o.source)) return null;
    const s = o.source as Record<string, unknown>;
    source = {
      provider: asOptionalString(s.provider),
      providerMarketId: asOptionalString(s.providerMarketId),
    };
  }

  return {
    selectionKey: expectedKey,
    sport,
    gameId,
    playerId,
    market: marketRaw,
    side: sideRaw,
    line,
    playerName,
    teamAbbreviation: asOptionalString(o.teamAbbreviation),
    opponentAbbreviation: asOptionalString(o.opponentAbbreviation),
    gameLabel: asOptionalString(o.gameLabel),
    selectedSportsbook: asVendor(o.selectedSportsbook),
    selectedOdds: asOdds(o.selectedOdds),
    selectedAt,
    source,
  };
}

export function parseLegsSnapshot(raw: unknown): CanonicalBetLeg[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (raw.length > SHARED_SLIP_LEG_CAP) return null;
  const legs: CanonicalBetLeg[] = [];
  for (const item of raw) {
    const leg = parseCanonicalBetLeg(item);
    if (!leg) return null;
    legs.push(leg);
  }
  return legs;
}

function toCreatedAtIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : String(value);
}

function mapPublicRow(row: PublicSlipDbRow): GetSharedBetSlipResult {
  if (!isSlipSource(row.source)) {
    return { ok: false, code: 'INVALID_SNAPSHOT', message: 'Unsupported slip source' };
  }
  const legs = parseLegsSnapshot(row.legs_snapshot);
  if (!legs) {
    return { ok: false, code: 'INVALID_SNAPSHOT', message: 'Malformed legs_snapshot' };
  }
  const snapshotVersion = Number(row.snapshot_version);
  if (!Number.isFinite(snapshotVersion) || snapshotVersion < 1) {
    return { ok: false, code: 'INVALID_SNAPSHOT', message: 'Invalid snapshot_version' };
  }

  return {
    ok: true,
    share: {
      shareId: row.share_id,
      title: row.title,
      source: row.source,
      snapshotVersion,
      legs,
      createdAt: toCreatedAtIso(row.created_at),
      path: sharedSlipPath(row.share_id),
    },
  };
}

function validateLegsForCreate(legs: CanonicalBetLeg[]): CreateSharedBetSlipFailureCode | null {
  if (!Array.isArray(legs) || legs.length === 0) return 'EMPTY_SLIP';
  if (legs.length > SHARED_SLIP_LEG_CAP) return 'LEG_CAP';
  for (const leg of legs) {
    if (!parseCanonicalBetLeg(leg)) return 'INVALID_LEG';
  }
  return null;
}

export async function createSharedBetSlip(
  input: CreateSharedBetSlipInput
): Promise<CreateSharedBetSlipResult> {
  const createdBy = input.createdBy?.trim();
  if (!createdBy) return { ok: false, code: 'INVALID_USER' };

  if (!isSlipSource(input.slip.source)) {
    return { ok: false, code: 'INVALID_SOURCE' };
  }

  const legError = validateLegsForCreate(input.slip.legs);
  if (legError) return { ok: false, code: legError };

  const shareId = generateShareId();
  const title =
    input.slip.title == null || String(input.slip.title).trim() === ''
      ? null
      : String(input.slip.title).trim();

  // Frozen copy — never mutate caller arrays after persist.
  const legsSnapshot = JSON.parse(JSON.stringify(input.slip.legs)) as CanonicalBetLeg[];

  try {
    const row = await queryOne<PublicSlipDbRow>(
      `
      INSERT INTO public.shared_bet_slips (
        share_id, title, source, snapshot_version, legs_snapshot, created_by
      ) VALUES (
        $1, $2, $3, $4, $5::jsonb, $6::uuid
      )
      RETURNING
        share_id,
        title,
        source,
        snapshot_version,
        legs_snapshot,
        created_at
      `,
      [
        shareId,
        title,
        input.slip.source,
        SHARED_BET_SLIP_SNAPSHOT_VERSION,
        JSON.stringify(legsSnapshot),
        createdBy,
      ]
    );

    if (!row) return { ok: false, code: 'PERSIST_FAILED' };
    const mapped = mapPublicRow(row);
    if (!mapped.ok) return { ok: false, code: 'PERSIST_FAILED', message: mapped.message };
    return { ok: true, share: mapped.share };
  } catch (error) {
    return {
      ok: false,
      code: 'PERSIST_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getSharedBetSlipByShareId(
  shareId: string
): Promise<GetSharedBetSlipResult> {
  const id = shareId?.trim();
  if (!id) return { ok: false, code: 'NOT_FOUND' };

  try {
    // SECURITY DEFINER RPC returns only public-safe columns (no id / created_by).
    const row = await queryOne<PublicSlipDbRow>(
      `SELECT share_id, title, source, snapshot_version, legs_snapshot, created_at
       FROM public.get_shared_bet_slip_public($1)`,
      [id]
    );

    if (!row) return { ok: false, code: 'NOT_FOUND' };
    return mapPublicRow(row);
  } catch (error) {
    // Fallback if migration RPC not yet applied: privileged SELECT with explicit projection.
    try {
      const row = await queryOne<PublicSlipDbRow>(
        `SELECT share_id, title, source, snapshot_version, legs_snapshot, created_at
         FROM public.shared_bet_slips
         WHERE share_id = $1`,
        [id]
      );
      if (!row) return { ok: false, code: 'NOT_FOUND' };
      return mapPublicRow(row);
    } catch {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: error instanceof Error ? error.message : 'Lookup failed',
      };
    }
  }
}
