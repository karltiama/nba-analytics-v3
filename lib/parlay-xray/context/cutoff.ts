export function parseCutoffIso(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function isStrictlyBeforeCutoff(startTime: string | null | undefined, cutoffAt: string): boolean {
  if (startTime == null || startTime === '') return false;
  const startMs = Date.parse(startTime);
  const cutoffMs = Date.parse(cutoffAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(cutoffMs)) return false;
  return startMs < cutoffMs;
}

export function isUsablePriorRow(args: {
  gameId: string;
  startTime: string | null | undefined;
  cutoffAt: string;
  targetGameId: string | null;
}): boolean {
  if (args.targetGameId && args.gameId === args.targetGameId) return false;
  return isStrictlyBeforeCutoff(args.startTime, args.cutoffAt);
}
