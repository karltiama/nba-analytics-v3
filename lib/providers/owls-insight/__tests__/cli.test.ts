import { describe, expect, it, vi } from 'vitest';
import { OwlsExecuteRequiredError, OwlsApiKeyRequiredError } from '../errors';
import { OwlsInsightClient } from '../client';
import { OWLS_PATHS } from '../contract';
import {
  assertExecuteArchiveTarget,
  assertRequestedSeasonScope,
  buildExecuteSummary,
  formatExecuteSummary,
  parseOwlsCliArgs,
  requireExecutePreconditions,
} from '../cli';
import { FIXTURE_COURT_CONTEXT_GAMES } from '../fixtures';
import type { CourtContextGame } from '../types';

const mixedGames: CourtContextGame[] = [
  { ...FIXTURE_COURT_CONTEXT_GAMES[0]!, season: '2023' },
  {
    courtContextGameId: '18444564',
    season: '2024',
    startTime: '2025-06-23T00:00:00.000Z',
    homeTeam: 'OKC',
    awayTeam: 'IND',
  },
];

describe('Owls CLI parsing', () => {
  it('parses --season 2024', () => {
    const args = parseOwlsCliArgs(['--season', '2024']);
    expect(args.season).toBe('2024');
    expect(args.mode).toBe('dry-run');
    expect(args.execute).toBe(false);
  });

  it('parses --season 2022', () => {
    expect(parseOwlsCliArgs(['--season', '2022']).season).toBe('2022');
    expect(parseOwlsCliArgs(['--season=2022']).season).toBe('2022');
  });

  it('parses --season=2024', () => {
    expect(parseOwlsCliArgs(['--season=2024']).season).toBe('2024');
  });

  it('recovers season when npm swallowed --season and left 2024', () => {
    expect(parseOwlsCliArgs(['2024']).season).toBe('2024');
    expect(parseOwlsCliArgs([], { npm_config_season: '2024' }).season).toBe('2024');
  });

  it('parses spaced and equals forms for other value flags', () => {
    expect(parseOwlsCliArgs(['--game-id', '1037995']).gameId).toBe('1037995');
    expect(parseOwlsCliArgs(['--game-id=1037995']).gameId).toBe('1037995');
    expect(parseOwlsCliArgs(['--from', '2025-01-15', '--to=2025-01-16']).from).toBe('2025-01-15');
    expect(parseOwlsCliArgs(['--from', '2025-01-15', '--to=2025-01-16']).to).toBe('2025-01-16');
    expect(parseOwlsCliArgs(['--run-id', 'owls-probe']).runId).toBe('owls-probe');
    expect(parseOwlsCliArgs(['--phase=1']).phase).toBe(1);
  });

  it('fails closed on missing season value', () => {
    expect(() => parseOwlsCliArgs(['--season'])).toThrow(/Missing value for --season/);
    expect(() => parseOwlsCliArgs(['--season='])).toThrow(/Missing value for --season/);
    expect(() => parseOwlsCliArgs(['--season', '--yes'])).toThrow(/Missing value for --season/);
  });

  it('fails closed on invalid season', () => {
    expect(() => parseOwlsCliArgs(['--season', '2019'])).toThrow(/Invalid --season 2019/);
    expect(() => parseOwlsCliArgs(['--season=1999'])).toThrow(/Invalid --season 1999/);
  });

  it('fails closed on unexpected multi-season expansion', () => {
    expect(() => assertRequestedSeasonScope('2024', mixedGames)).toThrow(
      /unexpectedly resolved to \[2023, 2024\]/
    );
  });

  it('fails closed when a supplied season matches zero games', () => {
    expect(() => assertRequestedSeasonScope('2025', [])).toThrow(/0 games/);
  });
});

describe('Owls execute gates', () => {
  it('prints the mandatory execute summary shape', () => {
    const cli = parseOwlsCliArgs(['--season=2024', '--phase=1', '--execute', '--yes']);
    const text = formatExecuteSummary(
      buildExecuteSummary({
        cli,
        games: mixedGames.filter((g) => g.season === '2024'),
        bucket: 'nba-analytics-data-260029269390',
        estimatedHistoryRequests: 'unknown until live probe',
      })
    );
    expect(text).toContain('Provider: Owls Insight');
    expect(text).toContain('Phase: 1');
    expect(text).toContain('Seasons: [2024]');
    expect(text).toContain('Date range:');
    expect(text).toContain('Court Context games: 1');
    expect(text).toContain('Expected request scope:');
    expect(text).toContain('S3 bucket: nba-analytics-data-260029269390');
    expect(text).toContain('S3 prefix:');
    expect(text).toContain('source=owls_insight');
    expect(text).not.toContain('balldontlie');
    expect(text).toContain('Concurrency: 2');
    expect(text).toContain('Resume: enabled');
  });

  it('refuses execute without API key', () => {
    expect(() =>
      requireExecutePreconditions(parseOwlsCliArgs(['--execute', '--yes']), { NBA_DATA_BUCKET: 'bucket' })
    ).toThrow(OwlsApiKeyRequiredError);
  });

  it('refuses execute without bucket', () => {
    expect(() =>
      requireExecutePreconditions(parseOwlsCliArgs(['--execute', '--yes']), { OWLS_API_KEY: 'secret' })
    ).toThrow(/NBA_DATA_BUCKET/);
  });

  it('refuses execute without --yes', () => {
    expect(() =>
      requireExecutePreconditions(parseOwlsCliArgs(['--execute']), {
        OWLS_API_KEY: 'secret',
        NBA_DATA_BUCKET: 'bucket',
      })
    ).toThrow(/--yes/);
  });

  it('refuses fixture and protected prefixes on execute', () => {
    expect(() => assertExecuteArchiveTarget({ fixture: true })).toThrow(/fixture/);
    expect(() =>
      assertExecuteArchiveTarget({
        fixture: false,
        sampleKey: 'raw/source=owls_insight_fixture/league=nba/x.json.gz',
      })
    ).toThrow(/fixture S3 prefix/);
    expect(() =>
      assertExecuteArchiveTarget({
        fixture: false,
        sampleKey: 'raw/source=balldontlie/league=nba/season=2026/entity=player_prop_snapshots/x.json.gz',
      })
    ).toThrow(/protected prefix/);
    expect(() =>
      assertExecuteArchiveTarget({
        fixture: false,
        sampleKey: 'raw/source=existing_ingestion/league=nba/season=2025/entity=player_props_raw_v2/x.json.gz',
      })
    ).toThrow(/protected prefix/);
  });

  it('dry-run never calls network', async () => {
    const args = parseOwlsCliArgs(['--season', '2024']);
    expect(args.execute).toBe(false);
    expect(args.mode).toBe('dry-run');
    const fetchImpl = vi.fn();
    const client = new OwlsInsightClient({ mode: args.mode, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(
      client.request({ method: 'GET', path: OWLS_PATHS.historyGames, query: { sport: 'nba' } })
    ).rejects.toBeInstanceOf(OwlsExecuteRequiredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
