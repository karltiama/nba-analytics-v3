/**
 * Read-only The Odds API Level-3 deeplink coverage certification.
 *
 * Does NOT write to the production DB.
 * Does NOT modify Court Context odds tables.
 * Does NOT subscribe to a paid plan.
 *
 * Usage:
 *   npx tsx scripts/certify-odds-api-deeplink-coverage.ts
 *   npx tsx scripts/certify-odds-api-deeplink-coverage.ts --fixture
 *   npx tsx scripts/certify-odds-api-deeplink-coverage.ts --max-events=6
 */

import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createOddsApiClientFromEnv } from '../lib/sportsbook-selection-deeplink/odds-api/client';
import {
  formatCertificationMarkdown,
} from '../lib/sportsbook-selection-deeplink/certification/format-markdown';
import { runLevel3Certification } from '../lib/sportsbook-selection-deeplink/certification/run-certification';
import { assertNoSecretsInReport } from '../lib/sportsbook-selection-deeplink/certification/sanitize';
import { FIXTURE_EVENTS } from '../lib/sportsbook-selection-deeplink/odds-api/fixtures/events';
import { buildCoverageFixtureMap } from '../lib/sportsbook-selection-deeplink/odds-api/fixtures/odds';
import type { OddsApiEventRaw } from '../lib/sportsbook-selection-deeplink/odds-api/types';

const REPORT_DIR = path.join(process.cwd(), 'reports', 'prop-handoff');
const REPORT_JSON = path.join(REPORT_DIR, 'odds-api-level3-certification.json');
const REPORT_MD = path.join(REPORT_DIR, 'odds-api-level3-certification.md');

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function buildFixtureOddsByEventId(): Record<string, OddsApiEventRaw> {
  const map = buildCoverageFixtureMap();
  // Merge all book fixtures for the primary fixture event into one payload.
  const eventId = FIXTURE_EVENTS[0]!.id;
  const merged: OddsApiEventRaw = {
    ...FIXTURE_EVENTS[0]!,
    bookmakers: [],
  };
  for (const payload of Object.values(map)) {
    for (const book of payload.bookmakers ?? []) {
      merged.bookmakers!.push(book);
    }
  }
  // Expand fixture markets: only player_points in fixtures — sufficient for smoke.
  return { [eventId]: merged };
}

async function main() {
  const useFixture = process.argv.includes('--fixture');
  const maxEvents = Number(argValue('--max-events') ?? '8');

  if (useFixture) {
    const report = await runLevel3Certification({
      mode: 'fixture',
      eventsFixture: FIXTURE_EVENTS,
      oddsByEventId: buildFixtureOddsByEventId(),
      maxEvents,
      maxEventsPerBucket: 2,
      now: new Date('2026-10-21T12:00:00.000Z'),
      priorProbeRunsByBook: {
        fanduel: 2,
        draftkings: 1,
        caesars: 1,
        fanatics: 1,
        betmgm: 1,
      },
    });
    await writeReports(report);
    console.log('Wrote fixture certification reports.');
    printBrief(report);
    return;
  }

  const client = createOddsApiClientFromEnv();
  if (!client) {
    console.error('ODDS_API_KEY missing. Use --fixture or set ODDS_API_KEY.');
    process.exit(1);
  }

  console.log('Running live Level-3 certification (read-only)…');
  const report = await runLevel3Certification({
    client,
    mode: 'live',
    maxEvents: Number.isFinite(maxEvents) ? maxEvents : 8,
    maxEventsPerBucket: 2,
    maxResolutionProbesPerBook: 10,
  });

  await writeReports(report);
  console.log(`Wrote ${REPORT_JSON}`);
  console.log(`Wrote ${REPORT_MD}`);
  printBrief(report);
}

async function writeReports(report: Awaited<ReturnType<typeof runLevel3Certification>>) {
  assertNoSecretsInReport(report);
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(REPORT_MD, formatCertificationMarkdown(report), 'utf8');
}

function printBrief(report: Awaited<ReturnType<typeof runLevel3Certification>>) {
  console.log('\nPer-book ready gates:');
  for (const b of report.perBook) {
    console.log(
      `  ${b.provider}: ready=${b.level3ProviderReady} access=${b.accessLimitation} maxL=${b.maxVerifiedLevel} props=${b.propMarketPresentEvents} links=${b.outcomesWithLink}`
    );
  }
  console.log(
    `Credits: sum=${report.credits.observedCostSum} remaining ${report.credits.startingRemaining}→${report.credits.endingRemaining}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
