import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8').replace(/\r\n/g, '\n');

function blocks(src: string, type: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = new RegExp(`resource "${type}" "([^"]+)"`, 'g');
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const next = src.indexOf('\nresource "', m.index + 10);
    out.push({ name: m[1], body: src.slice(m.index, next === -1 ? undefined : next) });
  }
  return out;
}

describe('ingestion alert routing (Phase 1B.4)', () => {
  const alerts = read('alerts.tf');
  const monitoring = read('monitoring.tf');

  it('one SNS topic; email subscription only when a sensitive variable is set', () => {
    expect(blocks(alerts, 'aws_sns_topic')).toHaveLength(1);
    expect(alerts).toMatch(/variable "ingestion_alert_email"[\s\S]*?default\s*=\s*""[\s\S]*?sensitive\s*=\s*true/);
    const sub = blocks(alerts, 'aws_sns_topic_subscription')[0];
    expect(sub.body).toMatch(/count\s*=\s*var\.ingestion_alert_email != "" \? 1 : 0/);
    expect(sub.body).toMatch(/protocol\s*=\s*"email"/);
    expect(alerts).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
  });

  it('every BDL alarm notifies the topic; BBRef, shadow and low-coverage alarms do not', () => {
    const routed = [
      'player_props_worker_failures',
      'injuries_snapshot_errors',
      'nightly_bdl_errors',
      'odds_pre_game_errors',
      'game_status_sync_errors',
      'postgame_stage_dlq_not_empty',
      'player_props_dlq_not_empty',
      'player_props_archive_gap',
      'player_props_archive_failed',
    ];
    const byName = new Map(blocks(monitoring, 'aws_cloudwatch_metric_alarm').map((b) => [b.name, b.body]));
    for (const name of routed) {
      expect(byName.get(name), name).toMatch(/alarm_actions\s*=\s*local\.ingestion_alarm_actions/);
    }
    for (const name of ['boxscore_scraper_errors', 'shadow_projection_errors', 'player_props_controller_low_coverage']) {
      expect(byName.get(name), name).not.toMatch(/alarm_actions/);
    }
    for (const b of blocks(alerts, 'aws_cloudwatch_metric_alarm')) {
      expect(b.body, b.name).toMatch(/alarm_actions\s*=\s*local\.ingestion_alarm_actions/);
    }
  });

  it('alarms that breach on missing data exist only while their family is live', () => {
    const breaching = blocks(alerts, 'aws_cloudwatch_metric_alarm').filter((b) =>
      /treat_missing_data\s*=\s*"breaching"/.test(b.body)
    );
    expect(breaching.length).toBeGreaterThan(0);
    for (const b of breaching) {
      expect(b.body, b.name).toMatch(/count\s*=.*local\.family_schedule_enabled\.\w+.*\? 1 : 0/);
    }
  });

  it('handled failures are counted from logs because those handlers return 500 without raising', () => {
    expect(alerts).toContain('"\\"Nightly BDL Updater: FAILED\\""');
    expect(alerts).toContain('"\\"Error in injuries snapshot\\""');
    expect(alerts).toContain('game_status_sync_failed');
    expect(alerts).toMatch(/\$\.decision = \\"provider_429\\"/);
  });

  it('does not create or enable any schedule', () => {
    expect(alerts).not.toMatch(/aws_scheduler_schedule|aws_cloudwatch_event_rule|state\s*=\s*"ENABLED"/);
  });
});
