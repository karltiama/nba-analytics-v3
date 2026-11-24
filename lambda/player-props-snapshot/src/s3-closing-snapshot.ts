/**
 * Closing lines preserved as one S3 object.
 * Selection is selectClosingLinesFromArchives. This module does not insert decision rows.
 *
 * A pull listed in raw.player_prop_pull_runs.game_ids_queried can exist before
 * raw.player_prop_game_runs commits. The archive key uses game_runs.started_at.
 * Without that row the key cannot be derived, and this reader does not list the bucket.
 */
import {
  buildPlayerPropSnapshotArchiveKey,
  checksumCanonical,
  isValidPregameResearchSnapshot,
  nbaSeasonStartYearFromGameDate,
  verifyStoredArchive,
} from './player-prop-snapshot-archive';
import { manifestProblem, publicationEvidenceProblem, type PublicationManifest } from './f39b/manifest';
import { manifestKeyFor } from './f39b/publish';
import type { CurrentPropsObjectStore } from './f39b/store';
import {
  selectClosingLinesFromArchives,
  type ArchivedPullReference,
  type DecisionCloseRow,
} from './s3-closing-selection';

export const CLOSING_SNAPSHOT_VERSION = 'player_prop_closing_snapshot.v1';

export const MISSING_DURABILITY_CONTRACT =
  'A raw.player_prop_pull_runs row can list a game in game_ids_queried before raw.player_prop_game_runs commits. ' +
  'The archive key is snapshot_at=<compact(started_at)>__pull=<pull_run_id>, and started_at exists only on the game-run row. ' +
  'This reader does not list the bucket. Without that row, an object cannot be proven present or absent.';

export const PULL_INVENTORY_SQL = `
SELECT p.pull_run_id,
       p.status AS pull_status,
       g.status AS game_status,
       g.archive_status,
       g.archive_key,
       g.started_at,
       g.rows_fetched,
       g.rows_stored,
       g.provider_attempts
  FROM raw.player_prop_pull_runs p
  LEFT JOIN raw.player_prop_game_runs g
    ON g.pull_run_id = p.pull_run_id
   AND g.game_id = $1
 WHERE $1 = ANY (p.game_ids_queried)
    OR g.game_id = $1
 ORDER BY p.pull_run_id
`;

export const HISTORICAL_READER_CHANGE = {
  pastDatePropsExplorer:
    'lib/betting/props-explorer-serving.ts historical reads of research.prop_decision_lines',
  historicalPropEvaluation:
    'scripts/evaluate-player-projections.ts, scripts/evaluate-projection-structure.ts, scripts/evaluate-shadow-projection.ts, and scripts/evaluate-minutes-projections.ts',
  playerLevelHistoricalResearch:
    'scripts/evaluate-player-projections.ts player lines, and lib/archive/opening-player-props.ts DISTINCT_DECISION_LINE_GAMES_SQL',
  smallestChange:
    'Add one loader that returns decisionRowsFromClosingArtifact only for a game with no research.prop_decision_lines rows. Existing PostgreSQL rows stay the source when they exist. A missing or incomplete artifact is unavailable. Do not union it with raw.player_prop_snapshots_v2 or analytics.player_props_current.',
} as const;

export type GameRunRecord = {
  status: 'started' | 'success' | 'error';
  archiveStatus: 'pending' | 'archived' | 'failed' | null;
  archiveKey: string | null;
  startedAt: string | null;
  rowsFetched: number | null;
  rowsStored: number | null;
  providerAttempts: number | null;
};

export type PullEvidence = {
  pullRunId: number;
  queriedGame: boolean;
  gameRun: GameRunRecord | null;
};

export type ClosingGame = {
  gameId: string;
  gameDate: string;
  status: string;
  startTime: string | null;
};

export type PullFindingState =
  | 'verified'
  | 'recovered_uncommitted'
  | 'intentional_skip'
  | 'post_tip'
  | 'missing_archive'
  | 'invalid_manifest'
  | 'invalid_archive'
  | 'failed'
  | 'pending'
  | 'contradictory'
  | 'missing_clock'
  | 'game_run_absent';

export type PullFinding = {
  pullRunId: number;
  state: PullFindingState;
  archiveKey: string | null;
  detail: string;
};

export type CoverageCompleteness = 'complete' | 'verified_subset' | 'unverifiable';

export type CoverageReport = {
  completeness: CoverageCompleteness;
  findings: PullFinding[];
  verifiedPulls: ArchivedPullReference[];
  missingDurabilityContract: string | null;
};

export type ClosingPullRef = {
  pullRunId: number;
  archiveKey: string;
  observedAt: string;
  observationClock: 'RESPONSE_RECEIVED';
  recoveredUncommittedGameRun: boolean;
};

export type ClosingSnapshot = {
  schemaVersion: typeof CLOSING_SNAPSHOT_VERSION;
  gameId: string;
  gameDate: string;
  gameStartTime: string;
  completeness: 'complete';
  marketCount: number;
  contentChecksum: string;
  pulls: ClosingPullRef[];
  evidence: PullFinding[];
  lines: DecisionCloseRow[];
};

export class ClosingSnapshotRefusal extends Error {
  readonly coverage: CoverageReport | null;

  constructor(message: string, coverage: CoverageReport | null = null) {
    super(message);
    this.name = 'ClosingSnapshotRefusal';
    this.coverage = coverage;
  }
}

const BLOCKING: ReadonlySet<PullFindingState> = new Set([
  'missing_archive',
  'invalid_manifest',
  'invalid_archive',
  'failed',
  'pending',
  'contradictory',
  'missing_clock',
  'game_run_absent',
]);

function finding(pullRunId: number, state: PullFindingState, archiveKey: string | null, detail: string): PullFinding {
  return { pullRunId, state, archiveKey, detail };
}

function derivedKey(game: ClosingGame, pullRunId: number, startedAt: string): string {
  return buildPlayerPropSnapshotArchiveKey({
    rawPrefix: 'raw',
    season: nbaSeasonStartYearFromGameDate(game.gameDate),
    gameDate: game.gameDate,
    gameId: game.gameId,
    pullRunId,
    snapshotAt: startedAt,
  });
}

function isIntentionalSkip(run: GameRunRecord): boolean {
  return run.status === 'success'
    && run.archiveStatus === 'pending'
    && run.archiveKey == null
    && run.rowsFetched === 0
    && run.rowsStored === 0
    && run.providerAttempts === 0;
}

function clockMessage(message: string): boolean {
  return message.includes('observed_at') || message.includes('observation clock') || message.includes('controller_enqueued_at');
}

async function readManifest(
  store: CurrentPropsObjectStore,
  archiveKey: string
): Promise<{ ok: true; manifest: PublicationManifest } | { ok: false; detail: string }> {
  const key = manifestKeyFor(archiveKey);
  let object: Awaited<ReturnType<CurrentPropsObjectStore['get']>>;
  try {
    object = await store.get(key);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'manifest read failed' };
  }
  if (!object) return { ok: false, detail: 'publication manifest is absent' };
  try {
    const parsed = JSON.parse(object.body.toString('utf8')) as PublicationManifest;
    return { ok: true, manifest: parsed };
  } catch {
    return { ok: false, detail: 'publication manifest is not JSON' };
  }
}

type Classified = {
  finding: PullFinding;
  reference: ArchivedPullReference | null;
  observedAt: string | null;
  eligible: boolean;
};

async function classifyPull(store: CurrentPropsObjectStore, game: ClosingGame, pull: PullEvidence): Promise<Classified> {
  const run = pull.gameRun;
  if (!run) {
    return {
      finding: finding(pull.pullRunId, 'game_run_absent', null, MISSING_DURABILITY_CONTRACT),
      reference: null,
      observedAt: null,
      eligible: false,
    };
  }
  if (isIntentionalSkip(run)) {
    if (!run.startedAt) {
      return { finding: finding(pull.pullRunId, 'pending', null, 'skip has no started_at'), reference: null, observedAt: null, eligible: false };
    }
    const key = derivedKey(game, pull.pullRunId, run.startedAt);
    const found = await verifyStoredArchive({
      store,
      key,
      expected: { gameId: game.gameId, pullRunId: pull.pullRunId, gameDate: game.gameDate, controllerEnqueuedAt: run.startedAt },
    }).catch(() => null);
    if (found && !found.ok && found.reason === 'missing') {
      return { finding: finding(pull.pullRunId, 'intentional_skip', null, 'pre-tip skip has no archive'), reference: null, observedAt: null, eligible: false };
    }
    return { finding: finding(pull.pullRunId, 'contradictory', key, 'skip row has an archive object'), reference: null, observedAt: null, eligible: false };
  }
  if (!run.startedAt && !run.archiveKey) {
    const state = run.status === 'error' || run.archiveStatus === 'failed' ? 'failed' : 'pending';
    return { finding: finding(pull.pullRunId, state, null, 'game run has no archive key'), reference: null, observedAt: null, eligible: false };
  }
  const derived = run.startedAt ? derivedKey(game, pull.pullRunId, run.startedAt) : null;
  if (run.archiveKey && derived && run.archiveKey !== derived) {
    return {
      finding: finding(pull.pullRunId, 'contradictory', run.archiveKey, 'recorded archive key does not match the started_at key'),
      reference: null,
      observedAt: null,
      eligible: false,
    };
  }
  const key = run.archiveKey ?? derived;
  if (!key || !run.startedAt) {
    return { finding: finding(pull.pullRunId, 'pending', key, 'archive key cannot be verified'), reference: null, observedAt: null, eligible: false };
  }
  const committed = run.archiveStatus === 'archived' && run.archiveKey != null;
  let verified: Awaited<ReturnType<typeof verifyStoredArchive>>;
  try {
    verified = await verifyStoredArchive({
      store,
      key,
      expected: {
        gameId: game.gameId,
        pullRunId: pull.pullRunId,
        gameDate: game.gameDate,
        controllerEnqueuedAt: run.startedAt,
      },
    });
  } catch (error) {
    return {
      finding: finding(pull.pullRunId, 'invalid_archive', key, error instanceof Error ? error.message : 'archive read failed'),
      reference: null,
      observedAt: null,
      eligible: false,
    };
  }
  if (!verified.ok) {
    if (clockMessage(verified.message)) {
      return { finding: finding(pull.pullRunId, 'missing_clock', key, verified.message), reference: null, observedAt: null, eligible: false };
    }
    if (verified.reason === 'conflict') {
      return { finding: finding(pull.pullRunId, 'contradictory', key, verified.message), reference: null, observedAt: null, eligible: false };
    }
    if (verified.reason === 'missing') {
      const state = committed ? 'missing_archive' : run.status === 'error' || run.archiveStatus === 'failed' ? 'failed' : 'pending';
      return { finding: finding(pull.pullRunId, state, key, verified.message), reference: null, observedAt: null, eligible: false };
    }
    return { finding: finding(pull.pullRunId, 'invalid_archive', key, verified.message), reference: null, observedAt: null, eligible: false };
  }
  const manifest = await readManifest(store, key);
  if (!manifest.ok) {
    return { finding: finding(pull.pullRunId, 'invalid_manifest', key, manifest.detail), reference: null, observedAt: null, eligible: false };
  }
  const own = manifestProblem(manifest.manifest);
  if (own) {
    return { finding: finding(pull.pullRunId, 'invalid_manifest', key, own), reference: null, observedAt: null, eligible: false };
  }
  const observedAt = verified.envelope.observed_at ?? manifest.manifest.observedAt;
  if (manifest.manifest.status === 'post_tip' || !isValidPregameResearchSnapshot(observedAt, game.startTime)) {
    return { finding: finding(pull.pullRunId, 'post_tip', key, 'observation is not pre-tip'), reference: null, observedAt, eligible: false };
  }
  const evidence = publicationEvidenceProblem(manifest.manifest, verified.envelope);
  if (evidence) {
    return { finding: finding(pull.pullRunId, 'invalid_manifest', key, evidence), reference: null, observedAt: null, eligible: false };
  }
  const state = committed ? 'verified' : 'recovered_uncommitted';
  return {
    finding: finding(pull.pullRunId, state, key, state === 'verified' ? 'verified archive' : 'archive verified from started_at; game-run key was not committed'),
    reference: { pullRunId: pull.pullRunId, archiveKey: key, startedAt: run.startedAt },
    observedAt,
    eligible: true,
  };
}

export async function assessClosingCoverage(args: {
  store: CurrentPropsObjectStore;
  game: ClosingGame;
  pulls: readonly PullEvidence[];
}): Promise<CoverageReport> {
  const seen = new Set<number>();
  const classified: Classified[] = [];
  for (const pull of [...args.pulls].sort((left, right) => left.pullRunId - right.pullRunId)) {
    if (seen.has(pull.pullRunId)) {
      classified.push({
        finding: finding(pull.pullRunId, 'contradictory', null, 'duplicate pull_run_id'),
        reference: null,
        observedAt: null,
        eligible: false,
      });
      continue;
    }
    seen.add(pull.pullRunId);
    classified.push(await classifyPull(args.store, args.game, pull));
  }
  const findings = classified.map((item) => item.finding);
  const unverifiable = findings.length === 0 || findings.some((item) => item.state === 'game_run_absent');
  const blocked = findings.some((item) => BLOCKING.has(item.state));
  const completeness: CoverageCompleteness = unverifiable ? 'unverifiable' : blocked ? 'verified_subset' : 'complete';
  return {
    completeness,
    findings,
    verifiedPulls: classified.flatMap((item) => (item.eligible && item.reference ? [item.reference] : [])),
    missingDurabilityContract: findings.some((item) => item.state === 'game_run_absent') ? MISSING_DURABILITY_CONTRACT : null,
  };
}

export function closingSnapshotKey(game: Pick<ClosingGame, 'gameId' | 'gameDate'>): string {
  const season = nbaSeasonStartYearFromGameDate(game.gameDate);
  return (
    `raw/source=balldontlie/league=nba/season=${season}/entity=player_prop_closing` +
    `/game_date=${game.gameDate}/game_id=${game.gameId}/closing.json`
  );
}

function snapshotBody(artifact: Omit<ClosingSnapshot, 'contentChecksum'>, checksum: string): Buffer {
  return Buffer.from(`${JSON.stringify({ ...artifact, contentChecksum: checksum })}\n`, 'utf8');
}

export function decisionRowsFromClosingArtifact(artifact: ClosingSnapshot): DecisionCloseRow[] {
  if (artifact.completeness !== 'complete') {
    throw new ClosingSnapshotRefusal('closing artifact is not complete evidence');
  }
  const { contentChecksum, ...body } = artifact;
  if (contentChecksum !== checksumCanonical(body)) {
    throw new ClosingSnapshotRefusal('closing artifact checksum does not match its body');
  }
  return artifact.lines.map((line) => ({ ...line }));
}

export async function publishClosingSnapshot(args: {
  store: CurrentPropsObjectStore;
  game: ClosingGame;
  pulls: readonly PullEvidence[];
}): Promise<{ key: string; created: boolean; artifact: ClosingSnapshot }> {
  if (args.game.status !== 'Final' || args.game.startTime == null || !Number.isFinite(Date.parse(args.game.startTime))) {
    throw new ClosingSnapshotRefusal('closing snapshot requires a Final game with a start time');
  }
  const coverage = await assessClosingCoverage(args);
  if (coverage.completeness !== 'complete') {
    const contract = coverage.missingDurabilityContract ? ` ${coverage.missingDurabilityContract}` : '';
    throw new ClosingSnapshotRefusal(`closing coverage is ${coverage.completeness}.${contract}`, coverage);
  }
  const lines = await selectClosingLinesFromArchives({
    store: args.store,
    game: {
      gameId: args.game.gameId,
      gameDate: args.game.gameDate,
      status: args.game.status,
      startTime: args.game.startTime,
    },
    pulls: coverage.verifiedPulls,
  });
  if (lines.length === 0) {
    throw new ClosingSnapshotRefusal('closing snapshot has no verified pre-tip lines', coverage);
  }
  const sourcePulls: ClosingPullRef[] = [];
  for (const pull of coverage.verifiedPulls) {
    const again = await verifyStoredArchive({
      store: args.store,
      key: pull.archiveKey,
      expected: {
        gameId: args.game.gameId,
        pullRunId: pull.pullRunId,
        gameDate: args.game.gameDate,
        controllerEnqueuedAt: pull.startedAt,
      },
    });
    if (!again.ok || !again.envelope.observed_at) {
      throw new ClosingSnapshotRefusal('verified pull could not be reread', coverage);
    }
    const item = coverage.findings.find((finding) => finding.pullRunId === pull.pullRunId);
    sourcePulls.push({
      pullRunId: pull.pullRunId,
      archiveKey: pull.archiveKey,
      observedAt: again.envelope.observed_at,
      observationClock: 'RESPONSE_RECEIVED',
      recoveredUncommittedGameRun: item?.state === 'recovered_uncommitted',
    });
  }
  const body = {
    schemaVersion: CLOSING_SNAPSHOT_VERSION,
    gameId: args.game.gameId,
    gameDate: args.game.gameDate,
    gameStartTime: new Date(args.game.startTime).toISOString(),
    completeness: 'complete' as const,
    marketCount: lines.length,
    pulls: sourcePulls,
    evidence: coverage.findings,
    lines,
  };
  const checksum = checksumCanonical(body);
  const artifact: ClosingSnapshot = { ...body, contentChecksum: checksum };
  const key = closingSnapshotKey(args.game);
  const bytes = snapshotBody(body, checksum);
  const created = await args.store.put(key, bytes, {
    checksum,
    'game-id': args.game.gameId,
    'market-count': String(lines.length),
    completeness: 'complete',
  }, { kind: 'if-none-match', etag: '*' });
  if (created.ok) return { key, created: true, artifact };
  const existing = await args.store.get(key);
  if (existing && Buffer.compare(existing.body, bytes) === 0) return { key, created: false, artifact };
  throw new ClosingSnapshotRefusal('closing artifact conflicts with the stored object', coverage);
}
