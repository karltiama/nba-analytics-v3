import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

describe('13I.2 Terraform apply boundaries', () => {
  it('does not use live_ingestion_enabled as a resource-creation flag for CODE_ONLY families', () => {
    const status = read('infra/game-status-sync.tf');
    const postgame = read('infra/postgame.tf');
    const worker = read('infra/postgame-worker.tf');
    expect(status).toMatch(/count\s*=\s*var\.game_status_sync_create \? 1 : 0/);
    expect(postgame).toMatch(/count\s*=\s*var\.postgame_create \? 1 : 0/);
    expect(worker).toMatch(/count\s*=\s*var\.postgame_create \? 1 : 0/);
    expect(status).not.toMatch(/count\s*=\s*var\.live_ingestion_enabled/);
    expect(postgame).not.toMatch(/count\s*=\s*var\.live_ingestion_enabled/);
  });

  it('does not ignore Lambda source_code_hash', () => {
    const infra = ['infra/lambda.tf', 'infra/game-status-sync.tf', 'infra/postgame-worker.tf']
      .map(read)
      .join('\n');
    expect(infra).not.toMatch(/ignore_changes\s*=\s*\[[^\]]*source_code_hash/);
  });

  it('deployed Lambdas package from .package and hash bundle JS', () => {
    const src = read('infra/lambda.tf');
    expect(src).toMatch(/lambda\/nightly-bdl-updater\/\.package"/);
    expect(src).toMatch(/lambda\/odds-pre-game-snapshot\/\.package"/);
    expect(src).toMatch(/lambda\/injuries-snapshot\/\.package"/);
    expect(src).toMatch(/lambda\/player-props-snapshot\/\.package"/);
    expect(src).toMatch(/lambda\/boxscore-scraper\/\.package"/);
    expect(src).toMatch(
      /filebase64sha256\("\$\{path\.module\}\/\.\.\/lambda\/nightly-bdl-updater\/\.package\/dist\/index\.js"\)/
    );
    expect(src).toMatch(/player_props_bundle_hash/);
    expect(src).not.toMatch(/source_dir\s*=\s*"\$\{path\.module\}\/\.\.\/lambda\/nightly-bdl-updater"/);
  });

  it('injuries Errors and props DLQ alarms stay attached to deployed families', () => {
    const src = read('infra/monitoring.tf');
    const injuriesStart = src.indexOf('resource "aws_cloudwatch_metric_alarm" "injuries_snapshot_errors"');
    const injuriesBlock = src.slice(
      injuriesStart,
      src.indexOf('\nresource "', injuriesStart + 10)
    );
    expect(injuriesBlock).not.toMatch(/count\s*=/);
    const propsStart = src.indexOf('resource "aws_cloudwatch_metric_alarm" "player_props_dlq_not_empty"');
    const propsBlock = src.slice(propsStart, src.indexOf('\nresource "', propsStart + 10) === -1 ? undefined : src.indexOf('\nresource "', propsStart + 10));
    expect(propsBlock).not.toMatch(/count\s*=/);
  });
});
