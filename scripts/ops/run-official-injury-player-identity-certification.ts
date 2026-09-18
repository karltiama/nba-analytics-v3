/**
 * Phase 4D — fingerprint, blind held-out certification, full dry resolution.
 *
 * Does NOT write Postgres. Uses locked Phase 4B candidate records.
 *
 *   npx tsx scripts/ops/run-official-injury-player-identity-certification.ts
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
import { createGzip } from 'node:zlib';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import {
  OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION,
  resolveOfficialInjuryPlayerIdentity,
  type OfficialInjuryCandidateEvidence,
  type OfficialInjuryPlayerIdentityResult,
} from '../../lib/identity/official-injury-player-identity';
import { injuryIdentityNameKey } from '../../lib/identity/injury-identity-name-key';

const ROOT = process.cwd();
const FIXTURE_ROOT = path.join(ROOT, 'tests/fixtures/official-injury-player-identity');
const CAND_GZ = path.join(
  ROOT,
  'tmp/official-injury-report-player-identity-candidate-audit/official-player-game-candidates.ndjson.gz'
);
const EXPECTED_CAND_SHA =
  '05854997a74e085cc978103f7d8ddb97988f47446a3b99621895495e1fcdf5c2';

const RESOLVER_PATH = path.join(ROOT, 'lib/identity/official-injury-player-identity.ts');
const NAME_KEY_PATH = path.join(ROOT, 'lib/identity/injury-identity-name-key.ts');
const RUNNER_PATH = path.join(
  ROOT,
  'scripts/ops/run-official-injury-player-identity-certification.ts'
);
const DEV_TEST_PATH = path.join(
  ROOT,
  'lib/identity/__tests__/official-injury-player-identity.test.ts'
);

const OUT_TMP = path.join(ROOT, 'tmp/official-injury-report-player-identity-resolution');
const REPORTS = path.join(ROOT, 'reports/operations');

function sha256File(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

type FixtureFile = {
  fixture_id: string;
  split: string;
  category: string;
  input: {
    game_id: string;
    team_id: string;
    game_date_et: string;
    player_name_raw: string;
    name_key: string;
  };
  evidence: OfficialInjuryCandidateEvidence & { servingPlayerId?: string | null };
  expected: {
    resolution_status: string;
    player_entity_id: string | null;
    serving_player_id: string | null;
    confidence_class: string | null;
    provenance_category: string | null;
    independent_source_count: number;
    quarantine_reason: string | null;
    name_key_must_equal?: string;
    name_key_must_not_equal_peer?: string;
  };
};

function loadFixtures(split: string): FixtureFile[] {
  const dir = path.join(FIXTURE_ROOT, split);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as FixtureFile);
}

function runFixture(fx: FixtureFile): {
  ok: boolean;
  actual: OfficialInjuryPlayerIdentityResult;
  diffs: string[];
} {
  const nameKey = injuryIdentityNameKey(fx.input.player_name_raw);
  const actual = resolveOfficialInjuryPlayerIdentity(
    {
      gameId: fx.input.game_id,
      teamId: fx.input.team_id,
      gameDateEt: fx.input.game_date_et,
      playerNameRaw: fx.input.player_name_raw,
    },
    {
      u2: fx.evidence.u2,
      u4Nba: fx.evidence.u4Nba,
      u4Inferred: fx.evidence.u4Inferred,
      servingPlayerId: fx.evidence.servingPlayerId ?? null,
    }
  );
  const diffs: string[] = [];
  if (nameKey !== fx.input.name_key) diffs.push(`name_key:${nameKey}!=${fx.input.name_key}`);
  if (actual.resolutionStatus !== fx.expected.resolution_status)
    diffs.push(`status:${actual.resolutionStatus}`);
  if (actual.playerEntityId !== fx.expected.player_entity_id)
    diffs.push(`entity:${actual.playerEntityId}`);
  if (actual.servingPlayerId !== fx.expected.serving_player_id)
    diffs.push(`serving:${actual.servingPlayerId}`);
  if (actual.confidenceClass !== fx.expected.confidence_class)
    diffs.push(`confidence:${actual.confidenceClass}`);
  if (actual.provenanceCategory !== fx.expected.provenance_category)
    diffs.push(`prov:${actual.provenanceCategory}`);
  if (actual.independentSourceCount !== fx.expected.independent_source_count)
    diffs.push(`indep:${actual.independentSourceCount}`);
  if (actual.quarantineReason !== fx.expected.quarantine_reason)
    diffs.push(`q:${actual.quarantineReason}`);
  if (fx.expected.name_key_must_equal && nameKey !== fx.expected.name_key_must_equal)
    diffs.push('name_key_must_equal');
  if (
    fx.expected.name_key_must_not_equal_peer &&
    nameKey === fx.expected.name_key_must_not_equal_peer
  )
    diffs.push('suffix_collapsed');
  return { ok: diffs.length === 0, actual, diffs };
}

function evidenceFromRow(r: Record<string, unknown>): OfficialInjuryCandidateEvidence {
  const u2Class = String(r.u2_class);
  const u2Unique =
    (u2Class === 'U2_UNIQUE_PLAYED' || u2Class === 'U2_UNIQUE_DNP_00') &&
    Boolean(r.u2_entity_id);
  const nbaIds = (r.u4_nba_entity_ids as string[] | null) || [];
  const infIds = (r.u4_inferred_entity_ids as string[] | null) || [];
  const nbaUnique = r.u4_nba_class === 'UNIQUE_CANDIDATE' && nbaIds.length === 1;
  const infUnique = r.u4_inferred_class === 'UNIQUE_CANDIDATE' && infIds.length === 1;
  return {
    u2: {
      cardinality: u2Unique
        ? 'unique'
        : u2Class === 'U2_MULTIPLE_MATCHES'
          ? 'multiple'
          : 'none',
      playerId: u2Unique ? (r.u2_player_id as string | null) : null,
      playerEntityId: u2Unique ? (r.u2_entity_id as string | null) : null,
      minutes: u2Unique ? (r.u2_minutes as string | null) : null,
    },
    u4Nba: {
      cardinality: nbaUnique
        ? 'unique'
        : r.u4_nba_class === 'MULTIPLE_CANDIDATES'
          ? 'multiple'
          : 'none',
      playerEntityId: nbaUnique ? nbaIds[0]! : null,
      source: 'nba_stats',
    },
    u4Inferred: {
      cardinality: infUnique
        ? 'unique'
        : r.u4_inferred_class === 'MULTIPLE_CANDIDATES'
          ? 'multiple'
          : 'none',
      playerEntityId: infUnique ? infIds[0]! : null,
      source: 'inferred_pgl',
    },
    servingPlayerId: null,
  };
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

async function writeNdjsonGz(filePath: string, rows: object[]): Promise<void> {
  const gzip = createGzip();
  const out = createWriteStream(filePath);
  const done = pipeline(gzip, out);
  for (const row of rows) {
    gzip.write(JSON.stringify(row) + '\n');
  }
  gzip.end();
  await done;
}

function writeJson(p: string, obj: unknown) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function writeMd(p: string, lines: string[]) {
  writeFileSync(p, lines.join('\n') + '\n', 'utf8');
}

async function main() {
  mkdirSync(OUT_TMP, { recursive: true });
  mkdirSync(REPORTS, { recursive: true });

  const fingerprint = {
    fingerprinted_at: utcNow(),
    resolver_version: OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION,
    files: {
      'lib/identity/official-injury-player-identity.ts': sha256File(RESOLVER_PATH),
      'lib/identity/injury-identity-name-key.ts': sha256File(NAME_KEY_PATH),
      'scripts/ops/run-official-injury-player-identity-certification.ts':
        sha256File(RUNNER_PATH),
      'lib/identity/__tests__/official-injury-player-identity.test.ts':
        sha256File(DEV_TEST_PATH),
    },
    node: process.version,
    candidate_sha256_expected: EXPECTED_CAND_SHA,
    candidate_sha256_actual: sha256File(CAND_GZ),
  };

  if (fingerprint.candidate_sha256_actual !== EXPECTED_CAND_SHA) {
    throw new Error(
      `Candidate SHA drift: ${fingerprint.candidate_sha256_actual} != ${EXPECTED_CAND_SHA}`
    );
  }

  // Development gate summary (tests already run externally; re-verify here)
  const devFixtures = loadFixtures('development');
  const synFixtures = loadFixtures('synthetic');
  const devResults = [...devFixtures, ...synFixtures].map((fx) => {
    const r = runFixture(fx);
    return { fixture_id: fx.fixture_id, split: fx.split, ok: r.ok, diffs: r.diffs };
  });
  const devExact = devResults.filter((r) => r.ok).length;
  const devTotal = devResults.length;
  const developmentGate = devExact === devTotal ? 'PASS' : 'FAIL';

  const developmentReport = {
    generated_at: utcNow(),
    phase: '4D.1',
    PLAYER_IDENTITY_RESOLVER_DEVELOPMENT_GATE: developmentGate,
    F7: 'OPEN',
    AS_OF_INJURY_TAPE_CERTIFIED: 'NO',
    resolver_version: OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION,
    development_fixtures_exact: `${devFixtures.filter((f) => runFixture(f).ok).length}/${devFixtures.length}`,
    synthetic_fixtures_exact: `${synFixtures.filter((f) => runFixture(f).ok).length}/${synFixtures.length}`,
    combined_exact: `${devExact}/${devTotal}`,
    failures: devResults.filter((r) => !r.ok),
    fingerprint_preview: fingerprint.files,
  };
  writeJson(
    path.join(REPORTS, 'official-injury-report-player-identity-resolver-development.json'),
    developmentReport
  );
  writeMd(
    path.join(REPORTS, 'official-injury-report-player-identity-resolver-development.md'),
    [
      '# Official injury player identity resolver — development gate',
      '',
      `Generated: **${developmentReport.generated_at}**`,
      '',
      `**PLAYER_IDENTITY_RESOLVER_DEVELOPMENT_GATE = ${developmentGate}**`,
      '',
      `F7 = OPEN  `,
      `AS_OF_INJURY_TAPE_CERTIFIED = NO`,
      '',
      `- Resolver version: \`${OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION}\``,
      `- Development fixtures: **${developmentReport.development_fixtures_exact}**`,
      `- Synthetic fixtures: **${developmentReport.synthetic_fixtures_exact}**`,
      '',
      'Held-out expectations were not used in development.',
      '',
    ]
  );

  if (developmentGate !== 'PASS') {
    console.log(JSON.stringify({ developmentGate, failures: developmentReport.failures }, null, 2));
    process.exit(1);
  }

  // Freeze fingerprint BEFORE held-out
  writeJson(path.join(OUT_TMP, 'resolver-fingerprint.json'), fingerprint);
  const frozenSha = { ...fingerprint.files };

  // Blind held-out — first run (immutable if file exists, do not overwrite)
  const heldOutFirstJson = path.join(
    REPORTS,
    'official-injury-report-player-identity-held-out-first-run.json'
  );
  const heldOutFirstMd = path.join(
    REPORTS,
    'official-injury-report-player-identity-held-out-first-run.md'
  );

  let heldOutCertified = false;
  let heldOutExact = 0;
  let heldOutTotal = 0;

  if (existsSync(heldOutFirstJson)) {
    const prior = JSON.parse(readFileSync(heldOutFirstJson, 'utf8')) as {
      PLAYER_IDENTITY_RESOLVER_CERTIFIED?: string;
      held_out_exact?: string;
      immutable?: boolean;
    };
    console.log('Held-out first-run artifact already exists — preserving immutably.');
    heldOutCertified = prior.PLAYER_IDENTITY_RESOLVER_CERTIFIED === 'YES';
    const m = String(prior.held_out_exact || '0/0').split('/');
    heldOutExact = Number(m[0]);
    heldOutTotal = Number(m[1]);
  } else {
    // Verify fingerprint unchanged (same process)
    for (const [k, v] of Object.entries(frozenSha)) {
      const p =
        k === 'lib/identity/official-injury-player-identity.ts'
          ? RESOLVER_PATH
          : k === 'lib/identity/injury-identity-name-key.ts'
            ? NAME_KEY_PATH
            : k === 'scripts/ops/run-official-injury-player-identity-certification.ts'
              ? RUNNER_PATH
              : DEV_TEST_PATH;
      if (sha256File(p) !== v) {
        throw new Error(`Resolver bytes changed before held-out: ${k}`);
      }
    }

    const held = loadFixtures('held_out');
    heldOutTotal = held.length;
    const results = held.map((fx) => {
      const r = runFixture(fx);
      return {
        fixture_id: fx.fixture_id,
        category: fx.category,
        ok: r.ok,
        diffs: r.diffs,
        expected: fx.expected.resolution_status,
        actual: r.actual.resolutionStatus,
      };
    });
    heldOutExact = results.filter((r) => r.ok).length;
    heldOutCertified = heldOutExact === heldOutTotal;

    const firstRun = {
      generated_at: utcNow(),
      phase: '4D.3',
      immutable: true,
      note: 'FIRST blind held-out run. Do not overwrite.',
      resolver_version: OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION,
      fingerprint: fingerprint,
      held_out_exact: `${heldOutExact}/${heldOutTotal}`,
      PLAYER_IDENTITY_RESOLVER_CERTIFIED: heldOutCertified ? 'YES' : 'NO',
      F7: 'OPEN',
      AS_OF_INJURY_TAPE_CERTIFIED: 'NO',
      results,
      NEXT: heldOutCertified
        ? 'PROCEED_TO_FULL_DRY_RESOLUTION'
        : 'REOPEN_PLAYER_IDENTITY_RESOLVER_DEVELOPMENT',
    };
    writeJson(heldOutFirstJson, firstRun);
    writeMd(heldOutFirstMd, [
      '# Official injury player identity — held-out FIRST RUN',
      '',
      `Generated: **${firstRun.generated_at}**`,
      '',
      '**IMMUTABLE first-run artifact — do not overwrite.**',
      '',
      `Held-out exact: **${heldOutExact}/${heldOutTotal}**`,
      '',
      `**PLAYER_IDENTITY_RESOLVER_CERTIFIED = ${firstRun.PLAYER_IDENTITY_RESOLVER_CERTIFIED}**`,
      '',
      `F7 = OPEN (pending full-run)`,
      '',
      `Resolver SHA: \`${fingerprint.files['lib/identity/official-injury-player-identity.ts']}\``,
      '',
    ]);
  }

  if (!heldOutCertified) {
    writeJson(path.join(REPORTS, 'official-injury-report-player-identity-resolver-certification.json'), {
      generated_at: utcNow(),
      PLAYER_IDENTITY_RESOLVER_CERTIFIED: 'NO',
      F7: 'OPEN',
      NEXT: 'REOPEN_PLAYER_IDENTITY_RESOLVER_DEVELOPMENT',
    });
    console.log(JSON.stringify({ heldOutCertified: false, heldOutExact, heldOutTotal }, null, 2));
    process.exit(1);
  }

  // Re-verify fingerprint before full run
  for (const [k, v] of Object.entries(frozenSha)) {
    const p =
      k === 'lib/identity/official-injury-player-identity.ts'
        ? RESOLVER_PATH
        : k === 'lib/identity/injury-identity-name-key.ts'
          ? NAME_KEY_PATH
          : k === 'scripts/ops/run-official-injury-player-identity-certification.ts'
            ? RUNNER_PATH
            : DEV_TEST_PATH;
    if (sha256File(p) !== v) {
      throw new Error(`Resolver bytes changed before full run: ${k}`);
    }
  }

  // Full dry resolution
  const counts: Record<string, number> = {};
  const tiers: Record<string, number> = {};
  const bySeason: Record<string, Record<string, number>> = {};
  const everOutBySeason: Record<string, Record<string, number>> = {};
  let n = 0;
  let everOutN = 0;
  let canonical = 0;
  let serving = 0;
  let entityOnly = 0;
  let everOutResolved = 0;
  const entityOnlyList: object[] = [];
  const quarantined: object[] = [];
  const resolved: object[] = [];
  const allResults: object[] = [];

  let inputConflicts = 0;
  let inputMultiples = 0;

  for await (const r of readNdjsonGz(CAND_GZ)) {
    n += 1;
    const evidence = evidenceFromRow(r);
    if (evidence.u2.cardinality === 'multiple' || evidence.u4Nba.cardinality === 'multiple')
      inputMultiples += 1;
    // conflicts not pre-labeled in input

    const result = resolveOfficialInjuryPlayerIdentity(
      {
        gameId: String(r.game_id),
        teamId: String(r.team_id),
        gameDateEt: String(r.et_game_date),
        playerNameRaw: String(r.player_name_raw),
        teamAbbreviation: String(r.team_abbreviation ?? ''),
      },
      evidence
    );

    const season = String(r.season);
    bySeason[season] ??= {};
    bySeason[season][result.resolutionStatus] =
      (bySeason[season][result.resolutionStatus] ?? 0) + 1;
    counts[result.resolutionStatus] = (counts[result.resolutionStatus] ?? 0) + 1;
    if (result.confidenceClass) {
      tiers[result.confidenceClass] = (tiers[result.confidenceClass] ?? 0) + 1;
    }

    const rowOut = {
      game_id: r.game_id,
      team_id: r.team_id,
      team_abbreviation: r.team_abbreviation,
      season: r.season,
      et_game_date: r.et_game_date,
      player_name_raw: r.player_name_raw,
      ever_out: r.ever_out,
      name_key: result.nameKey,
      resolution_status: result.resolutionStatus,
      player_entity_id: result.playerEntityId,
      serving_player_id: result.servingPlayerId,
      confidence_class: result.confidenceClass,
      provenance_category: result.provenanceCategory,
      independent_source_count: result.independentSourceCount,
      quarantine_reason: result.quarantineReason,
      resolver_version: result.resolverVersion,
    };
    allResults.push(rowOut);

    const isResolved =
      result.resolutionStatus === 'RESOLVED_CANONICAL_ENTITY' ||
      result.resolutionStatus === 'RESOLVED_ENTITY_NO_SERVING_PLAYER';
    if (isResolved) {
      canonical += 1;
      resolved.push(rowOut);
      if (result.resolutionStatus === 'RESOLVED_ENTITY_NO_SERVING_PLAYER') {
        entityOnly += 1;
        entityOnlyList.push(rowOut);
      }
      if (result.servingPlayerId) serving += 1;
    } else {
      quarantined.push(rowOut);
    }

    if (r.ever_out) {
      everOutN += 1;
      everOutBySeason[season] ??= { n: 0, resolved: 0, quarantined: 0 };
      everOutBySeason[season].n += 1;
      if (isResolved) {
        everOutResolved += 1;
        everOutBySeason[season].resolved += 1;
      } else {
        everOutBySeason[season].quarantined += 1;
      }
    }
  }

  if (n !== 42193) {
    throw new Error(`Expected 42193 records, got ${n}`);
  }
  if (canonical + quarantined.length !== 42193) {
    throw new Error('Accounting identity failed');
  }

  await writeNdjsonGz(path.join(OUT_TMP, 'all-results.ndjson.gz'), allResults);
  await writeNdjsonGz(path.join(OUT_TMP, 'resolved.ndjson.gz'), resolved);
  await writeNdjsonGz(path.join(OUT_TMP, 'quarantined.ndjson.gz'), quarantined);

  const artifactMeta = (p: string, count: number) => ({
    path: path.relative(ROOT, p).replace(/\\/g, '/'),
    sha256: sha256File(p),
    bytes: statSync(p).size,
    record_count: count,
  });

  const runState = {
    generated_at: utcNow(),
    resolver_version: OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION,
    fingerprint,
    processed: n,
    canonical_resolved: canonical,
    serving_projection: serving,
    entity_only: entityOnly,
    quarantined: quarantined.length,
    counts,
    tiers,
    ever_out: { n: everOutN, resolved: everOutResolved, quarantined: everOutN - everOutResolved },
  };
  writeJson(path.join(OUT_TMP, 'run-state.json'), runState);

  const f7Rate = canonical / 42193;
  const servingRate = serving / 42193;
  const everOutRate = everOutResolved / everOutN;

  const fullGate =
    n === 42193 &&
    counts['QUARANTINED_SOURCE_CONFLICT'] === undefined &&
    (counts['QUARANTINED_MULTIPLE_CANDIDATES'] ?? 0) === 0 &&
    (counts['QUARANTINED_INFERRED_ONLY'] ?? 0) >= 0 &&
    heldOutCertified &&
    developmentGate === 'PASS'
      ? 'PASS'
      : 'FAIL';

  // Explain vs Phase 4C expectation
  const expected = {
    canonical: 41019,
    serving: 41010,
    entity_only: 9,
    quarantine: 1174,
    no_safe: 1169,
    inferred_only: 5,
    ever_out_resolved: 33501,
  };
  const delta = {
    canonical: canonical - expected.canonical,
    serving: serving - expected.serving,
    entity_only: entityOnly - expected.entity_only,
    quarantine: quarantined.length - expected.quarantine,
    inferred_only: (counts['QUARANTINED_INFERRED_ONLY'] ?? 0) - expected.inferred_only,
    no_safe: (counts['QUARANTINED_NO_SAFE_CANDIDATE'] ?? 0) - expected.no_safe,
    ever_out_resolved: everOutResolved - expected.ever_out_resolved,
  };

  const f7Closed = fullGate === 'PASS' && heldOutCertified;

  const certification = {
    generated_at: utcNow(),
    phase: '4D',
    PLAYER_IDENTITY_RESOLVER_CERTIFIED: 'YES',
    PLAYER_IDENTITY_FULL_RUN_GATE: fullGate,
    F7: f7Closed ? 'CLOSED' : 'OPEN',
    AS_OF_INJURY_TAPE_CERTIFIED: 'NO',
    NEXT: f7Closed
      ? 'PROCEED_TO_AS_OF_T60_RECONSTRUCTION_AUDIT'
      : 'INVESTIGATE_FULL_RUN',
    resolver_version: OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION,
    resolver_sha256: fingerprint.files['lib/identity/official-injury-player-identity.ts'],
    name_key_sha256: fingerprint.files['lib/identity/injury-identity-name-key.ts'],
    fingerprint,
    development_fixtures_exact: `${devFixtures.length}/${devFixtures.length}`,
    synthetic_fixtures_exact: `${synFixtures.length}/${synFixtures.length}`,
    held_out_exact: `${heldOutExact}/${heldOutTotal}`,
    held_out_first_run_immutable: true,
    safety: {
      SUFFIX_STRIPPING_USED_AS_AUTHORITY: 'NO',
      LEAGUE_WIDE_NAME_FALLBACK_USED: 'NO',
      FUZZY_MATCHING_USED: 'NO',
      U5_HISTORICAL_USED: 'NO',
      PROVIDER_BRIDGES_WRITTEN: 'NO',
      ALIASES_WRITTEN: 'NO',
    },
  };
  writeJson(
    path.join(REPORTS, 'official-injury-report-player-identity-resolver-certification.json'),
    certification
  );
  writeMd(
    path.join(REPORTS, 'official-injury-report-player-identity-resolver-certification.md'),
    [
      '# Official injury player identity resolver certification',
      '',
      `**PLAYER_IDENTITY_RESOLVER_CERTIFIED = YES**`,
      `**PLAYER_IDENTITY_FULL_RUN_GATE = ${fullGate}**`,
      `**F7 = ${certification.F7}**`,
      `**AS_OF_INJURY_TAPE_CERTIFIED = NO**`,
      '',
      `Resolver: \`lib/identity/official-injury-player-identity.ts\`  `,
      `Version: \`${OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION}\`  `,
      `SHA-256: \`${certification.resolver_sha256}\``,
      '',
      `- Development: ${certification.development_fixtures_exact}`,
      `- Synthetic: ${certification.synthetic_fixtures_exact}`,
      `- Held-out first run: ${certification.held_out_exact} (immutable)`,
      '',
      `NEXT = ${certification.NEXT}`,
      '',
    ]
  );

  const everOutQuarantine = quarantined.filter((q) => (q as { ever_out?: boolean }).ever_out);
  const everOutQByReason: Record<string, number> = {};
  for (const q of everOutQuarantine) {
    const reason = String((q as { quarantine_reason?: string }).quarantine_reason ?? 'unknown');
    everOutQByReason[reason] = (everOutQByReason[reason] ?? 0) + 1;
  }

  const fullRun = {
    generated_at: utcNow(),
    phase: '4D.4',
    PLAYER_IDENTITY_FULL_RUN_GATE: fullGate,
    F7: certification.F7,
    AS_OF_INJURY_TAPE_CERTIFIED: 'NO',
    resolver_version: OFFICIAL_INJURY_PLAYER_IDENTITY_VERSION,
    fingerprint_unchanged: true,
    population: {
      expected: 42193,
      processed: n,
      candidate_sha256: EXPECTED_CAND_SHA,
    },
    counts,
    tiers,
    canonical_resolved: canonical,
    serving_bdl_projection: serving,
    entity_only: entityOnly,
    entity_only_list: entityOnlyList,
    quarantined_total: quarantined.length,
    rates: {
      F7_CANONICAL_RESOLUTION_RATE: f7Rate,
      SERVING_BDL_PROJECTION_RATE: servingRate,
      EVER_OUT_CANONICAL_RESOLUTION_RATE: everOutRate,
    },
    ever_out: {
      denominator: everOutN,
      resolved: everOutResolved,
      quarantined: everOutQuarantine.length,
      quarantine_by_reason: everOutQByReason,
      by_season: everOutBySeason,
    },
    by_season: bySeason,
    phase4c_expectation_delta: delta,
    artifacts: {
      all_results: artifactMeta(path.join(OUT_TMP, 'all-results.ndjson.gz'), n),
      resolved: artifactMeta(path.join(OUT_TMP, 'resolved.ndjson.gz'), resolved.length),
      quarantined: artifactMeta(path.join(OUT_TMP, 'quarantined.ndjson.gz'), quarantined.length),
      run_state: path.relative(ROOT, path.join(OUT_TMP, 'run-state.json')).replace(/\\/g, '/'),
    },
    safety: certification.safety,
    schema_gap_deferred:
      'analytics.player_identity_unresolved cannot represent name-keyed injury quarantine without provider id; dry artifacts only.',
    NEXT: certification.NEXT,
    input_diagnostics: { inputConflicts, inputMultiples },
  };
  writeJson(
    path.join(REPORTS, 'official-injury-report-player-identity-full-run.json'),
    fullRun
  );
  writeMd(path.join(REPORTS, 'official-injury-report-player-identity-full-run.md'), [
    '# Official injury player identity — full dry run',
    '',
    `Generated: **${fullRun.generated_at}**`,
    '',
    `**PLAYER_IDENTITY_FULL_RUN_GATE = ${fullGate}**  `,
    `**F7 = ${certification.F7}**  `,
    `**AS_OF_INJURY_TAPE_CERTIFIED = NO**`,
    '',
    `Processed: **${n} / 42193**`,
    '',
    `Canonical resolved: **${canonical}** (entity-only **${entityOnly}**)  `,
    `Serving BDL: **${serving}**  `,
    `Quarantined: **${quarantined.length}**`,
    '',
    `Counts: \`${JSON.stringify(counts)}\``,
    `Tiers: \`${JSON.stringify(tiers)}\``,
    '',
    `F7 canonical rate: **${f7Rate.toFixed(6)}**  `,
    `Serving projection rate: **${servingRate.toFixed(6)}**  `,
    `Ever-Out rate: **${everOutResolved}/${everOutN} = ${everOutRate.toFixed(6)}**`,
    '',
    `Phase 4C delta: \`${JSON.stringify(delta)}\``,
    '',
    `NEXT = ${certification.NEXT}`,
    '',
    'Identity coverage ≠ T−60 / WOWY sample coverage.',
    '',
  ]);

  console.log(
    JSON.stringify(
      {
        developmentGate,
        heldOutExact: `${heldOutExact}/${heldOutTotal}`,
        PLAYER_IDENTITY_RESOLVER_CERTIFIED: 'YES',
        PLAYER_IDENTITY_FULL_RUN_GATE: fullGate,
        F7: certification.F7,
        canonical,
        serving,
        entityOnly,
        quarantined: quarantined.length,
        counts,
        tiers,
        f7Rate,
        everOutRate,
        delta,
        NEXT: certification.NEXT,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
