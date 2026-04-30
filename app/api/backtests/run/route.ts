import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { evaluateRecentFormMinutes } from '@/lib/backtesting/strategies/recent-form-minutes';
import { fetchPlayerGameLogsForBacktest } from '@/lib/backtesting/repositories/postgres';
import type { RecentFormMinutesConfig } from '@/lib/backtesting/types';

const MAX_RETURNED_SIGNALS = 1000;
const PROJECTION_WEIGHT_TOLERANCE = 0.0001;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const filtersSchema = z
  .object({
    minPriorGames: z.number().int().positive().optional(),
    minMinutesL5: z.number().nonnegative().optional(),
    recentFormThreshold: z.number().positive().optional(),
    projectionWeightL10: z.number().nonnegative().optional(),
    projectionWeightSeason: z.number().nonnegative().optional(),
  })
  .optional();

const requestSchema = z
  .object({
    strategy: z.literal('RECENT_FORM_MINUTES'),
    season: z.number().int().min(1900).max(3000),
    evaluationStartDate: dateSchema,
    evaluationEndDate: dateSchema,
    stat: z.enum(['points', 'rebounds', 'assists', 'threes', 'pra']),
    filters: filtersSchema,
  })
  .superRefine((body, ctx) => {
    if (body.evaluationStartDate > body.evaluationEndDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evaluationStartDate'],
        message: 'evaluationStartDate must be <= evaluationEndDate',
      });
    }

    const projectionWeightL10 = body.filters?.projectionWeightL10 ?? 0.7;
    const projectionWeightSeason = body.filters?.projectionWeightSeason ?? 0.3;
    const sum = projectionWeightL10 + projectionWeightSeason;
    if (Math.abs(sum - 1) > PROJECTION_WEIGHT_TOLERANCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['filters'],
        message:
          'projectionWeightL10 + projectionWeightSeason must be approximately 1 ' +
          `(tolerance ${PROJECTION_WEIGHT_TOLERANCE})`,
      });
    }
  });

function buildStrategyConfig(body: z.infer<typeof requestSchema>): RecentFormMinutesConfig {
  const filters = body.filters ?? {};
  return {
    stat: body.stat,
    evaluationStartDate: body.evaluationStartDate,
    evaluationEndDate: body.evaluationEndDate,
    minPriorGames: filters.minPriorGames,
    minMinutesL5: filters.minMinutesL5,
    recentFormThreshold: filters.recentFormThreshold,
    projectionWeightL10: filters.projectionWeightL10,
    projectionWeightSeason: filters.projectionWeightSeason,
  };
}

export async function POST(request: NextRequest) {
  try {
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: 'Invalid JSON body',
        },
        { status: 400 }
      );
    }

    const parsed = requestSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid backtest request',
          issues: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const logsResult = await fetchPlayerGameLogsForBacktest({
      season: body.season,
      evaluationEndDate: body.evaluationEndDate,
    });

    const result = evaluateRecentFormMinutes(logsResult.logs, buildStrategyConfig(body));

    return NextResponse.json({
      runId: randomUUID(),
      strategy: result.strategy,
      summary: result.summary,
      signals: result.signals.slice(0, MAX_RETURNED_SIGNALS),
    });
  } catch (error: unknown) {
    console.error('[api/backtests/run]', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        error: 'Backtest run failed',
        message,
      },
      { status: 500 }
    );
  }
}
