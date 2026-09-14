import { OWLS_SNAPSHOT_PROBE_CAPS } from './contract';

export type SnapshotProbeBudgetState = {
  requests: number;
  rows: number;
  compressedBytes: number;
  games: number;
  stopReason: string | null;
};

export class SnapshotProbeBudget {
  requests = 0;
  rows = 0;
  compressedBytes = 0;
  games = 0;
  stopReason: string | null = null;

  constructor(private readonly caps = OWLS_SNAPSHOT_PROBE_CAPS) {}

  snapshot(): SnapshotProbeBudgetState {
    return {
      requests: this.requests,
      rows: this.rows,
      compressedBytes: this.compressedBytes,
      games: this.games,
      stopReason: this.stopReason,
    };
  }

  canStartGame(): boolean {
    if (this.stopReason) return false;
    if (this.games + 1 > this.caps.maxGames) {
      this.stopReason = `max games ${this.caps.maxGames}`;
      return false;
    }
    return true;
  }

  recordGame(): void {
    this.games += 1;
  }

  canStartRequest(): boolean {
    if (this.stopReason) return false;
    if (this.requests + 1 > this.caps.maxRequests) {
      this.stopReason = `max API requests ${this.caps.maxRequests}`;
      return false;
    }
    if (this.rows >= this.caps.maxRows) {
      this.stopReason = `max returned rows ${this.caps.maxRows}`;
      return false;
    }
    if (this.compressedBytes >= this.caps.maxCompressedBytes) {
      this.stopReason = `max compressed bytes ${this.caps.maxCompressedBytes}`;
      return false;
    }
    return true;
  }

  recordPage(args: { rows: number; compressedBytes: number }): void {
    this.requests += 1;
    this.rows += args.rows;
    this.compressedBytes += args.compressedBytes;
    if (this.rows > this.caps.maxRows) this.stopReason = `max returned rows ${this.caps.maxRows}`;
    if (this.compressedBytes > this.caps.maxCompressedBytes) {
      this.stopReason = `max compressed bytes ${this.caps.maxCompressedBytes}`;
    }
  }
}

export function snapshotArchiveSlug(args: {
  eventId: string;
  book: string;
  propType: string;
  opening: boolean;
}): string {
  const event = args.eventId.replace(/[^a-zA-Z0-9:@._-]+/g, '_');
  return `${event}__book=${args.book}__prop=${args.propType}__opening=${args.opening ? '1' : '0'}`;
}
