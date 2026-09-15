import { FROZEN_GAME_UNIVERSE, OWLS_DEFAULT_HISTORY_CONCURRENCY, OWLS_HARD_CAP_HISTORY_CONCURRENCY } from './contract';
import { estimateGzipBytes } from './archive';
import type { OwlsArchiveEnvelope } from './types';

export type StorageEstimate = {
  basis: 'fixture' | 'live_probe';
  bytesPerObject: number;
  assumedPagesPerGame: number | null;
  gamesPerSeason: number;
  objectsPerSeason: number | 'unknown_until_live_probe';
  bytesPerSeason: number | 'unknown_until_live_probe';
  bytesThreeSeasons: number | 'unknown_until_live_probe';
  notes: string[];
};

export function estimateStorage(args: {
  sampleEnvelope: OwlsArchiveEnvelope;
  observedPagesPerGame?: number | null;
  observedBytesPerRequest?: number | null;
}): StorageEstimate {
  const bytesPerObject = args.observedBytesPerRequest ?? estimateGzipBytes(args.sampleEnvelope);
  const games = FROZEN_GAME_UNIVERSE.seasons['2024'].totalFinal;
  const pages = args.observedPagesPerGame ?? null;
  const objectsPerSeason =
    pages != null ? games * pages + Math.ceil(games / 100) : ('unknown_until_live_probe' as const);
  const bytesPerSeason =
    typeof objectsPerSeason === 'number' ? objectsPerSeason * bytesPerObject : ('unknown_until_live_probe' as const);
  const bytesThreeSeasons =
    typeof bytesPerSeason === 'number' ? bytesPerSeason * 3 : ('unknown_until_live_probe' as const);
  return {
    basis: args.observedPagesPerGame != null ? 'live_probe' : 'fixture',
    bytesPerObject,
    assumedPagesPerGame: pages,
    gamesPerSeason: games,
    objectsPerSeason,
    bytesPerSeason,
    bytesThreeSeasons,
    notes: [
      'Do not optimize away useful raw data to save trivial S3 cost.',
      'Bucket is versioned with no expiration; raw Owls payloads stay under source=owls_insight.',
      pages == null
        ? 'Object counts remain unknown until the live probe measures pages/game.'
        : `Using observed pages/game=${pages}.`,
    ],
  };
}

export function theoreticalThroughputNotes(): string[] {
  return [
    `Default history concurrency=${OWLS_DEFAULT_HISTORY_CONCURRENCY}; hard cap=${OWLS_HARD_CAP_HISTORY_CONCURRENCY} (Hall of Fame documented in-flight).`,
    'MVP documented history in-flight=3, 400 REST req/min, 300k req/month. Bench/Rookie do not include history.',
    'Theoretical lower bound if every game is 1 player-props page + shared game-list pages: ~1.3k history requests/season at 2 in-flight. Runtime unknown until probe latency is observed.',
    'If 503s force smaller pages, request counts rise. Prefer steady retries over maximizing throughput.',
    'Do not fan out one event across books in parallel (documented).',
  ];
}
