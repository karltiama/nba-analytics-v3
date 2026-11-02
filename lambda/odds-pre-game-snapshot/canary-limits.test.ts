import assert from 'node:assert/strict';
import {
  OPENING_NIGHT_ODDS_MAX_PAGES,
  assertCanaryEvent,
  assertCanaryGames,
  assertCanaryLimiter,
  isOpeningNightCanaryEvent,
  oddsPageDecision,
} from './canary-limits';

const limiter = {
  BDL_RATE_LIMIT_INTERVAL_MS: '13000',
  BDL_RATE_LIMIT_MAX_REQUESTS: '1',
  BDL_RATE_LIMIT_BURST: '1',
  BDL_RATE_LIMIT_MAX_RETRIES: '0',
};

assert.deepEqual(assertCanaryEvent({ dates: ['2026-10-20'] }), ['2026-10-20']);

for (const event of [
  {},
  { dates: ['2026-10-20', '2026-10-21'] },
  { date: '2026-10-20' },
  { date: '2026-10-20', dates: ['2026-10-20'] },
  { dates: ['2026-10-21'] },
]) {
  assert.throws(() => assertCanaryEvent(event), /2026-10-20/);
}

assert.doesNotThrow(() => assertCanaryLimiter(limiter));
assert.throws(() => assertCanaryLimiter({ ...limiter, BDL_RATE_LIMIT_INTERVAL_MS: '500' }), /INTERVAL_MS/);
assert.throws(() => assertCanaryLimiter({ ...limiter, BDL_RATE_LIMIT_BURST: '5' }), /BURST/);
assert.throws(() => assertCanaryLimiter({ ...limiter, BDL_RATE_LIMIT_MAX_RETRIES: undefined }), /MAX_RETRIES/);

assert.equal(oddsPageDecision(0, null, OPENING_NIGHT_ODDS_MAX_PAGES), 'continue');
assert.equal(oddsPageDecision(1, 20, OPENING_NIGHT_ODDS_MAX_PAGES), 'continue');
assert.equal(oddsPageDecision(1, null, OPENING_NIGHT_ODDS_MAX_PAGES), 'stop');
assert.equal(oddsPageDecision(3, null, OPENING_NIGHT_ODDS_MAX_PAGES), 'stop');
assert.equal(oddsPageDecision(3, 99, OPENING_NIGHT_ODDS_MAX_PAGES), 'cap');
assert.equal(oddsPageDecision(4, 99, undefined), 'continue');

const okcTipUtc = new Date('2026-10-21T01:30:00.000Z');
const okcEtDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(okcTipUtc);
assert.equal(okcEtDate, '2026-10-20');
assert.equal(isOpeningNightCanaryEvent({ dates: [okcEtDate] }), true);
assert.equal(isOpeningNightCanaryEvent({ dates: ['2026-10-21'] }), false);
assert.throws(() => assertCanaryEvent({ dates: [okcEtDate, '2026-10-21'] }), /2026-10-20/);

assert.doesNotThrow(() => assertCanaryGames([21717855, 21717856]));
assert.doesNotThrow(() => assertCanaryGames([]));
assert.throws(() => assertCanaryGames([21717855, 21717922]), /21717922/);

console.log('canary-limits tests passed');
