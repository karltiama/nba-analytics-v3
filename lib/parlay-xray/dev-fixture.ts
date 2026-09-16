/**
 * DEVELOPMENT-ONLY layout fixture for Parlay XRay.
 * Never imported as the production default. Do not treat these claims as real analysis.
 */
import { combinedAmericanOdds, knownLegOdds } from './combined-odds';
import { known, needsConfirmation, unknown, withDerivedResolution } from './fields';
import { detectStructuralDependencies, structuralFailureNotes } from './structural';
import type { ExtractedParlayLeg, XRayAnalysis, XRayInsightCard, XRayParlay } from './types';

function card(
  partial: Omit<XRayInsightCard, 'status'> & { status?: XRayInsightCard['status'] }
): XRayInsightCard {
  return { status: 'ready', ...partial };
}

function demoLeg(partial: ExtractedParlayLeg): ExtractedParlayLeg {
  return withDerivedResolution(partial);
}

function previewImage(filename: string): XRayParlay['uploadedImage'] {
  return {
    filename,
    mimeType: 'image/png',
    sizeBytes: 0,
    objectUrl: '',
  };
}

export function buildPartialExtractionFixture(): { parlay: XRayParlay; analysis: null } {
  const legs: ExtractedParlayLeg[] = [
    demoLeg({
      id: 'leg-tatum',
      playerDisplayName: known('Jayson Tatum'),
      playerId: unknown(),
      nbaPlayerId: known('1628369'),
      teamAbbr: known('BOS'),
      opponentAbbr: known('MIA'),
      matchupLabel: known('BOS @ MIA'),
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
    }),
    demoLeg({
      id: 'leg-edwards',
      playerDisplayName: known('Anthony Edwards'),
      playerId: unknown(),
      nbaPlayerId: known('1630162'),
      teamAbbr: known('MIN'),
      opponentAbbr: known('LAL'),
      matchupLabel: known('MIN @ LAL'),
      propKind: known('rebounds'),
      propLabel: known('Rebounds'),
      side: known('over'),
      line: known(5.5),
      oddsAmerican: known(-125),
      sportsbookText: unknown(),
      gameDate: unknown(),
      extractionConfidence: known('high'),
      resolution: 'resolved',
      rawSnippet: null,
    }),
    demoLeg({
      id: 'leg-doncic',
      playerDisplayName: needsConfirmation('Luka Dončić'),
      playerId: unknown(),
      nbaPlayerId: known('1629029'),
      teamAbbr: needsConfirmation('DAL'),
      opponentAbbr: needsConfirmation('DEN'),
      matchupLabel: needsConfirmation('DAL @ DEN'),
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
    }),
    demoLeg({
      id: 'leg-curry',
      playerDisplayName: known('Stephen Curry'),
      playerId: unknown(),
      nbaPlayerId: known('201939'),
      teamAbbr: known('GSW'),
      opponentAbbr: known('SAC'),
      matchupLabel: known('GSW @ SAC'),
      propKind: needsConfirmation('threes'),
      propLabel: needsConfirmation('3-Pointers Made'),
      side: known('over'),
      line: known(4.5),
      oddsAmerican: known(-120),
      sportsbookText: unknown(),
      gameDate: unknown(),
      extractionConfidence: known('medium'),
      resolution: 'needs_confirmation',
      rawSnippet: null,
    }),
    demoLeg({
      id: 'leg-jokic',
      playerDisplayName: known('Nikola Jokić'),
      playerId: unknown(),
      nbaPlayerId: known('203999'),
      teamAbbr: known('DEN'),
      opponentAbbr: known('DAL'),
      matchupLabel: known('DEN vs DAL'),
      propKind: known('points'),
      propLabel: known('Points'),
      side: known('over'),
      line: known(24.5),
      oddsAmerican: known(-115),
      sportsbookText: unknown(),
      gameDate: unknown(),
      extractionConfidence: known('high'),
      resolution: 'resolved',
      rawSnippet: null,
    }),
  ];

  return {
    parlay: {
      id: 'preview-partial',
      source: 'screenshot',
      uploadedImage: previewImage('design-preview.png'),
      legs,
      extractionStatus: 'partial',
      analysisStatus: 'unavailable',
      createdAt: '2026-09-15T00:00:00.000Z',
    },
    analysis: null,
  };
}

export function buildFullPreviewFixture(): { parlay: XRayParlay; analysis: XRayAnalysis } {
  const partial = buildPartialExtractionFixture();
  const legs = partial.parlay.legs.map((leg) =>
    withDerivedResolution({
      ...leg,
      playerDisplayName: { ...leg.playerDisplayName, status: 'known' },
      teamAbbr: { ...leg.teamAbbr, status: 'known' },
      opponentAbbr: { ...leg.opponentAbbr, status: 'known' },
      matchupLabel: { ...leg.matchupLabel, status: 'known' },
      propKind: { ...leg.propKind, status: 'known' },
      propLabel: { ...leg.propLabel, status: 'known' },
      line: { ...leg.line, status: 'known' },
      extractionConfidence: { value: 'high', status: 'known' },
    })
  );

  const structural = detectStructuralDependencies(legs);
  const structuralNotes = structuralFailureNotes(structural);
  const combined = combinedAmericanOdds(knownLegOdds(legs));

  const parlay: XRayParlay = {
    id: 'preview-full',
    source: 'screenshot',
    uploadedImage: previewImage('design-preview.png'),
    legs,
    extractionStatus: 'complete',
    analysisStatus: 'ready',
    createdAt: '2026-09-15T00:00:00.000Z',
  };

  const analysis: XRayAnalysis = {
    status: 'ready',
    generatedAt: null,
    overallRead: card({
      id: 'overall',
      title: 'Overall read',
      headline: 'Mixed evidence',
      detail: 'Design preview only. Two legs share a game, and sample quality is not evaluated here.',
    }),
    strongestLeg: card({
      id: 'strongest',
      title: 'Strongest context',
      headline: 'Stephen Curry',
      detail: 'Design preview placeholder — not a certified matchup read.',
    }),
    riskiestLeg: card({
      id: 'riskiest',
      title: 'Elevated risk',
      headline: 'Luka Dončić',
      detail: 'Design preview placeholder — not a certified risk ranking.',
    }),
    correlation: card({
      id: 'correlation',
      title: 'Structural overlap',
      headline: structural[0] ? 'Same-game legs' : 'None detected',
      detail:
        structural[0]?.label ??
        'No structural overlaps were visible from the current legs. Measured historical correlation is unavailable.',
    }),
    marketMovement: {
      id: 'market_movement',
      title: 'Market movement',
      headline: null,
      detail: '3-hour pre-tip → close is not matched for this preview.',
      status: 'unavailable',
    },
    keyContext: card({
      id: 'key_context',
      title: 'Key context',
      headline: 'WOWY not attached',
      detail: 'Game-level WOWY can inform a future XRay read. It is not wired in this preview.',
    }),
    legAnalyses: legs.map((leg) => ({
      legId: leg.id,
      outlook:
        leg.id === 'leg-doncic' ? 'elevated_risk' : leg.id === 'leg-jokic' ? 'mixed' : 'favorable_context',
      analysisText: 'Design preview copy. Production analysis will only render when a real read exists.',
      wowyNote: null,
      marketMovement: {
        window: '3h_pre_tip_to_close',
        summary: null,
        status: 'unavailable',
      },
    })),
    summary: {
      legCount: legs.length,
      combinedOddsAmerican: combined,
      strongestContext: 'Design preview — strongest-context ranking is not certified.',
      majorRisk: 'Design preview — same-game Dončić / Jokić legs are a structural overlap.',
      correlationWarnings: structural.map((dep) => ({
        kind: 'structural' as const,
        dependency: dep.kind,
        title: dep.kind === 'same_game' ? 'Same-game legs' : dep.kind,
        detail: dep.label,
        measuredCoefficient: null,
      })),
      dataQualityWarnings: ['This is fictional layout data, not a live extraction.'],
      favorableContextCount: 3,
    },
    failureReasons: [
      ...structuralNotes.map((note) => ({
        id: note.id,
        text: note.text,
        source: 'structural' as const,
      })),
      {
        id: 'preview-banner',
        text: 'These failure notes are design-preview copy and are not a model output.',
        source: 'data_quality',
      },
    ],
  };

  return { parlay, analysis };
}
