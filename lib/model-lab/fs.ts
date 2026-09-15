import { existsSync, readFileSync, statSync } from 'fs';
import { isAbsolute, join } from 'path';

export function repoPath(...parts: string[]): string {
  return join(process.cwd(), ...parts);
}

export function resolveArtifact(relOrAbs: string): string {
  return isAbsolute(relOrAbs) ? relOrAbs : repoPath(relOrAbs);
}

export function fileExists(relOrAbs: string): boolean {
  try {
    return existsSync(resolveArtifact(relOrAbs));
  } catch {
    return false;
  }
}

export function readTextIfExists(relOrAbs: string): string | null {
  const full = resolveArtifact(relOrAbs);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf8');
}

export function readJsonIfExists<T>(relOrAbs: string): T | null {
  const text = readTextIfExists(relOrAbs);
  if (text == null) return null;
  return JSON.parse(text) as T;
}

export function fileMtimeMs(relOrAbs: string): number | null {
  const full = resolveArtifact(relOrAbs);
  if (!existsSync(full)) return null;
  return statSync(full).mtimeMs;
}

export function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

export function asNumber(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim()) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function asString(x: unknown): string | null {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  return null;
}
