import { gunzipEnvelope, verifyStoredArchive } from '../player-prop-snapshot-archive';
import { evaluateCurrentQuickBuilds } from './quick-builds';
import { pointerKey, publishCurrentSnapshot, type PublishRequest } from './publish';
import { readCurrentBoard } from './reader';
import type { InMemoryPrototypeStore } from './store';

export type PrototypeMeasurement = {
  sourceObservations: number;
  normalizedRows: number;
  uncompressedArchiveBytes: number;
  gzipArchiveBytes: number;
  manifestBytes: number;
  pointerBytes: number;
  archiveVerificationMs: number;
  currentBoardReadMs: number;
  quickBuildsMs: number;
  s3PutRequests: number;
  s3GetRequests: number;
};

/** Local fixture timings. These are not production latency or AWS prices. */
export async function measurePublication(args: {
  store: InMemoryPrototypeStore;
  request: PublishRequest;
  now: string;
  gameStatus: string;
}): Promise<PrototypeMeasurement> {
  const puts = args.store.puts;
  const gets = args.store.gets;
  const published = await publishCurrentSnapshot(args.request);
  if (!published.published || !published.archiveKey || !published.manifestKey) {
    throw new Error(`measurement publish failed: ${published.reason}`);
  }
  const s3PutRequests = args.store.puts - puts;
  const s3GetRequests = args.store.gets - gets;
  const archive = await args.store.get(published.archiveKey);
  const manifest = await args.store.get(published.manifestKey);
  const pointer = await args.store.get(pointerKey(args.request.gameId));
  if (!archive || !manifest || !pointer) throw new Error('measurement objects missing');
  const envelope = gunzipEnvelope(archive.body);
  const manifestBody = JSON.parse(manifest.body.toString('utf8')) as { rowsFetched: number };
  const verifyStarted = performance.now();
  const verified = await verifyStoredArchive({
    store: args.store,
    key: published.archiveKey,
    expectedChecksum: envelope.checksum,
    expected: {
      gameId: args.request.gameId,
      pullRunId: args.request.pullRunId,
      gameDate: args.request.gameDate,
      controllerEnqueuedAt: args.request.controllerEnqueuedAt,
    },
  });
  const archiveVerificationMs = performance.now() - verifyStarted;
  if (!verified.ok) throw new Error(verified.message);
  const readStarted = performance.now();
  const board = await readCurrentBoard({ store: args.store, gameId: args.request.gameId, now: args.now });
  const currentBoardReadMs = performance.now() - readStarted;
  const quickStarted = performance.now();
  evaluateCurrentQuickBuilds({
    board,
    sportsbook: 'draftkings',
    policy: { mode: 'research_snapshot', asOf: args.now },
    gameStartTime: args.request.gameStartTime,
    gameStatus: args.gameStatus,
  });
  const quickBuildsMs = performance.now() - quickStarted;
  return {
    sourceObservations: manifestBody.rowsFetched,
    normalizedRows: envelope.row_count,
    uncompressedArchiveBytes: Buffer.byteLength(`${JSON.stringify(envelope)}\n`, 'utf8'),
    gzipArchiveBytes: archive.body.length,
    manifestBytes: manifest.body.length,
    pointerBytes: pointer.body.length,
    archiveVerificationMs,
    currentBoardReadMs,
    quickBuildsMs,
    s3PutRequests,
    s3GetRequests,
  };
}
