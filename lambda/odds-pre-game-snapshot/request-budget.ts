/**
 * Odds-only daily provider-attempt ceiling.
 * This is not the shared per-minute token bucket and it does not cap scoreboard or props.
 * The provider reset is not a verified daily boundary. The ledger day is America/New_York
 * because that is the game date and it does not split an evening slate at 00:00 UTC.
 * A reservation is consumed even when the later HTTP attempt fails.
 */

import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { DAILY_ODDS_REQUEST_CEILING, etCalendarDate } from './normal-path';

export const ODDS_BUDGET_PK = 'odds-daily-budget';
export const ODDS_BUDGET_DAY_TTL_SECONDS = 3 * 24 * 60 * 60;

export type BudgetLedger = {
  requested: number;
  reserved: number;
  attempted: number;
  successful: number;
  failed: number;
  refused: number;
};

export type BudgetDecision =
  | { ok: true; reservationId: string; remaining: number; ledger: BudgetLedger }
  | { ok: false; reason: 'exhausted' | 'unavailable' | 'ambiguous'; ledger: BudgetLedger };

export type ReserveInput = {
  day: string;
  date: string;
  dateCeiling: number;
};

const EMPTY_LEDGER: BudgetLedger = {
  requested: 0,
  reserved: 0,
  attempted: 0,
  successful: 0,
  failed: 0,
  refused: 0,
};

export function emptyBudgetLedger(): BudgetLedger {
  return { ...EMPTY_LEDGER };
}

/** One synchronous transition. Callers must not read the ledger, await, and then write it back. */
export function applyReserve(
  ledger: BudgetLedger,
  ceiling: number,
  dateUsed: number,
  dateCeiling: number
): { ledger: BudgetLedger; granted: boolean } {
  const requested = ledger.requested + 1;
  if (!Number.isInteger(ceiling) || !Number.isInteger(dateCeiling) || !Number.isInteger(ledger.reserved) || ledger.reserved < 0 || !Number.isInteger(dateUsed) || dateUsed < 0) {
    return {
      granted: false,
      ledger: { ...ledger, requested, refused: ledger.refused + 1 },
    };
  }
  if (ledger.reserved >= ceiling || dateUsed >= dateCeiling || dateCeiling < 1 || ceiling < 1) {
    return {
      granted: false,
      ledger: { ...ledger, requested, refused: ledger.refused + 1 },
    };
  }
  return {
    granted: true,
    ledger: { ...ledger, requested, reserved: ledger.reserved + 1 },
  };
}

export function applyAttempt(ledger: BudgetLedger, outcome: 'success' | 'failure'): BudgetLedger {
  return {
    ...ledger,
    attempted: ledger.attempted + 1,
    successful: ledger.successful + (outcome === 'success' ? 1 : 0),
    failed: ledger.failed + (outcome === 'failure' ? 1 : 0),
  };
}

export function budgetDay(now: Date): string {
  return etCalendarDate(now);
}

export function dateCounterName(date: string): string {
  return `d_${date.replaceAll('-', '_')}`;
}

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

export type OddsBudget = {
  reserve(input: ReserveInput): Promise<BudgetDecision>;
  record(input: { reservationId: string; outcome: 'success' | 'failure' }): Promise<void>;
  ledger(): BudgetLedger;
};

export function createMemoryOddsBudget(input: { ceiling?: number; now?: () => Date } = {}): OddsBudget & {
  dateUsed(date: string): number;
} {
  const ceiling = input.ceiling ?? DAILY_ODDS_REQUEST_CEILING;
  let ledger = emptyBudgetLedger();
  const byDate = new Map<string, number>();
  let sequence = 0;

  return {
    ledger: () => ({ ...ledger }),
    dateUsed: (date) => byDate.get(date) ?? 0,
    async reserve(request) {
      const used = byDate.get(request.date) ?? 0;
      const applied = applyReserve(ledger, ceiling, used, request.dateCeiling);
      ledger = applied.ledger;
      if (!applied.granted) {
        return { ok: false, reason: 'exhausted', ledger: { ...ledger } };
      }
      byDate.set(request.date, used + 1);
      sequence += 1;
      return {
        ok: true,
        reservationId: `${request.day}#${request.date}#${sequence}`,
        remaining: ceiling - ledger.reserved,
        ledger: { ...ledger },
      };
    },
    async record(entry) {
      if (!entry.reservationId) return;
      ledger = applyAttempt(ledger, entry.outcome);
    },
  };
}

export type DynamoSender = {
  send: (command: UpdateItemCommand) => Promise<{ Attributes?: Record<string, { N?: string }> }>;
};

export function createDynamoOddsBudget(input: {
  tableName: string | undefined;
  ceiling?: number;
  client?: DynamoSender;
  now?: () => Date;
}): OddsBudget {
  const ceiling = input.ceiling ?? DAILY_ODDS_REQUEST_CEILING;
  const now = input.now ?? (() => new Date());
  let ledger = emptyBudgetLedger();
  const client = input.client ?? new DynamoDBClient({});

  async function sendOnce(command: UpdateItemCommand): Promise<'ok' | StoreError> {
    try {
      await client.send(command);
      return 'ok';
    } catch (err) {
      return classifyStoreError(err);
    }
  }

  return {
    ledger: () => ({ ...ledger }),
    async reserve(request) {
      if (!input.tableName || !Number.isInteger(ceiling) || ceiling < 1 || !Number.isInteger(request.dateCeiling) || request.dateCeiling < 1) {
        return { ok: false, reason: 'unavailable', ledger: { ...ledger } };
      }
      const counter = dateCounterName(request.date);
      const expiresAt = Math.floor(now().getTime() / 1000) + ODDS_BUDGET_DAY_TTL_SECONDS;
      const granted = await sendOnce(new UpdateItemCommand({
        TableName: input.tableName,
        Key: {
          pk: { S: ODDS_BUDGET_PK },
          sk: { S: `attempts#${request.day}` },
        },
        UpdateExpression: 'ADD requested :one, reserved :one, #dateCounter :one SET budget_day = :day, ceiling = if_not_exists(ceiling, :ceiling), expires_at = :exp',
        ConditionExpression: '(attribute_not_exists(reserved) OR (reserved >= :zero AND reserved < :ceiling)) AND (attribute_not_exists(#dateCounter) OR (#dateCounter >= :zero AND #dateCounter < :dateCeiling))',
        ExpressionAttributeNames: { '#dateCounter': counter },
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':zero': { N: '0' },
          ':ceiling': { N: String(ceiling) },
          ':dateCeiling': { N: String(request.dateCeiling) },
          ':day': { S: request.day },
          ':exp': { N: String(expiresAt) },
        },
        ReturnValues: 'UPDATED_NEW',
      }));
      if (granted === 'ambiguous') {
        return { ok: false, reason: 'ambiguous', ledger: { ...ledger } };
      }
      if (granted === 'unavailable') {
        return { ok: false, reason: 'unavailable', ledger: { ...ledger } };
      }
      if (granted === 'conflict') {
        await sendOnce(new UpdateItemCommand({
          TableName: input.tableName,
          Key: {
            pk: { S: ODDS_BUDGET_PK },
            sk: { S: `attempts#${request.day}` },
          },
          UpdateExpression: 'ADD requested :one, refused :one',
          ExpressionAttributeValues: { ':one': { N: '1' } },
        }));
        ledger = { ...ledger, requested: ledger.requested + 1, refused: ledger.refused + 1 };
        return { ok: false, reason: 'exhausted', ledger: { ...ledger } };
      }
      ledger = {
        ...ledger,
        requested: ledger.requested + 1,
        reserved: ledger.reserved + 1,
      };
      return {
        ok: true,
        reservationId: `${request.day}#${request.date}#${ledger.reserved}`,
        remaining: ceiling - ledger.reserved,
        ledger: { ...ledger },
      };
    },
    async record(entry) {
      if (!input.tableName || !entry.reservationId) return;
      const field = entry.outcome === 'success' ? 'successful' : 'failed';
      const result = await sendOnce(new UpdateItemCommand({
        TableName: input.tableName,
        Key: {
          pk: { S: ODDS_BUDGET_PK },
          sk: { S: `attempts#${entry.reservationId.split('#')[0]}` },
        },
        UpdateExpression: `ADD attempted :one, ${field} :one`,
        ExpressionAttributeValues: { ':one': { N: '1' } },
      }));
      if (result === 'ok') ledger = applyAttempt(ledger, entry.outcome);
    },
  };
}
