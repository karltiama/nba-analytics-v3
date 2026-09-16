import { interpretXrayLeg } from '@/lib/parlay-xray/interpretation/interpret';
import type { XRayLegInterpretation } from '@/lib/parlay-xray/interpretation/types';
import { interpretXrayParlay } from '@/lib/parlay-xray/interpretation/parlay';
import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';
import { buildX3fConfirmedLegs } from './fixture';
import { runCanonicalX3fReplay } from './preview';

function cloneLeg(leg: ExtractedParlayLeg, id: string, suffix: number): ExtractedParlayLeg {
  return {
    ...leg,
    id,
    playerDisplayName: { ...leg.playerDisplayName, value: `${leg.playerDisplayName.value ?? 'Player'} ${suffix}` },
    rawSnippet: leg.rawSnippet ? `${leg.rawSnippet} #${suffix}` : `scale-${id}`,
  };
}

export function buildScaleConfirmedLegs(count: 1 | 8 | 12): ExtractedParlayLeg[] {
  const base = buildX3fConfirmedLegs();
  const out: ExtractedParlayLeg[] = [];
  for (let i = 0; i < count; i += 1) {
    const src = base[i % base.length]!;
    out.push(cloneLeg(src, `scale-leg-${i + 1}`, i + 1));
  }
  return out;
}

export function buildScaleInterpretations(count: 1 | 8 | 12): XRayLegInterpretation[] {
  const canonical = runCanonicalX3fReplay();
  const out: XRayLegInterpretation[] = [];
  for (let i = 0; i < count; i += 1) {
    const src = canonical.contexts[i % canonical.contexts.length]!;
    const ctx = JSON.parse(JSON.stringify(src)) as typeof src;
    ctx.identity.originalLeg = {
      ...ctx.identity.originalLeg,
      id: `scale-leg-${i + 1}`,
    };
    ctx.identity.playerDisplayName = `${ctx.identity.playerDisplayName ?? 'Player'} ${i + 1}`;
    out.push(interpretXrayLeg(ctx));
  }
  return out;
}

export function scaleParlayContract(count: 1 | 8 | 12) {
  const interpretations = buildScaleInterpretations(count);
  const parlay = interpretXrayParlay(interpretations);
  return {
    interpretationCount: interpretations.length,
    originalLegIds: interpretations.map((row, index) => `${row.identity.playerDisplayName}:${row.identity.line}:${index}`),
    parlayLegCount: parlay.legCount,
    uniqueKeys: interpretations.map(
      (row, index) => `${row.identity.playerDisplayName}:${row.identity.market}:${row.identity.line}:${index}`
    ),
  };
}
