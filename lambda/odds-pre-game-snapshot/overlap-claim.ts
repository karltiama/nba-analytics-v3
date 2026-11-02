/**
 * One in-flight odds snapshot per Eastern day, date, window, and refresh slot.
 * Discovery has one slot per Eastern day. The near-tip window uses a 15-minute bucket so the next scheduler tick can refresh a later game.
 * A completed slot stays skipped. The next bucket is a new key. The lease is only the crash bound.
 * Process memory is not the lock.
 */

import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { oddsClaimSortKey } from './refresh-slot';

export const ODDS_CLAIM_PK = 'odds-snapshot-claim';
/** Longer than the 300s Lambda timeout, short enough that a killed run can be replaced. */
export const ODDS_CLAIM_LEASE_MS = 330_000;

export type ClaimDecision =
  | { ok: true }
  | { ok: false; reason: 'skipped' | 'unavailable' | 'ambiguous' };

export type ClaimInput = {
  day: string;
  date: string;
  windowId: string;
  nowMs: number;
  owner: string;
};

type StoreError = 'conflict' | 'ambiguous' | 'unavailable';

function classifyStoreError(err: unknown): StoreError {
  const candidate = err as { name?: string; message?: string };
  const name = candidate?.name ?? '';
  if (name === 'ConditionalCheckFailedException') return 'conflict';
  if (
    name === 'TimeoutError'
    || name === 'AbortError'
    || name === 'NetworkingError'
    || name === 'InternalServerError'
    || name === 'ServiceUnavailable'
    || /timeout/i.test(name)
    || /timeout/i.test(candidate?.message ?? '')
  ) {
    return 'ambiguous';
  }
  return 'unavailable';
}

function sanitizeClaimMessage(message: string): string {
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]')
    .replace(/Bearer\s+\S+/gi, '[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]')
    .slice(0, 300);
}

function logClaimFailure(request: ClaimInput, classified: StoreError, err: unknown): void {
  if (classified === 'conflict') return;
  const candidate = err as {
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number; requestId?: string; attempts?: number };
  };
  console.log(JSON.stringify({
    evt: 'odds_claim_failure',
    operation: 'UpdateItem',
    name: candidate?.name ?? 'Error',
    message: sanitizeClaimMessage(candidate?.message ?? ''),
    httpStatus: candidate?.$metadata?.httpStatusCode ?? null,
    requestId: candidate?.$metadata?.requestId ?? null,
    attempts: candidate?.$metadata?.attempts ?? null,
    date: request.date,
    windowId: request.windowId,
    classification: classified === 'ambiguous' ? 'ambiguous' : 'unavailable',
  }));
}

type HeldClaim = { owner: string; leaseUntilMs: number; completed: boolean };

export type OddsClaim = {
  claim(input: ClaimInput): Promise<ClaimDecision>;
  complete(input: ClaimInput): Promise<void>;
};

export function createMemoryOddsClaim(input: { leaseMs?: number } = {}): OddsClaim & {
  held(): ReadonlyMap<string, HeldClaim>;
} {
  const leaseMs = input.leaseMs ?? ODDS_CLAIM_LEASE_MS;
  const claims = new Map<string, HeldClaim>();

  return {
    held: () => claims,
    async claim(request) {
      const key = oddsClaimSortKey(request);
      const current = claims.get(key);
      if (current?.completed) return { ok: false, reason: 'skipped' };
      if (current && current.leaseUntilMs >= request.nowMs) {
        return { ok: false, reason: 'skipped' };
      }
      claims.set(key, { owner: request.owner, leaseUntilMs: request.nowMs + leaseMs, completed: false });
      return { ok: true };
    },
    async complete(request) {
      const key = oddsClaimSortKey(request);
      const current = claims.get(key);
      claims.set(key, {
        owner: request.owner,
        leaseUntilMs: current?.leaseUntilMs ?? request.nowMs,
        completed: true,
      });
    },
  };
}

export function createDynamoOddsClaim(input: {
  tableName: string | undefined;
  client?: { send: (command: UpdateItemCommand) => Promise<unknown> };
  leaseMs?: number;
}): OddsClaim {
  const leaseMs = input.leaseMs ?? ODDS_CLAIM_LEASE_MS;
  const client = input.client ?? new DynamoDBClient({});

  return {
    async claim(request) {
      if (!input.tableName) return { ok: false, reason: 'unavailable' };
      try {
        await client.send(new UpdateItemCommand({
          TableName: input.tableName,
          Key: {
            pk: { S: ODDS_CLAIM_PK },
            sk: { S: oddsClaimSortKey(request) },
          },
          UpdateExpression: 'SET #owner = :owner, lease_until_ms = :until, claimed_at = :now, window_id = :window, et_date = :date, expires_at = :exp',
          ConditionExpression: '(attribute_not_exists(lease_until_ms) OR lease_until_ms < :now) AND attribute_not_exists(completed_at)',
          ExpressionAttributeNames: { '#owner': 'owner' },
          ExpressionAttributeValues: {
            ':owner': { S: request.owner },
            ':until': { N: String(request.nowMs + leaseMs) },
            ':now': { N: String(request.nowMs) },
            ':window': { S: request.windowId },
            ':date': { S: request.date },
            ':exp': { N: String(Math.floor((request.nowMs + leaseMs) / 1000) + 86_400) },
          },
        }));
        return { ok: true };
      } catch (err) {
        const classified = classifyStoreError(err);
        logClaimFailure(request, classified, err);
        if (classified === 'conflict') return { ok: false, reason: 'skipped' };
        if (classified === 'ambiguous') return { ok: false, reason: 'ambiguous' };
        return { ok: false, reason: 'unavailable' };
      }
    },
    async complete(request) {
      if (!input.tableName) return;
      try {
        await client.send(new UpdateItemCommand({
          TableName: input.tableName,
          Key: {
            pk: { S: ODDS_CLAIM_PK },
            sk: { S: oddsClaimSortKey(request) },
          },
          UpdateExpression: 'SET completed_at = :now',
          ConditionExpression: 'attribute_not_exists(completed_at)',
          ExpressionAttributeValues: {
            ':now': { N: String(request.nowMs) },
          },
        }));
      } catch (err) {
        const classified = classifyStoreError(err);
        logClaimFailure(request, classified, err);
        if (classified === 'conflict') return;
        throw err;
      }
    },
  };
}
