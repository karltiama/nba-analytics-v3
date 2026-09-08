/**
 * Local/process lock so two operator-driven BDL trial acquisition jobs cannot
 * share the same API key by accident. Not a distributed scheduler.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BDL_TRIAL_LOCK_BUSY = 'Another BDL trial acquisition job is already active.';

export type AcquisitionLockHandle = {
  path: string;
  release: () => void;
};

export function defaultBdlAcquisitionLockPath(): string {
  return path.join(os.tmpdir(), 'nba-analytics-v3-bdl-acquisition.lock');
}

function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockPid(lockPath: string): number | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as { pid?: number };
    return typeof parsed.pid === 'number' ? parsed.pid : null;
  } catch {
    return null;
  }
}

export function acquireBdlAcquisitionLock(lockPath = defaultBdlAcquisitionLockPath()): AcquisitionLockHandle {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const tryCreate = (): AcquisitionLockHandle | null => {
    try {
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
        { flag: 'wx' }
      );
      return {
        path: lockPath,
        release: () => {
          try {
            fs.unlinkSync(lockPath);
          } catch {
            // already gone
          }
        },
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;
      return null;
    }
  };

  const created = tryCreate();
  if (created) return created;

  const existingPid = readLockPid(lockPath);
  if (existingPid != null && pidIsAlive(existingPid)) {
    throw new Error(BDL_TRIAL_LOCK_BUSY);
  }

  try {
    fs.unlinkSync(lockPath);
  } catch {
    // race: other process may have removed it
  }

  const retry = tryCreate();
  if (retry) return retry;
  throw new Error(BDL_TRIAL_LOCK_BUSY);
}

export function bdlAcquisitionLockStatus(lockPath = defaultBdlAcquisitionLockPath()): {
  active: boolean;
  pid: number | null;
} {
  if (!fs.existsSync(lockPath)) return { active: false, pid: null };
  const pid = readLockPid(lockPath);
  if (pid != null && pidIsAlive(pid)) return { active: true, pid };
  return { active: false, pid };
}
