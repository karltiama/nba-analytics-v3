import { describe, expect, it } from 'vitest';
import { buildFullPreviewFixture, buildPartialExtractionFixture } from '../dev-fixture';
import { known, needsConfirmation, unknown } from '../fields';
import { buildHistoricalAnalysisPreview } from '../interpretation/preview';
import {
  canConfirmLegs,
  createInitialXrayState,
  reduceXrayState,
  selectAnalysisPresentation,
} from '../session';
import { detectStructuralDependencies } from '../structural';
import type { ExtractedParlayLeg } from '../types';

function file() {
  return {
    filename: 'parlay-slip.png',
    mimeType: 'image/png',
    sizeBytes: 2048,
    objectUrl: 'blob:test',
  };
}

describe('xray session', () => {
  it('starts empty with no analysis and no legs', () => {
    const state = createInitialXrayState();
    expect(state.parlay.legs).toEqual([]);
    expect(state.parlay.uploadedImage).toBeNull();
    expect(state.analysis).toBeNull();
    expect(state.designPreview).toBe(false);
    expect(selectAnalysisPresentation(state).visible).toBe(false);
  });

  it('stores a selected file without fabricating extracted legs or analysis', () => {
    const state = reduceXrayState(createInitialXrayState(), { type: 'FILE_SELECTED', file: file() });
    expect(state.parlay.uploadedImage?.filename).toBe('parlay-slip.png');
    expect(state.parlay.legs).toEqual([]);
    expect(state.analysis).toBeNull();
    expect(state.parlay.extractionStatus).toBe('idle');
    expect(state.parlay.analysisStatus).toBe('unavailable');
    expect(selectAnalysisPresentation(state).visible).toBe(false);
  });

  it('starts extraction as pending and confirm still does not produce analysis', () => {
    const selected = reduceXrayState(createInitialXrayState(), { type: 'FILE_SELECTED', file: file() });
    const pending = reduceXrayState(selected, { type: 'EXTRACT_STARTED' });
    expect(pending.parlay.extractionStatus).toBe('pending');
    expect(pending.analysis).toBeNull();

    const extracted = reduceXrayState(pending, {
      type: 'SET_EXTRACTION',
      status: 'complete',
      legs: [
        {
          id: 'a',
          playerDisplayName: known('Luka Dončić'),
          playerId: unknown(),
          nbaPlayerId: unknown(),
          teamAbbr: unknown(),
          opponentAbbr: unknown(),
          matchupLabel: unknown(),
          propKind: known('assists'),
          propLabel: known('Assists'),
          side: known('over'),
          line: known(7.5),
          oddsAmerican: known(100),
          sportsbookText: unknown(),
          gameDate: unknown(),
          extractionConfidence: known('high'),
          resolution: 'resolved',
          rawSnippet: null,
        } satisfies ExtractedParlayLeg,
      ],
    });
    expect(canConfirmLegs(extracted)).toBe(true);
    const confirmed = reduceXrayState(extracted, { type: 'CONFIRM_LEGS' });
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.analysis).toBeNull();
    expect(selectAnalysisPresentation(confirmed).visible).toBe(false);
  });

  it('replace is a new selection; remove returns empty', () => {
    const first = reduceXrayState(createInitialXrayState(), { type: 'FILE_SELECTED', file: file() });
    const replaced = reduceXrayState(first, {
      type: 'FILE_SELECTED',
      file: { ...file(), filename: 'other.jpg', mimeType: 'image/jpeg' },
    });
    expect(replaced.parlay.uploadedImage?.filename).toBe('other.jpg');
    expect(replaced.parlay.legs).toEqual([]);
    const removed = reduceXrayState(replaced, { type: 'FILE_REMOVED' });
    expect(removed.parlay.uploadedImage).toBeNull();
    expect(removed.parlay.extractionStatus).toBe('idle');
  });

  it('keeps upload errors narrow and does not invent legs', () => {
    const state = reduceXrayState(createInitialXrayState(), {
      type: 'FILE_REJECTED',
      code: 'file_too_large',
    });
    expect(state.uploadErrorCode).toBe('file_too_large');
    expect(state.parlay.legs).toEqual([]);
    expect(state.analysis).toBeNull();
  });

  it('edits a leg and treats the corrected fields as known', () => {
    const seeded = reduceXrayState(createInitialXrayState(), {
      type: 'SET_EXTRACTION',
      status: 'partial',
      legs: [
        {
          id: 'a',
          playerDisplayName: needsConfirmation('Luka'),
          playerId: unknown(),
          nbaPlayerId: unknown(),
          teamAbbr: unknown(),
          opponentAbbr: unknown(),
          matchupLabel: unknown(),
          propKind: known('assists'),
          propLabel: known('Assists'),
          side: known('over'),
          line: needsConfirmation(7.5),
          oddsAmerican: known(100),
          sportsbookText: unknown(),
          gameDate: unknown(),
          extractionConfidence: known('low'),
          resolution: 'needs_confirmation',
          rawSnippet: null,
        } satisfies ExtractedParlayLeg,
      ],
    });
    expect(seeded.parlay.extractionStatus).toBe('partial');
    expect(canConfirmLegs(seeded)).toBe(false);

    const edited = reduceXrayState(seeded, {
      type: 'UPDATE_LEG',
      legId: 'a',
      edits: { playerDisplayName: 'Luka Dončić', line: 7.5 },
    });
    const leg = edited.parlay.legs[0];
    expect(leg?.playerDisplayName).toEqual({ value: 'Luka Dončić', status: 'known' });
    expect(leg?.nbaPlayerId).toEqual({ value: null, status: 'unknown' });
    expect(leg?.line).toEqual({ value: 7.5, status: 'known' });
    expect(leg?.resolution).toBe('resolved');
    expect(edited.confirmed).toBe(false);
    expect(edited.analysis).toBeNull();
    expect(canConfirmLegs(edited)).toBe(true);
  });

  it('accepts a needs-confirmation leg without retyping fields', () => {
    const seeded = reduceXrayState(createInitialXrayState(), {
      type: 'SET_EXTRACTION',
      status: 'partial',
      legs: [
        {
          id: 'a',
          playerDisplayName: needsConfirmation('Luka Dončić'),
          playerId: unknown(),
          nbaPlayerId: unknown(),
          teamAbbr: needsConfirmation('DAL'),
          opponentAbbr: unknown(),
          matchupLabel: unknown(),
          propKind: known('assists'),
          propLabel: known('Assists'),
          side: known('over'),
          line: needsConfirmation(8),
          oddsAmerican: known(100),
          sportsbookText: unknown(),
          gameDate: unknown(),
          extractionConfidence: known('low'),
          resolution: 'needs_confirmation',
          rawSnippet: null,
        } satisfies ExtractedParlayLeg,
      ],
    });
    expect(canConfirmLegs(seeded)).toBe(false);

    const accepted = reduceXrayState(seeded, { type: 'ACCEPT_LEG', legId: 'a' });
    const leg = accepted.parlay.legs[0];
    expect(leg?.playerDisplayName).toEqual({ value: 'Luka Dončić', status: 'known' });
    expect(leg?.line).toEqual({ value: 8, status: 'known' });
    expect(leg?.teamAbbr).toEqual({ value: 'DAL', status: 'known' });
    expect(leg?.resolution).toBe('resolved');
    expect(canConfirmLegs(accepted)).toBe(true);

    const confirmed = reduceXrayState(accepted, { type: 'CONFIRM_LEGS' });
    expect(confirmed.confirmed).toBe(true);
  });

  it('does not confirm while any leg still needs confirmation', () => {
    const { parlay } = buildPartialExtractionFixture();
    const state = reduceXrayState(createInitialXrayState(), {
      type: 'LOAD_PREVIEW',
      parlay,
      analysis: null,
      confirmed: false,
    });
    expect(state.parlay.extractionStatus).toBe('partial');
    const counts = state.parlay.legs.filter((l) => l.resolution === 'needs_confirmation');
    expect(counts).toHaveLength(2);
    const blocked = reduceXrayState(state, { type: 'CONFIRM_LEGS' });
    expect(blocked.confirmed).toBe(false);
  });

  it('attaches headshot ids only onto unknown nbaPlayerId fields', () => {
    const extracted = reduceXrayState(createInitialXrayState(), {
      type: 'SET_EXTRACTION',
      status: 'complete',
      legs: [
        {
          id: 'a',
          playerDisplayName: known('Luka Doncic'),
          playerId: unknown(),
          nbaPlayerId: unknown(),
          teamAbbr: unknown(),
          opponentAbbr: unknown(),
          matchupLabel: unknown(),
          propKind: known('assists'),
          propLabel: known('Assists'),
          side: known('over'),
          line: known(7.5),
          oddsAmerican: known(100),
          sportsbookText: unknown(),
          gameDate: unknown(),
          extractionConfidence: known('high'),
          resolution: 'resolved',
          rawSnippet: null,
        } satisfies ExtractedParlayLeg,
        {
          id: 'b',
          playerDisplayName: known('Jayson Tatum'),
          playerId: unknown(),
          nbaPlayerId: known('1628369'),
          teamAbbr: unknown(),
          opponentAbbr: unknown(),
          matchupLabel: unknown(),
          propKind: known('points'),
          propLabel: known('Points'),
          side: known('over'),
          line: known(27.5),
          oddsAmerican: known(-110),
          sportsbookText: unknown(),
          gameDate: unknown(),
          extractionConfidence: known('high'),
          resolution: 'resolved',
          rawSnippet: null,
        } satisfies ExtractedParlayLeg,
      ],
    });
    const attached = reduceXrayState(extracted, {
      type: 'ATTACH_HEADSHOTS',
      ids: { a: '1629029', b: '9999999' },
    });
    expect(attached.parlay.legs[0]?.nbaPlayerId).toEqual({ value: '1629029', status: 'known' });
    expect(attached.parlay.legs[1]?.nbaPlayerId).toEqual({ value: '1628369', status: 'known' });
  });

  it('does not render analysis without analysis data', () => {
    const { parlay } = buildPartialExtractionFixture();
    const state = reduceXrayState(createInitialXrayState(), {
      type: 'LOAD_PREVIEW',
      parlay,
      analysis: null,
      confirmed: false,
    });
    expect(selectAnalysisPresentation(state).visible).toBe(false);
    expect(selectAnalysisPresentation(state).analysis).toBeNull();
  });

  it('loads historical interpretation preview without marking it as fictional design data', () => {
    const { parlay, interpretations, historicalReplay } = buildHistoricalAnalysisPreview();
    const state = reduceXrayState(createInitialXrayState(), {
      type: 'LOAD_PREVIEW',
      parlay,
      analysis: null,
      confirmed: true,
      interpretations,
      historicalReplay,
    });
    expect(state.designPreview).toBe(false);
    expect(state.historicalReplay?.gameId).toBe('18447934');
    expect(state.interpretations).toHaveLength(4);
    expect(state.interpretations?.[0]?.identity.playerDisplayName).toBe('Ajay Mitchell');
    expect(state.historicalReplay?.dateLabel).toMatch(/April 2, 2026/);
  });

  it('does not attach interpretation when Confirm is pressed', () => {
    const extracted = reduceXrayState(createInitialXrayState(), {
      type: 'SET_EXTRACTION',
      status: 'complete',
      legs: [
        {
          id: 'a',
          playerDisplayName: known('Luka Dončić'),
          playerId: unknown(),
          nbaPlayerId: unknown(),
          teamAbbr: unknown(),
          opponentAbbr: unknown(),
          matchupLabel: unknown(),
          propKind: known('assists'),
          propLabel: known('Assists'),
          side: known('over'),
          line: known(7.5),
          oddsAmerican: known(100),
          sportsbookText: unknown(),
          gameDate: unknown(),
          extractionConfidence: known('high'),
          resolution: 'resolved',
          rawSnippet: null,
        } satisfies ExtractedParlayLeg,
      ],
    });
    const confirmed = reduceXrayState(extracted, { type: 'CONFIRM_LEGS' });
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.interpretations).toBeNull();
    expect(confirmed.historicalReplay).toBeNull();
    expect(confirmed.replayStage).toBeNull();
  });

  it('keeps historical replay context when a confirmed name is edited', () => {
    const extracted = reduceXrayState(createInitialXrayState(), {
      type: 'LOAD_PREVIEW',
      parlay: {
        id: 'hist',
        source: 'screenshot',
        uploadedImage: file(),
        legs: [
          {
            id: 'a',
            playerDisplayName: known('Luka Doncik'),
            playerId: unknown(),
            nbaPlayerId: unknown(),
            teamAbbr: unknown(),
            opponentAbbr: unknown(),
            matchupLabel: unknown(),
            propKind: known('points'),
            propLabel: known('Points'),
            side: known('over'),
            line: known(30.5),
            oddsAmerican: known(-120),
            sportsbookText: known('DraftKings'),
            gameDate: known('2026-04-02'),
            extractionConfidence: known('medium'),
            resolution: 'resolved',
            rawSnippet: 'Luka Doncik O 30.5 PTS',
          } satisfies ExtractedParlayLeg,
        ],
        extractionStatus: 'complete',
        analysisStatus: 'unavailable',
        createdAt: '2026-04-03T01:30:00.000Z',
      },
      analysis: null,
      confirmed: false,
      historicalReplay: {
        cutoffAt: '2026-04-03T01:30:00.000Z',
        dateLabel: 'April 2, 2026 · LAL @ OKC',
        gameId: '18447934',
      },
    });
    const edited = reduceXrayState(extracted, {
      type: 'UPDATE_LEG',
      legId: 'a',
      edits: { playerDisplayName: 'Luka Doncic' },
    });
    expect(edited.historicalReplay?.gameId).toBe('18447934');
    expect(edited.parlay.legs[0]?.rawSnippet).toBe('Luka Doncik O 30.5 PTS');
    expect(edited.parlay.legs[0]?.playerDisplayName.value).toBe('Luka Doncic');
    const confirmed = reduceXrayState(edited, { type: 'CONFIRM_LEGS' });
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.replayStage).toBe('resolving');
    expect(confirmed.interpretations).toBeNull();
    expect(confirmed.historicalReplay?.gameId).toBe('18447934');
  });
});

describe('structural dependencies', () => {
  it('flags same-game legs without inventing a correlation coefficient', () => {
    const { parlay } = buildFullPreviewFixture();
    const deps = detectStructuralDependencies(parlay.legs);
    const sameGame = deps.find((d) => d.kind === 'same_game');
    expect(sameGame).toBeTruthy();
    expect(sameGame?.legIds).toEqual(expect.arrayContaining(['leg-doncic', 'leg-jokic']));
    expect(JSON.stringify(deps)).not.toMatch(/0\.\d{2}/);
  });
});
