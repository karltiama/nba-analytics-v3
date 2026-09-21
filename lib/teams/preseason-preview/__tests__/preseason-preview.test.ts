import { describe, expect, it } from 'vitest';
import { buildSnapshotFields } from '../snapshot-fields';
import {
  getPreseasonPreviewContentBySlug,
  listPreseasonPreviewSlugs,
} from '../registry';
import { detroitPreseasonPreview } from '../content/detroit';
import { bostonPreseasonPreview } from '../content/boston';
import { emptyTeamSeasonSnapshot } from '@/lib/teams/team-season-snapshot';

describe('preseason preview registry', () => {
  it('registers Detroit by DET slug', () => {
    expect(listPreseasonPreviewSlugs()).toContain('DET');
    expect(getPreseasonPreviewContentBySlug('det')?.headline).toBe(
      detroitPreseasonPreview.headline
    );
  });

  it('registers Boston by BOS slug', () => {
    expect(listPreseasonPreviewSlugs()).toContain('BOS');
    expect(getPreseasonPreviewContentBySlug('bos')?.headline).toBe(
      bostonPreseasonPreview.headline
    );
  });

  it('returns null for teams without curated content', () => {
    expect(getPreseasonPreviewContentBySlug('NYK')).toBeNull();
  });
});

describe('researchPacketToPreviewContent', () => {
  it('scaffolds editable preview content from a research-shaped packet', async () => {
    const { researchPacketToPreviewContent } = await import(
      '../research-to-preview-content'
    );
    const content = researchPacketToPreviewContent(
      {
      version: 'preseason-research-packet-v1.2',
      generatedAt: '2026-09-21T00:00:00.000Z',
      season: '2026',
      previousSeason: '2025',
      team: {
        teamId: '4',
        slug: 'CHA',
        name: 'Charlotte Hornets',
        abbreviation: 'CHA',
        conference: 'East',
      },
      snapshot: {
        regularSeason: {
          season: '2025',
          available: true,
          unavailableReason: null,
          metricsScope: 'regular_season',
          postseasonStartEt: '2026-04-14',
          gamesPlayed: 82,
          wins: 44,
          losses: 38,
          record: '44–38',
          offensiveRating: 116,
          defensiveRating: 111,
          pace: 99,
          provenance: {
            method: 'test',
            tables: [],
            season: '2025',
          },
        },
        allGamesInternal: {
          season: '2025',
          available: true,
          unavailableReason: null,
          wins: 45,
          losses: 39,
          record: '45–39',
          offensiveRating: 116,
          defensiveRating: 111,
          pace: 99,
          gamesPlayed: 84,
          includesPostseason: true,
          metricsScope: 'all_games',
          scopeNote: null,
          provenance: { method: 'test', tables: [], season: '2025' },
        },
        previousSeed: null,
        previousPlayoffResult: null,
        coverageNotes: [],
      },
      roster: {
        additions: [
          {
            playerEntityId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            displayName: 'Naz Reid',
            playerId: '1',
            position: 'F',
            status: 'ADDED',
            confidence: 'high',
            evidence: [],
            otherTeamAbbr: 'MIN',
            provenance: { method: 'test', tables: [], season: '2026' },
            requiresHumanRosterReview: true,
            reviewReasons: ['TOP_MINUTES_CONFIRMED_ADDITION'],
          },
        ],
        departures: [
          {
            playerEntityId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            displayName: 'LaMelo Ball',
            playerId: '2',
            position: 'G',
            status: 'DEPARTED',
            confidence: 'high',
            evidence: [],
            otherTeamAbbr: 'MIN',
            provenance: { method: 'test', tables: [], season: '2026' },
            requiresHumanRosterReview: true,
            reviewReasons: ['HIGH_USAGE_CONFIRMED_DEPARTURE'],
          },
        ],
        returningCore: [],
        draftPicks: [],
        unresolved: [],
      },
      playersToWatchCandidates: [
        {
          playerEntityId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          playerId: '1',
          displayName: 'Naz Reid',
          reasons: ['NEW_HIGH_MINUTE_ADDITION'],
          supportingSignalTypes: [],
          evidencePaths: ['x'],
          relevantStats: {
            mpg: 24,
            ppg: 12,
            usageAvg: 0.2,
            recentMpg: null,
          },
        },
      ],
      roleUsageShiftCandidates: [],
      wowyCandidates: [
        {
          status: 'CANDIDATE_FOR_REVIEW',
          label: 'Core pair',
          focalPlayerId: null,
          teammateId: null,
          focalDisplayName: 'A',
          teammateDisplayName: null,
          reason: 'no computed WOWY',
          evidencePaths: [],
          sampleSize: null,
          supportTier: null,
          metrics: null,
        },
      ],
      researchQuestions: [
        {
          text: 'Who absorbs vacated creation?',
          evidence: ['roster.departures'],
        },
      ],
      notableStats: [],
      unresolvedItems: [],
      contextSignals: [],
      playerSeasonStats: [],
      provenanceSummary: [],
      warnings: [],
    },
      new Map([
        ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '1630193'],
        ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '1630163'],
      ])
    );

    expect(content.slug).toBe('CHA');
    expect(content.projectedRotation).toBeNull();
    expect(content.dek).toContain('[EDIT]');
    expect(content.departures[0]?.name).toBe('LaMelo Ball');
    expect(content.departures[0]?.nbaPlayerId).toBe('1630163');
    expect(content.additions[0]?.nbaPlayerId).toBe('1630193');
    expect(content.playersToWatch[0]?.nbaPlayerId).toBe('1630193');
    // Must not leak BDL/analytics playerId into headshot field
    expect(content.additions[0]?.nbaPlayerId).not.toBe('1');
    expect(content.additions[0]?.context).toContain('review:');
    expect(content.wowyContext[0]?.detail).toContain('Candidate for review');
    expect(content.keyQuestions[0]?.headline).toContain('vacated creation');
  });
});

describe('buildSnapshotFields', () => {
  it('omits fields when prior snapshot has no data', () => {
    const fields = buildSnapshotFields(
      emptyTeamSeasonSnapshot('2025'),
      detroitPreseasonPreview
    );
    expect(fields).toEqual([]);
  });

  it('includes record, ratings, and pace when present', () => {
    const fields = buildSnapshotFields(
      {
        season: '2025',
        hasData: true,
        gamesPlayed: 82,
        wins: 44,
        losses: 38,
        ppg: 112.1,
        ortg: 114.2,
        drtg: 112.0,
        netRating: 2.2,
        pace: 100.1,
        sampleBand: 'normal',
        sampleLabel: null,
        metricsScope: 'all_games',
        includesPostseason: false,
        scopeNote: null,
      },
      {
        ...detroitPreseasonPreview,
        snapshotNotes: { playoffResult: 'First Round' },
      }
    );

    expect(fields.map((f) => f.label)).toEqual([
      '2025–26 Record',
      'Playoff Result',
      'Offensive Rating',
      'Defensive Rating',
      'Pace',
    ]);
    expect(fields.find((f) => f.label === 'Playoff Result')?.value).toBe(
      'First Round'
    );
  });
});
