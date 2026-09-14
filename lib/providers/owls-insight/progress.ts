import { formatHms } from './planner';
import type { ProgressSnapshot } from './types';

export class ProgressTracker {
  gamesComplete = 0;
  gamesTotal = 0;
  populatedGames = 0;
  emptyProviderHistory = 0;
  mappingFailed = 0;
  requests = 0;
  requestsSuccessful = 0;
  requestsRetried = 0;
  rowsArchived = 0;
  failures = 0;
  pagesComplete = 0;
  status429 = 0;
  status503 = 0;
  season: string | null = null;
  private readonly startedAt: number;
  private lastLogAt = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly logEveryMs = 15_000
  ) {
    this.startedAt = now();
  }

  snapshot(): ProgressSnapshot {
    const elapsedMs = this.now() - this.startedAt;
    const avgSecondsPerGame =
      this.gamesComplete > 0 ? elapsedMs / 1000 / this.gamesComplete : null;
    const remainingGames = Math.max(0, this.gamesTotal - this.gamesComplete);
    const estimatedRemainingMs =
      avgSecondsPerGame != null && this.gamesComplete >= 3
        ? remainingGames * avgSecondsPerGame * 1000
        : null;
    return {
      season: this.season,
      gamesComplete: this.gamesComplete,
      gamesTotal: this.gamesTotal,
      populatedGames: this.populatedGames,
      emptyProviderHistory: this.emptyProviderHistory,
      mappingFailed: this.mappingFailed,
      requests: this.requests,
      requestsSuccessful: this.requestsSuccessful,
      requestsRetried: this.requestsRetried,
      rowsArchived: this.rowsArchived,
      failures: this.failures,
      pagesComplete: this.pagesComplete,
      status429: this.status429,
      status503: this.status503,
      elapsedMs,
      estimatedRemainingMs,
      avgRequestsPerGame: this.gamesComplete > 0 ? this.requests / this.gamesComplete : null,
      avgSecondsPerGame,
    };
  }

  formatLine(snap = this.snapshot()): string {
    const remaining =
      snap.estimatedRemainingMs == null ? 'unknown until live probe' : formatHms(snap.estimatedRemainingMs);
    return [
      `Season: ${snap.season ?? 'n/a'}`,
      `Games complete: ${snap.gamesComplete} / ${snap.gamesTotal}`,
      `Populated: ${snap.populatedGames}`,
      `EMPTY_PROVIDER_HISTORY: ${snap.emptyProviderHistory}`,
      `GAME_MAPPING_FAILED: ${snap.mappingFailed}`,
      `Requests: ${snap.requests.toLocaleString('en-US')}`,
      `Rows archived: ${snap.rowsArchived.toLocaleString('en-US')}`,
      `Failures: ${snap.failures}`,
      `Elapsed: ${formatHms(snap.elapsedMs)}`,
      `Estimated remaining: ${remaining}`,
    ].join('\n');
  }

  maybeLog(logger: (msg: string) => void): void {
    const now = this.now();
    if (now - this.lastLogAt < this.logEveryMs && this.gamesComplete < this.gamesTotal) return;
    this.lastLogAt = now;
    logger(this.formatLine());
  }
}
