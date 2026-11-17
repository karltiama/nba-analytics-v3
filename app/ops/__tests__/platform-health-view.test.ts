import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HEALTH_WARNING_THRESHOLDS } from '@/lib/ops/health-status';
import type { PlatformHealthReport } from '@/lib/ops/platform-health';
import { PlatformHealthView } from '../PlatformHealthView';

function report(): PlatformHealthReport {
  return {
    generatedAt: '2026-11-12T21:00:00.000Z',
    overall: 'HEALTHY',
    freeze: {
      dataMode: 'replay',
      offseason: true,
      cronDryRun: true,
      frozen: true,
      liveIngestionEnabled: false,
    },
    webIngestion: {
      state: 'RESTRICTED',
      reason: 'LIVE_INGESTION_ENABLED is unset on this web process.',
    },
    database: {
      status: 'HEALTHY',
      reason: 'ok',
      sizePretty: '1 MB',
      sizeBytes: 1,
      largest: [],
      rowCounts: [],
    },
    ingestion: [
      {
        source: 'props',
        tracked: true,
        latestStatus: 'success',
        lastSuccessAt: '2026-11-12T19:00:00.000Z',
        lastStartedAt: '2026-11-12T19:00:00.000Z',
        rowsStored: 10,
        status: 'HEALTHY',
        reason: 'recent successful pull',
      },
    ],
    families: [
      {
        id: 'scoreboard',
        label: 'Display scoreboard',
        config: 'FROZEN',
        webFeedConfig: 'FROZEN',
        configScope: 'web_process_or_catalog',
        collectorStatus: 'HEALTHY',
        freshness: 'FRESH',
        freshnessSource: 'display.scoreboard_collector_state',
        lastSuccessAt: '2026-11-12T20:37:00.000Z',
        lastInvocationAt: '2026-11-12T20:37:00.000Z',
        lastInvocationSuccess: 'UNKNOWN',
        awsState: 'ENABLED',
        scheduleLabel: 'ENABLED',
        expectedCadence: 'every minute',
        warning: null,
        missedRun: 'OK',
        correlation: 'HEALTHY',
        status: 'HEALTHY',
        reason: 'schedule enabled, recent execution, and a recent database write',
      },
      {
        id: 'bbref_boxscore',
        label: 'BBRef boxscore',
        config: 'FROZEN',
        webFeedConfig: 'FROZEN',
        configScope: 'web_process_or_catalog',
        collectorStatus: 'FROZEN',
        freshness: 'STALE',
        freshnessSource: 'bbref',
        lastSuccessAt: null,
        lastInvocationAt: null,
        lastInvocationSuccess: null,
        awsState: 'DISABLED',
        scheduleLabel: 'DISABLED',
        expectedCadence: 'daily',
        warning: 'AWS schedule is disabled and no recent execution was observed',
        missedRun: 'NOT_EXPECTED',
        correlation: 'FROZEN',
        status: 'FROZEN_EXPECTED',
        reason: 'AWS schedule is disabled and no recent execution was observed',
      },
      {
        id: 'plays',
        label: 'Plays',
        config: 'MANUAL_ONLY',
        webFeedConfig: 'MANUAL_ONLY',
        configScope: 'web_process_or_catalog',
        collectorStatus: 'UNKNOWN',
        freshness: 'UNAVAILABLE',
        freshnessSource: 'plays',
        lastSuccessAt: null,
        lastInvocationAt: null,
        lastInvocationSuccess: null,
        awsState: 'UNKNOWN',
        scheduleLabel: 'UNKNOWN',
        expectedCadence: 'not deployed',
        warning: 'AWS schedule state was not established',
        missedRun: 'NOT_EXPECTED',
        correlation: 'UNKNOWN',
        status: 'UNKNOWN',
        reason: 'AWS schedule state was not established',
      },
      {
        id: 'player_props_controller',
        label: 'Player props controller',
        config: 'FROZEN',
        webFeedConfig: 'FROZEN',
        configScope: 'web_process_or_catalog',
        collectorStatus: 'HEALTHY',
        freshness: 'STALE',
        freshnessSource: 'raw.player_prop_pull_runs',
        lastSuccessAt: '2026-11-12T19:00:00.000Z',
        lastInvocationAt: '2026-11-12T23:55:00.000Z',
        lastInvocationSuccess: 'UNKNOWN',
        awsState: 'ENABLED',
        scheduleLabel: 'ENABLED',
        expectedCadence: '08:00–23:59 America/New_York',
        warning: null,
        missedRun: 'CADENCE_UNSET',
        correlation: 'HEALTHY',
        status: 'HEALTHY',
        reason: 'no eligible work',
      },
    ],
    identity: {
      status: 'HEALTHY',
      reason: 'clear',
      unresolved: 0,
      conflicts: 0,
      resolved: 0,
      classCCanonical: 0,
      alert: false,
    },
    scheduleCompleteness: {
      status: 'UNKNOWN',
      reason: 'not queried',
      localCount: null,
      providerPublished: 0,
      expectedRs: 0,
      unpublished: 0,
      reconciliation: 'UNAVAILABLE',
    },
    scheduleMismatch: {
      status: 'UNKNOWN',
      reason: 'AWS schedule state was not established',
      observed: 'UNKNOWN',
    },
    queues: {
      id: 'player_props',
      label: 'Player props',
      deployed: null,
      deployState: 'UNKNOWN',
      status: 'UNKNOWN',
      reason: 'not queried',
      queueDepth: null,
      inFlight: null,
      oldestAgeSeconds: null,
      dlqDepth: null,
      reservedConcurrencyApplied: null,
      reservedConcurrency: 'UNKNOWN',
    },
    queueCards: [],
    providers: [],
    aws: { status: 'UNKNOWN', reason: 'not queried', queried: false, available: false },
    postgame: {
      status: 'UNKNOWN',
      reason: 'not queried',
      tablePresent: false,
      schemaState: 'UNKNOWN',
      queueDeployed: null,
      workerDeployed: null,
      failedCount: 0,
      blockedCount: 0,
      waitingCount: 0,
      readyCount: 0,
      byStage: [],
      boxProvider: 'UNKNOWN',
      badgeLabel: null,
    },
    injuryServing: {
      status: 'HEALTHY',
      reason: 'snapshot is fresh',
      latestSnapshotAt: '2026-11-12T18:00:00.000Z',
      ageHours: 3,
      authoritative: false,
      servingRestricted: true,
    },
    shadow: {
      status: 'UNKNOWN',
      reason: 'not queried',
      schemaEnrichment: 'unavailable',
      lastSuccessfulCollectionAt: null,
      lastSuccessfulCollectionAgeHours: null,
      failedOrIncompletePulls: 0,
      unresolvedIdentities: 0,
      due: 0,
      onTime: 0,
      late: 0,
      failed: 0,
      missing: 0,
      staleFeatureInputs: false,
      featureInputAgeHours: null,
      settlementBacklog: null,
      windowStart: null,
      alertsPrepared: false,
      notificationDestination: null,
    },
    archives: [],
    coverage: [],
    prune: { status: 'UNKNOWN', reason: 'none', note: 'none' },
    s3: { status: 'UNKNOWN', reason: 'none', note: 'none', entities: [] },
    thresholds: HEALTH_WARNING_THRESHOLDS,
  };
}

describe('PlatformHealthView', () => {
  it('shows a healthy collector beside a restricted web process, and does not call an unread schedule DISABLED', () => {
    const html = renderToStaticMarkup(createElement(PlatformHealthView, { report: report() }));
    expect(html).toContain('Web ingestion is RESTRICTED');
    expect(html).toContain('Display scoreboard');
    expect(html).toContain('HEALTHY');
    expect(html).toContain('AWS schedule ENABLED');
    expect(html).toContain('2026-11-12T20:37:00.000Z');
    expect(html).toContain('freshness FRESH');
    expect(html).toContain('webFeedConfig');
    expect(html).toContain('Player props controller');
    expect(html).toContain('freshness STALE');
    expect(html).toContain('the stored record is stale');
    expect(html).toContain('BBRef boxscore');
    expect(html).toContain('AWS schedule DISABLED');
    expect(html).toContain('Plays');
    expect(html).toContain('AWS schedule UNKNOWN');
    expect(html.match(/AWS schedule DISABLED/g)).toHaveLength(1);
    expect(html).toContain('They are not DISABLED.');
  });
});
