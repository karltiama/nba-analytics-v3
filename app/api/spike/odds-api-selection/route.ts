/**
 * Optional API for the Level-3 spike UI (flag-gated).
 * Fixture-first when ODDS_API_HANDOFF_SPIKE_USE_LIVE is not set or key missing.
 * Does not affect production handoff routes.
 */

import { NextResponse } from 'next/server';
import type { CanonicalBetLeg } from '@/lib/bet-slip/types';
import { isSportsbookHandoffProvider } from '@/lib/sportsbook-handoff';
import {
  OddsApiSelectionDeeplinkAdapter,
  createOddsApiClientFromEnv,
  isOddsApiHandoffSpikeEnabled,
  type GameMatchContext,
} from '@/lib/sportsbook-selection-deeplink';
import { FIXTURE_EVENTS, FIXTURE_GAME_CONTEXT } from '@/lib/sportsbook-selection-deeplink/odds-api/fixtures/events';
import { buildCoverageFixtureMap } from '@/lib/sportsbook-selection-deeplink/odds-api/fixtures/odds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  leg?: CanonicalBetLeg;
  sportsbook?: string;
  game?: GameMatchContext | null;
  /** When true and ODDS_API_KEY present, attempt a live resolve (costs credits). */
  useLive?: boolean;
};

function fixtureAdapter() {
  return new OddsApiSelectionDeeplinkAdapter({
    eventsFixture: FIXTURE_EVENTS,
    eventOddsFixtureByKey: buildCoverageFixtureMap(),
  });
}

export async function POST(req: Request) {
  if (!isOddsApiHandoffSpikeEnabled()) {
    return NextResponse.json({ error: 'Spike disabled' }, { status: 404 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.leg || !body.sportsbook || !isSportsbookHandoffProvider(body.sportsbook)) {
    return NextResponse.json({ error: 'leg and sportsbook required' }, { status: 400 });
  }

  const wantLive = body.useLive === true && process.env.ODDS_API_HANDOFF_SPIKE_USE_LIVE === '1';
  const client = wantLive ? createOddsApiClientFromEnv() : null;

  const adapter = client
    ? new OddsApiSelectionDeeplinkAdapter({ client })
    : fixtureAdapter();

  const game = body.game ?? (client ? body.game : FIXTURE_GAME_CONTEXT);

  try {
    const resolution = await adapter.resolveSelection({
      leg: body.leg,
      sportsbook: body.sportsbook,
      game: game ?? null,
    });
    return NextResponse.json({
      resolution,
      mode: client ? 'live' : 'fixture',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'resolve failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
