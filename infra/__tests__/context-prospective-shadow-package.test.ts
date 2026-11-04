import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFrozenBundle } from '@/lib/context-projection/arm';
import { loadFrozenAuxMinBundle } from '@/lib/context-projection/min/arm';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

describe('context-prospective-shadow Lambda package', () => {
  it('points Terraform at the esbuild output and the runtime the bundle targets', () => {
    const tf = read('infra/context-prospective-shadow.tf');
    expect(tf).toContain('handler       = "dist/index.handler"');
    expect(tf).toContain('runtime       = "nodejs22.x"');
    expect(read('scripts/ops/bundle-ingestion-lambda.mjs')).toContain("target: 'node22'");
  });

  it('keeps every collector resource behind context_prospective_create and the schedule fail-closed', () => {
    const tf = read('infra/context-prospective-shadow.tf');
    expect(tf).toMatch(/variable "context_prospective_create"[\s\S]*?default = false/);
    expect(tf).toMatch(/variable "context_prospective_execution_enabled"[\s\S]*?default\s*= false/);
    expect(tf).toContain('state               = local.context_prospective_schedule_state');
    expect(tf).toContain('CONTEXT_MIN_SHADOW_WRITES  = lookup(var.context_prospective_lambda_env, "CONTEXT_MIN_SHADOW_WRITES", "0")');
  });

  it('ships the frozen model artifacts where the collector reads them (cwd = package root)', () => {
    // Temp out-root: never write lambda/*/.package from tests.
    const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-shadow-bundle-'));
    const result = spawnSync(
      process.execPath,
      ['scripts/ops/bundle-ingestion-lambda.mjs', '--lambda=context-prospective-shadow', `--out-root=${outRoot}`],
      { cwd: root, encoding: 'utf8' }
    );
    expect(result.status, result.stderr).toBe(0);
    const pkg = path.join(outRoot, 'context-prospective-shadow/.package');
    expect(fs.existsSync(path.join(pkg, 'dist/index.js'))).toBe(true);
    // Both loaders validate the frozen SHAs and throw on a missing or altered artifact.
    expect(() => loadFrozenBundle(pkg)).not.toThrow();
    expect(() => loadFrozenAuxMinBundle(pkg)).not.toThrow();
  }, 120_000);
});
