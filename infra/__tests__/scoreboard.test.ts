import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const tfFiles = fs.readdirSync(path.join(root, 'infra')).filter((f) => f.endsWith('.tf'));

function blocks(src: string): Array<{ header: string; body: string }> {
  const out: Array<{ header: string; body: string }> = [];
  const re = /^(resource|data) "[^"]+" "[^"]+" \{/gm;
  const starts = [...src.matchAll(re)].map((m) => ({ index: m.index!, header: m[0] }));
  starts.forEach((s, i) => out.push({ header: s.header, body: src.slice(s.index, starts[i + 1]?.index ?? src.length) }));
  return out;
}

describe('scoreboard Terraform: created disabled, preseason only', () => {
  const src = read('infra/scoreboard.tf');
  const vars = read('infra/variables.tf');

  it('creation and execution default to false; the schedule is opt-in', () => {
    expect(vars).toMatch(/variable "scoreboard_create"[\s\S]*?default\s*=\s*false/);
    expect(vars).toMatch(/variable "scoreboard_execution_enabled"[\s\S]*?default\s*=\s*false/);
    expect(src).toMatch(/variable "scoreboard_enable_schedule"[\s\S]*?default\s*=\s*false/);
    const example = read('infra/terraform.tfvars.example');
    for (const v of ['scoreboard_create', 'scoreboard_execution_enabled', 'scoreboard_enable_schedule']) {
      expect(example).toMatch(new RegExp(`^\\s*${v}\\s*=\\s*false\\s*$`, 'm'));
    }
  });

  it('every resource is gated on scoreboard_create', () => {
    for (const b of blocks(src)) expect(b.body, b.header).toMatch(/count\s*=\s*var\.scoreboard_create\b/);
  });

  it('schedule state follows the scoreboard family flag and is never hardcoded ENABLED', () => {
    expect(read('infra/lambda.tf')).toMatch(/scoreboard\s*=\s*var\.live_ingestion_enabled\s*&&\s*var\.scoreboard_execution_enabled/);
    expect(src).toMatch(/state\s*=\s*local\.scoreboard_schedule_state/);
    expect(src).not.toMatch(/state\s*=\s*"ENABLED"/);
    expect(src).toMatch(/count\s*=\s*var\.scoreboard_create && var\.scoreboard_enable_schedule \? 1 : 0/);
  });

  it('Lambda env: family-gated thaw, preseason the only season type Terraform can switch on', () => {
    const env = src.slice(src.indexOf('resource "aws_lambda_function" "scoreboard"'));
    const lastMerge = env.slice(env.indexOf('# Last-merge wins'));
    expect(env.indexOf('var.scoreboard_lambda_env')).toBeLessThan(env.indexOf('# Last-merge wins'));
    for (const [k, on, off] of [
      ['LIVE_INGESTION_ENABLED', '1', '0'],
      ['DATA_MODE', 'live_api', 'replay'],
      ['OFFSEASON_MODE', '0', '1'],
      ['CRON_DRY_RUN', '0', '1'],
      ['SCOREBOARD_COLLECT_PRESEASON', '1', '0'],
    ]) {
      expect(lastMerge).toMatch(new RegExp(`${k}\\s*=\\s*local\\.family_schedule_enabled\\.scoreboard \\? "${on}" : "${off}"`));
    }
    for (const k of ['SCOREBOARD_COLLECT_REGULAR', 'SCOREBOARD_COLLECT_PLAYIN', 'SCOREBOARD_COLLECT_PLAYOFFS']) {
      expect(lastMerge).toMatch(new RegExp(`${k}\\s*=\\s*"0"`));
    }
    expect(lastMerge).toMatch(/BDL_RATE_LIMIT_WORKER\s*=\s*"scoreboard-collector"/);
    expect(lastMerge).toMatch(/BDL_RATE_LIMIT_BACKEND\s*=\s*"dynamodb"/);
    expect(lastMerge).toMatch(/BDL_RATE_LIMIT_TABLE\s*=\s*aws_dynamodb_table\.bdl_rate_limit\.name/);
    expect(lastMerge).toMatch(/BDL_RATE_LIMIT_MAX_RETRIES\s*=\s*"0"/);
    expect(src).not.toMatch(/SCOREBOARD_SERVING_ENABLED/);
    expect(src).toMatch(/maximum_retry_attempts\s*=\s*0/);
  });

  it('reuses the shared limiter table and writes only the two scoreboard S3 prefixes', () => {
    expect(src).toMatch(/policy\s*=\s*jsonencode\(local\.bdl_rate_limit_iam\)/);
    expect(src).not.toMatch(/resource "aws_dynamodb_table"/);
    const s3 = blocks(src).find((b) => b.header.includes('scoreboard_s3_archive'))!.body;
    expect(s3).toMatch(/"s3:PutObject",\s*"s3:GetObject"/);
    expect(s3).not.toMatch(/s3:\*|DeleteObject|ListBucket/);
    expect(src).toMatch(/entity=acq_scoreboard_games"/);
    expect(src).toMatch(/entity=acq_box_scores_live"/);
    expect(src.match(/entity=acq_/g)).toHaveLength(2);
    expect(src).not.toMatch(/espn/i);
    expect(src).not.toMatch(/elasticache|aws_cloudfront|aws_api_gateway/i);
  });

  it('packages from lambda/scoreboard/.package and hashes the bundle', () => {
    expect(src).toMatch(/source_dir\s*=\s*"\$\{path\.module\}\/\.\.\/lambda\/scoreboard\/\.package"/);
    expect(src).toMatch(/filebase64sha256\("\$\{path\.module\}\/\.\.\/lambda\/scoreboard\/\.package\/dist\/index\.js"\)/);
  });
});

describe('enabling the scoreboard cannot activate any other system', () => {
  it('no other family, schedule or Lambda env reads the scoreboard flag', () => {
    for (const f of tfFiles.filter((f) => f !== 'scoreboard.tf')) {
      const src = read(`infra/${f}`);
      const uses = src.match(/var\.scoreboard_execution_enabled|family_schedule_enabled\.scoreboard|scoreboard_schedule_state/g) ?? [];
      if (f === 'lambda.tf') {
        expect(uses.sort(), f).toEqual(['family_schedule_enabled.scoreboard', 'scoreboard_schedule_state', 'var.scoreboard_execution_enabled'].sort());
      } else {
        expect(uses, f).toEqual([]);
      }
    }
    const lambdaTf = read('infra/lambda.tf');
    const familyMap = lambdaTf.slice(lambdaTf.indexOf('family_schedule_enabled = {'), lambdaTf.indexOf('}', lambdaTf.indexOf('family_schedule_enabled = {')));
    for (const line of familyMap.split('\n').filter((l) => /=\s*var\.live_ingestion_enabled/.test(l))) {
      const family = line.trim().split(/\s/)[0];
      if (family === 'scoreboard') continue;
      expect(line, family).toMatch(new RegExp(`var\\.live_ingestion_enabled\\s*&&\\s*var\\.${family}_execution_enabled\\s*$`));
    }
  });

  it('scoreboard.tf references no other family flag', () => {
    const src = read('infra/scoreboard.tf');
    const otherFlags = src.match(/var\.(\w+)_execution_enabled|family_schedule_enabled\.(\w+)/g) ?? [];
    expect(otherFlags.every((m) => /scoreboard/.test(m))).toBe(true);
  });

  it('the master gate is read directly only where its own family gate also applies', () => {
    const direct = tfFiles.flatMap((f) =>
      read(`infra/${f}`)
        .split('\n')
        .filter((l) => /var\.live_ingestion_enabled/.test(l) && !/^\s*#/.test(l))
        .map((l) => `${f}: ${l.trim()}`)
    );
    const outsideFamilyMap = direct.filter((d) => !/^lambda\.tf: \w+\s*=\s*var\.live_ingestion_enabled && var\.\w+_execution_enabled$/.test(d));
    // Known: context-prospective also requires its create/schedule/execution flags; the postgame
    // worker env follows the master gate but only exists with postgame_create and its queue mapping
    // is family-gated. Any new direct reader must be reviewed before a scoreboard activation.
    expect(outsideFamilyMap).toEqual([
      'context-prospective-shadow.tf: var.live_ingestion_enabled &&',
      'postgame-worker.tf: LIVE_INGESTION_ENABLED     = var.live_ingestion_enabled ? "1" : "0"',
    ]);
  });
});

describe('tests never rewrite the Lambda artifacts that Terraform hashes', () => {
  it('every test that runs a Lambda build passes --out-root', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of fs.readdirSync(path.join(root, dir))) {
        if (['node_modules', '.next', '.package', '.terraform', 'dist'].includes(name)) continue;
        const rel = `${dir}/${name}`;
        if (fs.statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
        else if (/\.test\.(ts|mts|js|mjs)$/.test(name) && rel.includes('/__tests__/')) out.push(rel);
      }
      return out;
    };
    const tests = ['lib', 'lambda', 'scripts', 'infra', 'app'].flatMap((d) => walk(d));
    const builders: string[] = [];
    for (const t of tests) {
      const src = read(t);
      for (const m of src.matchAll(/spawnSync\([^;]*?(build\.mjs|bundle-ingestion-lambda|bundler)[^;]*?\)/g)) {
        builders.push(t);
        expect(m[0], t).toMatch(/--out-root=/);
      }
    }
    expect(builders.length).toBeGreaterThanOrEqual(3);
  });
});
