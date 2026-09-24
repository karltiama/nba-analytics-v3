/**
 * Minimal live / fixture coverage probe for The Odds API Level-3 spike.
 *
 * Safe defaults:
 * - Without --live: prints fixture coverage table (no network).
 * - With --live: requires ODDS_API_KEY; fetches one NBA event + player_points
 *   for the five handoff books. Does not print the API key.
 *
 * Usage:
 *   npx tsx scripts/spike-odds-api-selection-deeplink.ts
 *   npx tsx scripts/spike-odds-api-selection-deeplink.ts --live
 */

import 'dotenv/config';
import { assertHandoffDestinationUrl } from '../lib/sportsbook-handoff/allowlist';
import { SPORTSBOOK_HANDOFF_PROVIDERS } from '../lib/sportsbook-handoff/types';
import { OddsApiClient } from '../lib/sportsbook-selection-deeplink/odds-api/client';
import { oddsApiBookmakerKey } from '../lib/sportsbook-selection-deeplink/odds-api/bookmaker-map';
import { normalizeBookmakerMarket } from '../lib/sportsbook-selection-deeplink/odds-api/normalize';
import { FIXTURE_EVENTS, FIXTURE_EVENT_ID } from '../lib/sportsbook-selection-deeplink/odds-api/fixtures/events';
import { buildCoverageFixtureMap } from '../lib/sportsbook-selection-deeplink/odds-api/fixtures/odds';

type Row = {
  provider: string;
  oddsReturned: boolean;
  eventSid: string | null;
  marketSid: string | null;
  outcomeSid: string | null;
  outcomeLink: string | null;
  linkAllowlisted: boolean | null;
  maxLevel: number;
};

function maskKey(key: string): string {
  if (key.length < 8) return '***';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function rowFromMarket(
  provider: string,
  market: ReturnType<typeof normalizeBookmakerMarket>
): Row {
  if (!market || market.outcomes.length === 0) {
    return {
      provider,
      oddsReturned: false,
      eventSid: null,
      marketSid: null,
      outcomeSid: null,
      outcomeLink: null,
      linkAllowlisted: null,
      maxLevel: 0,
    };
  }

  const withLink = market.outcomes.find((o) => o.link);
  const sample = withLink ?? market.outcomes[0]!;
  const link = sample.link;
  const allowlisted = link ? assertHandoffDestinationUrl(link).ok : null;

  let maxLevel = 0;
  if (market.eventSid) maxLevel = Math.max(maxLevel, 1);
  if (market.marketSid) maxLevel = Math.max(maxLevel, 2);
  if (sample.selectionSid) maxLevel = Math.max(maxLevel, 3);
  if (link && allowlisted) maxLevel = 3;
  else if (link && allowlisted === false) maxLevel = Math.min(maxLevel, 2);

  return {
    provider,
    oddsReturned: true,
    eventSid: market.eventSid,
    marketSid: market.marketSid,
    outcomeSid: sample.selectionSid,
    outcomeLink: link,
    linkAllowlisted: allowlisted,
    maxLevel,
  };
}

function printTable(rows: Row[], title: string) {
  console.log(`\n=== ${title} ===`);
  console.log(
    'Provider | Odds | Event SID | Market SID | Outcome SID | Link | Allowlisted | MaxLevel'
  );
  for (const r of rows) {
    console.log(
      [
        r.provider,
        r.oddsReturned ? 'Y' : 'N',
        r.eventSid ? 'Y' : 'N',
        r.marketSid ? 'Y' : 'N',
        r.outcomeSid ? 'Y' : 'N',
        r.outcomeLink ? 'Y' : 'N',
        r.linkAllowlisted == null ? '-' : r.linkAllowlisted ? 'Y' : 'N',
        String(r.maxLevel),
      ].join(' | ')
    );
  }
  console.log(
    '\nNote: MaxLevel 3 = single-selection link present + allowlisted. Level 4 not probed.'
  );
}

async function runFixture() {
  const map = buildCoverageFixtureMap();
  const rows: Row[] = [];
  for (const provider of SPORTSBOOK_HANDOFF_PROVIDERS) {
    const book = oddsApiBookmakerKey(provider);
    const event = map[`${FIXTURE_EVENT_ID}:${book}:player_points`];
    const market = event
      ? normalizeBookmakerMarket({ event, bookmakerKey: book, marketKey: 'player_points' })
      : null;
    rows.push(rowFromMarket(provider, market));
  }
  printTable(rows, 'FIXTURE coverage (not live reliability)');
  console.log(`Events in fixture list: ${FIXTURE_EVENTS.length}`);
}

async function runLive() {
  const apiKey = process.env.ODDS_API_KEY?.trim();
  if (!apiKey) {
    console.error('ODDS_API_KEY missing — cannot run --live. Fixture mode still available.');
    process.exit(1);
  }

  console.log(`Using ODDS_API_KEY ${maskKey(apiKey)} (free/dev key; no paid plan required for this probe)`);
  const client = new OddsApiClient({ apiKey });

  const eventsResult = await client.listNbaEvents();
  console.log(
    `Events fetched: ${eventsResult.data.length}; cost≈${eventsResult.meta.requestsCost ?? '?'} remaining≈${eventsResult.meta.remainingCredits ?? '?'}`
  );

  if (eventsResult.data.length === 0) {
    console.warn('No NBA events returned (offseason / empty slate). Stopping without prop calls.');
    return;
  }

  const event = eventsResult.data[0]!;
  console.log(
    `Probing event ${event.id} ${event.away_team} @ ${event.home_team} (${event.commence_time})`
  );

  const rows: Row[] = [];
  for (const provider of SPORTSBOOK_HANDOFF_PROVIDERS) {
    const book = oddsApiBookmakerKey(provider);
    try {
      const { data, meta } = await client.getEventOdds({
        eventId: event.id,
        markets: ['player_points'],
        bookmakers: [book],
        includeLinks: true,
        includeSids: true,
      });
      console.log(
        `  ${provider}: cost≈${meta.requestsCost ?? '?'} remaining≈${meta.remainingCredits ?? '?'}`
      );
      const market = normalizeBookmakerMarket({
        event: data,
        bookmakerKey: book,
        marketKey: 'player_points',
      });
      rows.push(rowFromMarket(provider, market));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  ${provider}: error ${message.slice(0, 120)}`);
      rows.push(rowFromMarket(provider, null));
    }
  }

  printTable(rows, 'LIVE sample (single event — not a reliability guarantee)');
  console.log(
    'Expected credit cost pattern: 1× events list + up to 5× (1 market × 1 region) event-odds ≈ ~6 credits for this probe.'
  );
}

async function main() {
  const live = process.argv.includes('--live');
  if (live) await runLive();
  else await runFixture();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
