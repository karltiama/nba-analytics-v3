/**
 * Phase 5C — reason classifier + WOWY eligibility certification and full dry-run.
 *
 *   npx tsx scripts/ops/run-official-injury-t60-reason-policy-certification.ts
 *
 * Does NOT create WOWY pairs. Does NOT write Postgres/S3. Does NOT fetch.
 */

import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { execSync } from 'node:child_process';
import {
  OFFICIAL_INJURY_REASON_POLICY_VERSION,
  classifyOfficialInjuryReason,
} from '../../lib/injuries/official/reason-policy';
import {
  INJURY_WOWY_ELIGIBILITY_POLICY_VERSION,
  evaluateInjuryWowyEligibility,
  type EligibilityResult,
} from '../../lib/injuries/official/wowy-eligibility';

const ROOT = process.cwd();
const FIXTURE_ROOT = path.join(ROOT, 'tests/fixtures/official-injury-t60-reason-policy');
const SELECTED_GZ = path.join(
  ROOT,
  'tmp/official-injury-report-asof-t60/selected-player-states.ndjson.gz'
);
const CLASSIFIED_5B_GZ = path.join(
  ROOT,
  'tmp/official-injury-report-t60-reason-policy/classified-selected-rows.ndjson.gz'
);
const DESIGN_JSON = path.join(
  ROOT,
  'reports/operations/official-injury-report-t60-reason-policy-design.json'
);
const OUT_TMP = path.join(ROOT, 'tmp/official-injury-report-t60-eligibility');
const REPORTS = path.join(ROOT, 'reports/operations');

const REASON_PATH = path.join(ROOT, 'lib/injuries/official/reason-policy.ts');
const ELIG_PATH = path.join(ROOT, 'lib/injuries/official/wowy-eligibility.ts');
const RUNNER_PATH = path.join(
  ROOT,
  'scripts/ops/run-official-injury-t60-reason-policy-certification.ts'
);
const TEST_PATH = path.join(
  ROOT,
  'lib/injuries/official/__tests__/reason-policy.test.ts'
);

const EXPECTED_SELECTED_SHA =
  'a63e9d1552bf82818f0ed10b941ce9125ded26dca738f72dcb2c2121710f2b01';
const EXPECTED_STATUS: Record<string, number> = {
  Out: 30672,
  Available: 3630,
  Questionable: 4828,
  Doubtful: 627,
  Probable: 1710,
};

type Fixture = {
  fixture_id: string;
  split: string;
  kind: string;
  category: string;
  input: {
    status_raw: string;
    reason_raw: string;
    identity_bucket: string;
    game_id?: string;
    team_id?: string;
    player_name_raw?: string;
    season?: string;
    player_entity_id?: string | null;
  };
  expected: Record<string, unknown>;
};

function sha256File(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

function loadFixtures(split: string): Fixture[] {
  const dir = path.join(FIXTURE_ROOT, split);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Fixture);
}

function runFixture(fx: Fixture): { ok: boolean; actual: EligibilityResult; diffs: string[] } {
  const actual = evaluateInjuryWowyEligibility({
    status_raw: fx.input.status_raw,
    reason_raw: fx.input.reason_raw,
    identity_bucket: fx.input.identity_bucket,
  });
  const e = fx.expected;
  const diffs: string[] = [];
  const checks: Array<[string, unknown, unknown]> = [
    ['reason_policy_version', actual.reason_policy_version, e.reason_policy_version],
    ['eligibility_policy_version', actual.eligibility_policy_version, e.eligibility_policy_version],
    ['reason_category', actual.reason_category, e.reason_category],
    ['health_relation', actual.health_relation, e.health_relation],
    ['classification_rule', actual.classification_rule, e.classification_rule],
    ['availability_fact', actual.availability_fact, e.availability_fact],
    ['reason_side_eligibility', actual.reason_side_eligibility, e.reason_side_eligibility],
    ['canonical_identity_resolved', actual.canonical_identity_resolved, e.canonical_identity_resolved],
    ['canonical_model_eligible', actual.canonical_model_eligible, e.canonical_model_eligible],
    ['injury_wowy_eligibility', actual.injury_wowy_eligibility, e.injury_wowy_eligibility],
  ];
  for (const [k, a, exp] of checks) {
    if (a !== exp) diffs.push(`${k}:${a}!=${exp}`);
  }
  if (actual.status_raw !== fx.input.status_raw) diffs.push('status_raw_mutated');
  if (actual.reason_raw !== fx.input.reason_raw) diffs.push('reason_raw_mutated');
  return { ok: diffs.length === 0, actual, diffs };
}

async function* readNdjsonGz(filePath: string): AsyncGenerator<Record<string, unknown>> {
  const rl = readline.createInterface({
    input: createReadStream(filePath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    yield JSON.parse(line) as Record<string, unknown>;
  }
}

function openGzipWriter(filePath: string) {
  const out = createWriteStream(filePath);
  const gz = createGzip();
  gz.pipe(out);
  return {
    write(obj: unknown) {
      gz.write(JSON.stringify(obj) + '\n');
    },
    async end() {
      gz.end();
      await new Promise<void>((resolve, reject) => {
        out.on('finish', () => resolve());
        out.on('error', reject);
        gz.on('error', reject);
      });
    },
  };
}

function writeJson(p: string, obj: unknown) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function writeMd(p: string, lines: string[]) {
  writeFileSync(p, lines.join('\n') + '\n', 'utf8');
}

async function main(): Promise<number> {
  mkdirSync(OUT_TMP, { recursive: true });
  mkdirSync(REPORTS, { recursive: true });

  const design = JSON.parse(readFileSync(DESIGN_JSON, 'utf8')) as {
    artifacts: { classified_rows_gz_sha256: string };
  };
  const expectedClfSha = design.artifacts.classified_rows_gz_sha256;

  const selectedSha = sha256File(SELECTED_GZ);
  const clf5bSha = sha256File(CLASSIFIED_5B_GZ);
  if (selectedSha !== EXPECTED_SELECTED_SHA) {
    console.error('STOP: selected SHA drift', selectedSha);
    return 1;
  }
  if (clf5bSha !== expectedClfSha) {
    console.error('STOP: Phase 5B classified SHA drift', clf5bSha, expectedClfSha);
    return 1;
  }

  // --- Development + synthetic ---
  const devFixtures = loadFixtures('development');
  const synFixtures = loadFixtures('synthetic');
  const devResults = devFixtures.map((fx) => ({ fx, ...runFixture(fx) }));
  const synResults = synFixtures.map((fx) => ({ fx, ...runFixture(fx) }));
  const devExact = devResults.filter((r) => r.ok).length;
  const synExact = synResults.filter((r) => r.ok).length;
  const developmentGate =
    devExact === devFixtures.length && synExact === synFixtures.length ? 'PASS' : 'FAIL';

  const devReport = {
    generated_at: utcNow(),
    phase: '5C',
    T60_REASON_POLICY_DEVELOPMENT_GATE: developmentGate,
    reason_policy_version: OFFICIAL_INJURY_REASON_POLICY_VERSION,
    eligibility_policy_version: INJURY_WOWY_ELIGIBILITY_POLICY_VERSION,
    development: { exact: devExact, total: devFixtures.length },
    synthetic: { exact: synExact, total: synFixtures.length },
    failures: [...devResults, ...synResults]
      .filter((r) => !r.ok)
      .map((r) => ({ fixture_id: r.fx.fixture_id, diffs: r.diffs })),
    note: 'Held-out not evaluated in development gate.',
  };
  writeJson(
    path.join(REPORTS, 'official-injury-report-t60-reason-policy-development.json'),
    devReport
  );
  writeMd(path.join(REPORTS, 'official-injury-report-t60-reason-policy-development.md'), [
    '# T−60 reason policy development gate (Phase 5C)',
    '',
    `**T60_REASON_POLICY_DEVELOPMENT_GATE = ${developmentGate}**`,
    '',
    `- Development: ${devExact}/${devFixtures.length}`,
    `- Synthetic: ${synExact}/${synFixtures.length}`,
    '',
    'Held-out not accessed.',
  ]);

  if (developmentGate !== 'PASS') {
    console.error('Development gate FAIL — stopping before held-out.');
    console.error(JSON.stringify(devReport.failures, null, 2));
    return 1;
  }

  // --- Freeze fingerprints ---
  const implFingerprint = {
    fingerprinted_at: utcNow(),
    files: {
      'lib/injuries/official/reason-policy.ts': sha256File(REASON_PATH),
      'lib/injuries/official/wowy-eligibility.ts': sha256File(ELIG_PATH),
      'scripts/ops/run-official-injury-t60-reason-policy-certification.ts': sha256File(RUNNER_PATH),
      'lib/injuries/official/__tests__/reason-policy.test.ts': sha256File(TEST_PATH),
    },
    selected_player_states_sha256: selectedSha,
    phase5b_classified_sha256: clf5bSha,
    node: process.version,
    git_commit: (() => {
      try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      } catch {
        return null;
      }
    })(),
    git_working_tree: (() => {
      try {
        const s = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
        return s.length === 0 ? 'clean' : 'dirty';
      } catch {
        return null;
      }
    })(),
  };
  writeJson(path.join(OUT_TMP, 'implementation-fingerprint.json'), implFingerprint);

  // --- Blind held-out (once; immutable) ---
  const heldOutPathJson = path.join(
    REPORTS,
    'official-injury-report-t60-reason-policy-held-out-first-run.json'
  );
  const heldOutPathMd = path.join(
    REPORTS,
    'official-injury-report-t60-reason-policy-held-out-first-run.md'
  );

  let hoExact: number;
  let hoTotal: number;
  let hoPass: boolean;
  let heldOutFirst: Record<string, unknown>;

  if (existsSync(heldOutPathJson)) {
    heldOutFirst = JSON.parse(readFileSync(heldOutPathJson, 'utf8')) as Record<string, unknown>;
    const prior = heldOutFirst.held_out as { exact: number; total: number };
    hoExact = prior.exact;
    hoTotal = prior.total;
    hoPass =
      heldOutFirst.T60_REASON_POLICY_CERTIFIED === 'YES' &&
      heldOutFirst.WOWY_ELIGIBILITY_POLICY_CERTIFIED === 'YES' &&
      hoExact === hoTotal;
    if (!hoPass) {
      console.error('STOP: existing held-out first-run did not certify; do not overwrite.');
      return 1;
    }
    console.log(`Reusing immutable held-out first-run (${hoExact}/${hoTotal}).`);
  } else {
    const hoFixtures = loadFixtures('held_out');
    const hoResults = hoFixtures.map((fx) => ({ fx, ...runFixture(fx) }));
    hoExact = hoResults.filter((r) => r.ok).length;
    hoTotal = hoFixtures.length;
    hoPass = hoExact === hoTotal;

    heldOutFirst = {
      generated_at: utcNow(),
      phase: '5C',
      immutable_first_run: true,
      implementation_fingerprint: implFingerprint,
      held_out: { exact: hoExact, total: hoTotal },
      synthetic_recheck: { exact: synExact, total: synFixtures.length },
      T60_REASON_POLICY_CERTIFIED: hoPass ? 'YES' : 'NO',
      WOWY_ELIGIBILITY_POLICY_CERTIFIED: hoPass ? 'YES' : 'NO',
      results: hoResults.map((r) => ({
        fixture_id: r.fx.fixture_id,
        category: r.fx.category,
        ok: r.ok,
        diffs: r.diffs,
        actual: {
          reason_category: r.actual.reason_category,
          health_relation: r.actual.health_relation,
          classification_rule: r.actual.classification_rule,
          injury_wowy_eligibility: r.actual.injury_wowy_eligibility,
          canonical_model_eligible: r.actual.canonical_model_eligible,
        },
      })),
    };
    writeJson(heldOutPathJson, heldOutFirst);
    writeMd(heldOutPathMd, [
      '# T−60 reason policy held-out first run (Phase 5C)',
      '',
      `Immutable first run: **YES**`,
      '',
      `Held-out: **${hoExact}/${hoTotal}**`,
      '',
      `T60_REASON_POLICY_CERTIFIED = ${heldOutFirst.T60_REASON_POLICY_CERTIFIED}`,
      `WOWY_ELIGIBILITY_POLICY_CERTIFIED = ${heldOutFirst.WOWY_ELIGIBILITY_POLICY_CERTIFIED}`,
    ]);

    if (!hoPass) {
      console.error('Held-out FAIL — STOP. Do not patch under same certification claim.');
      return 1;
    }
  }

  // Verify fingerprint unchanged
  const fpNow = {
    'lib/injuries/official/reason-policy.ts': sha256File(REASON_PATH),
    'lib/injuries/official/wowy-eligibility.ts': sha256File(ELIG_PATH),
  };
  if (
    fpNow['lib/injuries/official/reason-policy.ts'] !==
      implFingerprint.files['lib/injuries/official/reason-policy.ts'] ||
    fpNow['lib/injuries/official/wowy-eligibility.ts'] !==
      implFingerprint.files['lib/injuries/official/wowy-eligibility.ts']
  ) {
    console.error('STOP: implementation changed after fingerprint');
    return 1;
  }

  // --- Full corpus dry-run (twice for determinism) ---
  async function runFull(): Promise<{
    sha: string;
    stats: Record<string, unknown>;
    paths: Record<string, { sha256: string; bytes: number; count: number }>;
  }> {
    const statusCounts: Record<string, number> = {};
    let n = 0;
    let sourcePreserveOk = 0;
    const healthByStatus: Record<string, Record<string, number>> = {};
    const catCounts: Record<string, number> = {};
    const catSeasons: Record<string, Record<string, number>> = {};
    const catStatuses: Record<string, Record<string, number>> = {};
    const catReasons: Record<string, Set<string>> = {};
    const unclassifiedExact: Record<
      string,
      { count: number; statuses: Set<string>; seasons: Record<string, number> }
    > = {};
    const outNonHealthByCat: Record<string, number> = {};
    const availNonHealthByCat: Record<string, number> = {};
    let nonBinaryViolations = 0;
    let without = 0;
    let withC = 0;
    let withoutBySeason: Record<string, number> = {};
    let withBySeason: Record<string, number> = {};
    let idqOutHealth = 0;
    let idqAvailHealth = 0;
    let outHealth = 0;
    let outNon = 0;
    let outUnc = 0;
    let availHealth = 0;
    let availNon = 0;
    let availUnc = 0;
    let outCanonHealth = 0;
    let availCanonHealth = 0;
    let nonBinary = 0;
    let nonHealthExcluded = 0;
    let unclassifiedExcluded = 0;
    let policyBAvailCanon = 0;
    let policyBExtraNonHealth = 0;
    let policyBExtraUnc = 0;

    const withoutEntities = new Set<string>();
    const withoutGames = new Set<string>();
    const withoutTeamGames = new Set<string>();
    const withEntities = new Set<string>();
    const withGames = new Set<string>();
    const withTeamGames = new Set<string>();

    const allPath = path.join(OUT_TMP, 'all-results.ndjson.gz');
    const withoutPath = path.join(OUT_TMP, 'without-candidates.ndjson.gz');
    const withPath = path.join(OUT_TMP, 'with-candidates.ndjson.gz');
    const nonBinPath = path.join(OUT_TMP, 'non-binary.ndjson.gz');
    const exclNhPath = path.join(OUT_TMP, 'excluded-non-health.ndjson.gz');
    const exclUncPath = path.join(OUT_TMP, 'excluded-unclassified.ndjson.gz');
    const idqPath = path.join(OUT_TMP, 'identity-quarantined-health.ndjson.gz');

    const allW = openGzipWriter(allPath);
    const withoutW = openGzipWriter(withoutPath);
    const withW = openGzipWriter(withPath);
    const nonBinW = openGzipWriter(nonBinPath);
    const exclNhW = openGzipWriter(exclNhPath);
    const exclUncW = openGzipWriter(exclUncPath);
    const idqW = openGzipWriter(idqPath);

    let withoutN = 0;
    let withN = 0;
    let nonBinN = 0;
    let exclNhN = 0;
    let exclUncN = 0;
    let idqN = 0;

    const hash = createHash('sha256');

    for await (const row of readNdjsonGz(SELECTED_GZ)) {
      n += 1;
      const status = String(row.status_raw ?? '');
      const reason = row.reason_raw == null ? null : String(row.reason_raw);
      const identity = row.identity_bucket == null ? null : String(row.identity_bucket);
      const season = String(row.season ?? '');
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      const result = evaluateInjuryWowyEligibility({
        status_raw: status,
        reason_raw: reason,
        identity_bucket: identity,
      });

      if (result.status_raw === status && result.reason_raw === reason) sourcePreserveOk += 1;

      // canonical hash line (no timestamps)
      const canonLine = JSON.stringify({
        game_id: row.game_id,
        team_id: row.team_id,
        player_name_raw: row.player_name_raw,
        status_raw: result.status_raw,
        reason_raw: result.reason_raw,
        reason_category: result.reason_category,
        health_relation: result.health_relation,
        classification_rule: result.classification_rule,
        availability_fact: result.availability_fact,
        reason_side_eligibility: result.reason_side_eligibility,
        identity_status: result.identity_status,
        canonical_identity_resolved: result.canonical_identity_resolved,
        canonical_model_eligible: result.canonical_model_eligible,
        injury_wowy_eligibility: result.injury_wowy_eligibility,
      });
      hash.update(canonLine + '\n');

      const outRow = {
        game_id: row.game_id,
        team_id: row.team_id,
        season: row.season,
        player_name_raw: row.player_name_raw,
        player_entity_id: row.player_entity_id,
        ...result,
      };
      allW.write(outRow);

      catCounts[result.reason_category] = (catCounts[result.reason_category] || 0) + 1;
      if (!catSeasons[result.reason_category]) catSeasons[result.reason_category] = {};
      catSeasons[result.reason_category][season] =
        (catSeasons[result.reason_category][season] || 0) + 1;
      if (!catStatuses[result.reason_category]) catStatuses[result.reason_category] = {};
      catStatuses[result.reason_category][status] =
        (catStatuses[result.reason_category][status] || 0) + 1;
      if (!catReasons[result.reason_category]) catReasons[result.reason_category] = new Set();
      if (reason != null) catReasons[result.reason_category].add(reason);

      if (!healthByStatus[status]) healthByStatus[status] = {};
      healthByStatus[status][result.health_relation] =
        (healthByStatus[status][result.health_relation] || 0) + 1;

      if (
        result.reason_category === 'UNCLASSIFIED' ||
        result.reason_category === 'PLACEHOLDER_REASON'
      ) {
        const k = reason ?? '';
        if (!unclassifiedExact[k]) {
          unclassifiedExact[k] = { count: 0, statuses: new Set(), seasons: {} };
        }
        unclassifiedExact[k].count += 1;
        unclassifiedExact[k].statuses.add(status);
        unclassifiedExact[k].seasons[season] = (unclassifiedExact[k].seasons[season] || 0) + 1;
      }

      if (status === 'Out') {
        if (result.health_relation === 'HEALTH_RELATED') {
          outHealth += 1;
          if (result.canonical_identity_resolved) outCanonHealth += 1;
          if (identity === 'IDENTITY_QUARANTINED') idqOutHealth += 1;
        } else if (result.health_relation === 'NON_HEALTH_RELATED') {
          outNon += 1;
          outNonHealthByCat[result.reason_category] =
            (outNonHealthByCat[result.reason_category] || 0) + 1;
        } else outUnc += 1;
      }
      if (status === 'Available') {
        if (result.health_relation === 'HEALTH_RELATED') {
          availHealth += 1;
          if (result.canonical_identity_resolved) availCanonHealth += 1;
          if (identity === 'IDENTITY_QUARANTINED') idqAvailHealth += 1;
        } else if (result.health_relation === 'NON_HEALTH_RELATED') {
          availNon += 1;
          availNonHealthByCat[result.reason_category] =
            (availNonHealthByCat[result.reason_category] || 0) + 1;
        } else availUnc += 1;
      }

      if (status === 'Questionable' || status === 'Doubtful' || status === 'Probable') {
        nonBinary += 1;
        if (result.injury_wowy_eligibility !== 'NON_BINARY_UNKNOWN') nonBinaryViolations += 1;
        nonBinW.write(outRow);
        nonBinN += 1;
      }

      if (result.injury_wowy_eligibility === 'NON_HEALTH_EXCLUDED') {
        nonHealthExcluded += 1;
        exclNhW.write(outRow);
        exclNhN += 1;
      }
      if (result.injury_wowy_eligibility === 'UNCLASSIFIED_EXCLUDED') {
        unclassifiedExcluded += 1;
        exclUncW.write(outRow);
        exclUncN += 1;
      }

      if (
        result.health_relation === 'HEALTH_RELATED' &&
        identity === 'IDENTITY_QUARANTINED'
      ) {
        idqW.write(outRow);
        idqN += 1;
      }

      if (
        result.canonical_model_eligible &&
        result.injury_wowy_eligibility === 'WITHOUT_CANDIDATE'
      ) {
        without += 1;
        withoutBySeason[season] = (withoutBySeason[season] || 0) + 1;
        withoutW.write(outRow);
        withoutN += 1;
        if (row.player_entity_id) withoutEntities.add(String(row.player_entity_id));
        if (row.game_id) withoutGames.add(String(row.game_id));
        withoutTeamGames.add(`${row.game_id}|${row.team_id}`);
      }
      if (
        result.canonical_model_eligible &&
        result.injury_wowy_eligibility === 'WITH_CANDIDATE'
      ) {
        withC += 1;
        withBySeason[season] = (withBySeason[season] || 0) + 1;
        withW.write(outRow);
        withN += 1;
        if (row.player_entity_id) withEntities.add(String(row.player_entity_id));
        if (row.game_id) withGames.add(String(row.game_id));
        withTeamGames.add(`${row.game_id}|${row.team_id}`);
      }

      // Policy B diagnostic
      if (status === 'Available' && result.canonical_identity_resolved) {
        policyBAvailCanon += 1;
        if (result.injury_wowy_eligibility !== 'WITH_CANDIDATE') {
          if (result.health_relation === 'NON_HEALTH_RELATED') policyBExtraNonHealth += 1;
          else if (result.health_relation === 'UNCLASSIFIED') policyBExtraUnc += 1;
        }
      }
    }

    await allW.end();
    await withoutW.end();
    await withW.end();
    await nonBinW.end();
    await exclNhW.end();
    await exclUncW.end();
    await idqW.end();

    const artifactMeta = (p: string, count: number) => ({
      sha256: sha256File(p),
      bytes: statSync(p).size,
      count,
    });

    const paths = {
      'all-results.ndjson.gz': artifactMeta(allPath, n),
      'without-candidates.ndjson.gz': artifactMeta(withoutPath, withoutN),
      'with-candidates.ndjson.gz': artifactMeta(withPath, withN),
      'non-binary.ndjson.gz': artifactMeta(nonBinPath, nonBinN),
      'excluded-non-health.ndjson.gz': artifactMeta(exclNhPath, exclNhN),
      'excluded-unclassified.ndjson.gz': artifactMeta(exclUncPath, exclUncN),
      'identity-quarantined-health.ndjson.gz': artifactMeta(idqPath, idqN),
    };

    const classifiable = n - (outUnc + availUnc + Object.values(healthByStatus)
      .reduce((acc, h) => acc + (h.UNCLASSIFIED || 0), 0) - outUnc - availUnc);
    // simpler: rows where health != UNCLASSIFIED
    let healthRelated = 0;
    let nonHealthRelated = 0;
    let unclassifiedHr = 0;
    for (const st of Object.keys(healthByStatus)) {
      healthRelated += healthByStatus[st].HEALTH_RELATED || 0;
      nonHealthRelated += healthByStatus[st].NON_HEALTH_RELATED || 0;
      unclassifiedHr += healthByStatus[st].UNCLASSIFIED || 0;
    }

    const uniqueReasons = new Set<string>();
    for (const set of Object.values(catReasons)) {
      for (const r of set) uniqueReasons.add(r);
    }

    const stats = {
      processed: n,
      status_counts: statusCounts,
      source_preserve_ok: sourcePreserveOk,
      unique_reasons: uniqueReasons.size,
      classification_rate: (n - unclassifiedHr) / n,
      health_related: healthRelated,
      non_health_related: nonHealthRelated,
      unclassified: unclassifiedHr,
      health_by_status: healthByStatus,
      reason_category_counts: catCounts,
      reason_category_seasons: catSeasons,
      reason_category_statuses: catStatuses,
      reason_category_unique_reasons: Object.fromEntries(
        Object.entries(catReasons).map(([k, v]) => [k, v.size])
      ),
      unclassified_exact: Object.fromEntries(
        Object.entries(unclassifiedExact).map(([k, v]) => [
          k,
          {
            count: v.count,
            statuses: [...v.statuses].sort(),
            seasons: v.seasons,
            eligibility: 'UNCLASSIFIED_EXCLUDED',
          },
        ])
      ),
      out: {
        total: statusCounts.Out || 0,
        health_related: outHealth,
        non_health: outNon,
        unclassified: outUnc,
        canonical_health: outCanonHealth,
        identity_quarantined_health: idqOutHealth,
        non_health_by_category: outNonHealthByCat,
      },
      available: {
        total: statusCounts.Available || 0,
        health_related: availHealth,
        non_health: availNon,
        unclassified: availUnc,
        canonical_health: availCanonHealth,
        identity_quarantined_health: idqAvailHealth,
        non_health_by_category: availNonHealthByCat,
      },
      eligibility: {
        without_candidates: without,
        with_candidates: withC,
        without_by_season: withoutBySeason,
        with_by_season: withBySeason,
        without_unique_entities: withoutEntities.size,
        without_unique_games: withoutGames.size,
        without_unique_team_games: withoutTeamGames.size,
        with_unique_entities: withEntities.size,
        with_unique_games: withGames.size,
        with_unique_team_games: withTeamGames.size,
        non_binary: nonBinary,
        non_health_excluded: nonHealthExcluded,
        unclassified_excluded: unclassifiedExcluded,
        non_binary_violations: nonBinaryViolations,
      },
      policy_b_diagnostic: {
        all_available_canonical: policyBAvailCanon,
        policy_a_with: withC,
        extras_beyond_a: policyBAvailCanon - withC,
        extras_non_health: policyBExtraNonHealth,
        extras_unclassified: policyBExtraUnc,
      },
    };

    return { sha: hash.digest('hex'), stats, paths };
  }

  // Verify input counts before full run
  {
    const sc: Record<string, number> = {};
    let n = 0;
    for await (const row of readNdjsonGz(SELECTED_GZ)) {
      n += 1;
      const s = String(row.status_raw);
      sc[s] = (sc[s] || 0) + 1;
    }
    if (n !== 41467) throw new Error(`selected n drift ${n}`);
    for (const [k, v] of Object.entries(EXPECTED_STATUS)) {
      if (sc[k] !== v) throw new Error(`status drift ${k}`);
    }
  }

  const run1 = await runFull();
  // second pass: hash only for determinism (reuse classify on input)
  const hash2 = createHash('sha256');
  for await (const row of readNdjsonGz(SELECTED_GZ)) {
    const result = evaluateInjuryWowyEligibility({
      status_raw: String(row.status_raw ?? ''),
      reason_raw: row.reason_raw == null ? null : String(row.reason_raw),
      identity_bucket: row.identity_bucket == null ? null : String(row.identity_bucket),
    });
    hash2.update(
      JSON.stringify({
        game_id: row.game_id,
        team_id: row.team_id,
        player_name_raw: row.player_name_raw,
        status_raw: result.status_raw,
        reason_raw: result.reason_raw,
        reason_category: result.reason_category,
        health_relation: result.health_relation,
        classification_rule: result.classification_rule,
        availability_fact: result.availability_fact,
        reason_side_eligibility: result.reason_side_eligibility,
        identity_status: result.identity_status,
        canonical_identity_resolved: result.canonical_identity_resolved,
        canonical_model_eligible: result.canonical_model_eligible,
        injury_wowy_eligibility: result.injury_wowy_eligibility,
      }) + '\n'
    );
  }
  const run2Sha = hash2.digest('hex');
  const deterministic = run1.sha === run2Sha;

  // Season splits: use approved Phase 5B design artifact (not stale prompt drafts).
  const designElig = JSON.parse(readFileSync(DESIGN_JSON, 'utf8')) as {
    eligibility_candidate_population: {
      without_health_related_canonical: { rows: number; by_season: Record<string, number> };
      with_policy_a_health_related_canonical: { rows: number; by_season: Record<string, number> };
      with_policy_b_all_available_canonical: { rows: number };
    };
    out: {
      health_related: number;
      non_health_related: number;
      unclassified_health_relation: number;
      identity_quarantined_health_related: number;
    };
    available: {
      health_related: number;
      non_health_related: number;
      unclassified_health_relation: number;
      identity_quarantined_health_related: number;
    };
  };
  const dOut = designElig.out;
  const dAvail = designElig.available;
  const dWithout = designElig.eligibility_candidate_population.without_health_related_canonical;
  const dWith = designElig.eligibility_candidate_population.with_policy_a_health_related_canonical;
  const dPolB = designElig.eligibility_candidate_population.with_policy_b_all_available_canonical;

  const phase5bMatch = {
    out_health: (run1.stats as any).out.health_related === dOut.health_related,
    out_non: (run1.stats as any).out.non_health === dOut.non_health_related,
    out_unc: (run1.stats as any).out.unclassified === dOut.unclassified_health_relation,
    avail_health: (run1.stats as any).available.health_related === dAvail.health_related,
    avail_non: (run1.stats as any).available.non_health === dAvail.non_health_related,
    avail_unc: (run1.stats as any).available.unclassified === dAvail.unclassified_health_relation,
    without: (run1.stats as any).eligibility.without_candidates === dWithout.rows,
    with: (run1.stats as any).eligibility.with_candidates === dWith.rows,
    without_2023:
      (run1.stats as any).eligibility.without_by_season['2023'] === dWithout.by_season['2023'],
    without_2024:
      (run1.stats as any).eligibility.without_by_season['2024'] === dWithout.by_season['2024'],
    without_2025:
      (run1.stats as any).eligibility.without_by_season['2025'] === dWithout.by_season['2025'],
    with_2023: (run1.stats as any).eligibility.with_by_season['2023'] === dWith.by_season['2023'],
    with_2024: (run1.stats as any).eligibility.with_by_season['2024'] === dWith.by_season['2024'],
    with_2025: (run1.stats as any).eligibility.with_by_season['2025'] === dWith.by_season['2025'],
    idq_out:
      (run1.stats as any).out.identity_quarantined_health ===
      dOut.identity_quarantined_health_related,
    idq_avail:
      (run1.stats as any).available.identity_quarantined_health ===
      dAvail.identity_quarantined_health_related,
    policy_b: (run1.stats as any).policy_b_diagnostic.all_available_canonical === dPolB.rows,
  };
  const phase5bAllMatch = Object.values(phase5bMatch).every(Boolean);

  const fullGate =
    (run1.stats as any).processed === 41467 &&
    (run1.stats as any).source_preserve_ok === 41467 &&
    (run1.stats as any).eligibility.non_binary_violations === 0 &&
    deterministic &&
    phase5bAllMatch
      ? 'PASS'
      : 'FAIL';

  const safety = {
    llm_classifier_used: 'NO',
    fuzzy_reason_classification: 'NO',
    unknown_to_health_fallback: 'NO',
    postgame_participation_used: 'NO',
    questionable_to_with: 'NO',
    doubtful_to_with: 'NO',
    probable_to_with: 'NO',
    missing_to_with: 'NO',
    nys_to_with: 'NO',
    all_available_to_with: 'NO',
  };

  const runState = {
    generated_at: utcNow(),
    processed: (run1.stats as any).processed,
    output_canonical_sha256: run1.sha,
    output_canonical_sha256_rerun: run2Sha,
    deterministic,
    artifacts: run1.paths,
    phase5b_reproduction: phase5bMatch,
  };
  writeJson(path.join(OUT_TMP, 'run-state.json'), runState);

  const cert = {
    generated_at: utcNow(),
    phase: '5C',
    T60_REASON_POLICY_CERTIFIED: 'YES',
    WOWY_ELIGIBILITY_POLICY_CERTIFIED: 'YES',
    T60_WOWY_ELIGIBILITY_FULL_RUN_GATE: fullGate,
    AS_OF_INJURY_TAPE_CERTIFIED: 'YES',
    reason_policy_version: OFFICIAL_INJURY_REASON_POLICY_VERSION,
    eligibility_policy_version: INJURY_WOWY_ELIGIBILITY_POLICY_VERSION,
    implementation_paths: {
      reason_classifier: 'lib/injuries/official/reason-policy.ts',
      eligibility_policy: 'lib/injuries/official/wowy-eligibility.ts',
    },
    implementation_sha256: implFingerprint.files,
    development: { exact: devExact, total: devFixtures.length },
    synthetic: { exact: synExact, total: synFixtures.length },
    held_out_first_run: { exact: hoExact, total: hoTotal, immutable: true },
    fingerprints: implFingerprint,
    safety,
    NEXT:
      fullGate === 'PASS'
        ? 'PROCEED_TO_INJURY_WOWY_PAIR_DESIGN_AND_COVERAGE_AUDIT'
        : 'REOPEN_DEVELOPMENT',
  };
  writeJson(
    path.join(REPORTS, 'official-injury-report-t60-reason-policy-certification.json'),
    cert
  );
  writeMd(path.join(REPORTS, 'official-injury-report-t60-reason-policy-certification.md'), [
    '# T−60 reason + WOWY eligibility certification (Phase 5C)',
    '',
    `**T60_REASON_POLICY_CERTIFIED = YES**`,
    `**WOWY_ELIGIBILITY_POLICY_CERTIFIED = YES**`,
    `**T60_WOWY_ELIGIBILITY_FULL_RUN_GATE = ${fullGate}**`,
    `**AS_OF_INJURY_TAPE_CERTIFIED = YES**`,
    '',
    `- Reason: \`lib/injuries/official/reason-policy.ts\``,
    `- Eligibility: \`lib/injuries/official/wowy-eligibility.ts\``,
    `- Versions: \`${OFFICIAL_INJURY_REASON_POLICY_VERSION}\` / \`${INJURY_WOWY_ELIGIBILITY_POLICY_VERSION}\``,
    `- Development: ${devExact}/${devFixtures.length}`,
    `- Synthetic: ${synExact}/${synFixtures.length}`,
    `- Held-out first run: ${hoExact}/${hoTotal} (immutable)`,
    '',
    `NEXT = ${cert.NEXT}`,
  ]);

  const fullReport = {
    generated_at: utcNow(),
    phase: '5C',
    T60_WOWY_ELIGIBILITY_FULL_RUN_GATE: fullGate,
    AS_OF_INJURY_TAPE_CERTIFIED: 'YES',
    input: {
      selected_sha256: selectedSha,
      phase5b_classified_sha256: clf5bSha,
      expected_rows: 41467,
    },
    implementation_fingerprint: implFingerprint,
    deterministic,
    output_canonical_sha256: run1.sha,
    phase5b_reproduction: phase5bMatch,
    stats: run1.stats,
    artifacts: run1.paths,
    safety,
    NEXT: cert.NEXT,
  };
  writeJson(
    path.join(REPORTS, 'official-injury-report-t60-eligibility-full-run.json'),
    fullReport
  );

  const s = run1.stats as any;
  writeMd(path.join(REPORTS, 'official-injury-report-t60-eligibility-full-run.md'), [
    '# T−60 WOWY eligibility full dry-run (Phase 5C)',
    '',
    `**T60_WOWY_ELIGIBILITY_FULL_RUN_GATE = ${fullGate}**`,
    `**AS_OF_INJURY_TAPE_CERTIFIED = YES**`,
    '',
    `Processed: **${s.processed} / 41467**`,
    `Source preserve: **${s.source_preserve_ok}**`,
    `Deterministic: **${deterministic}**`,
    `Phase 5B reproduction: **${phase5bAllMatch}**`,
    '',
    '## Out',
    '',
    JSON.stringify(s.out, null, 2),
    '',
    '## Available',
    '',
    JSON.stringify(s.available, null, 2),
    '',
    '## Eligibility candidates',
    '',
    JSON.stringify(s.eligibility, null, 2),
    '',
    '## Policy B diagnostic',
    '',
    JSON.stringify(s.policy_b_diagnostic, null, 2),
    '',
    '## Unclassified exact',
    '',
    JSON.stringify(s.unclassified_exact, null, 2),
  ]);

  console.log(
    JSON.stringify(
      {
        T60_REASON_POLICY_CERTIFIED: 'YES',
        WOWY_ELIGIBILITY_POLICY_CERTIFIED: 'YES',
        T60_WOWY_ELIGIBILITY_FULL_RUN_GATE: fullGate,
        development: `${devExact}/${devFixtures.length}`,
        synthetic: `${synExact}/${synFixtures.length}`,
          held_out: `${hoExact}/${hoTotal}`,
        without: s.eligibility.without_candidates,
        with: s.eligibility.with_candidates,
        phase5b_match: phase5bAllMatch,
        deterministic,
        NEXT: cert.NEXT,
      },
      null,
      2
    )
  );

  return fullGate === 'PASS' ? 0 : 1;
}

main().then((code) => process.exit(code));
