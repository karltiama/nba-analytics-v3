/**
 * Diagnostic: trace through the EV calculation pipeline for extreme values.
 * Fetches live props from the API, computes EV, and dumps the full internal state.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { query } from '../lib/db';
import { getPlayerPropModelInputs, getStatsForPropType } from '../lib/betting/player-prop-inputs';
import {
  computePlayerPropProbability,
  computeTrackB1PlayerPropProbability,
  getStdDev,
  computeProjection,
} from '../lib/betting/player-prop-model';
import { calibrateProbability } from '../lib/betting/ev-calibration';
import { isComboPropType } from '../lib/betting/track-b1-policy';
import { computePropEvFields } from '../lib/betting/player-prop-ev-row';
import * as fs from 'fs';

async function main() {
  // Fetch a sample of current props
  const rows = await query(`
    SELECT p.game_id, p.player_id, COALESCE(p.player_name, pl.full_name) AS player_name, 
           p.sportsbook, p.prop_type, p.market_type, p.side,
           p.line_value, p.odds_american, p.odds_decimal, p.implied_probability
    FROM analytics.player_props_current p
    LEFT JOIN analytics.players pl ON pl.player_id = p.player_id::text
    WHERE p.market_type = 'over_under'
      AND (lower(p.side) = 'over' OR lower(p.side) = 'under')
      AND p.odds_decimal IS NOT NULL
    ORDER BY p.snapshot_at DESC
    LIMIT 500
  `);

  console.log(`Fetched ${rows.length} props to diagnose...`);

  // Get unique players
  const playerIds = [...new Set(rows.map((r: any) => r.player_id))];
  console.log(`Loading model inputs for ${playerIds.length} players...`);

  const inputsByPlayer = new Map<number, any>();
  for (const pid of playerIds) {
    try {
      const inputs = await getPlayerPropModelInputs(String(pid));
      inputsByPlayer.set(pid, inputs);
    } catch {
      inputsByPlayer.set(pid, null);
    }
  }

  interface DiagRow {
    playerName: string;
    propType: string;
    side: string;
    line: number;
    oddsAmerican: number;
    oddsDecimal: number;
    marketImpliedProb: number;
    // Model inputs
    last10Avg: number | null;
    last5Avg: number | null;
    seasonAvg: number | null;
    observedStdDev: number | null;
    fallbackStdDev: number;
    // Baseline (Track A raw)
    baseProjection: number;
    pOverBaseline: number;
    pSideBaseline: number;
    // Track B raw
    trackBProjection: number;
    pOverTrackB: number;
    pSideRawB: number;
    sigmaEffective: number | null;
    // After calibration
    pCalB: number;
    calSlope: number;
    calIntercept: number;
    // After anchoring
    pAnchB: number;
    anchorApplied: boolean;
    anchorDelta: number;
    // Final EV
    evTrackBRaw: number;
    evTrackBCalibrated: number;
    evTrackBAnchored: number;
    // Confidence
    confidenceTier: string | null;
    sampleGamesUsed: number | null;
  }

  const diagnostics: DiagRow[] = [];

  for (const r of rows) {
    const inputs = inputsByPlayer.get(r.player_id);
    if (!inputs) continue;

    const stats = getStatsForPropType(inputs, r.prop_type ?? '');
    if (!stats) continue;

    const lineNum = Number(r.line_value);
    const oddsDecimal = Number(r.odds_decimal);
    if (!Number.isFinite(lineNum) || !Number.isFinite(oddsDecimal) || oddsDecimal <= 1) continue;

    const propTypeStr = r.prop_type ?? 'points';
    const isUnder = (r.side ?? '').toLowerCase() === 'under';
    const isCombo = isComboPropType(propTypeStr);
    const marketProb = 1 / oddsDecimal;

    // Baseline calculation (Track A raw)
    const baseProjection = computeProjection(stats.last10Avg, stats.seasonAvg);
    const fallbackStd = getStdDev(propTypeStr);
    const baselineResult = computePlayerPropProbability({
      last10Avg: stats.last10Avg,
      seasonAvg: stats.seasonAvg,
      line: lineNum,
      propType: propTypeStr,
    });
    const pSideBaseline = isUnder ? 1 - baselineResult.probability : baselineResult.probability;

    // Track B calculation
    const trackBResult = computeTrackB1PlayerPropProbability(
      {
        last10Avg: stats.last10Avg,
        seasonAvg: stats.seasonAvg,
        line: lineNum,
        propType: propTypeStr,
        last5Avg: stats.last5Avg,
        observedStdDev: stats.observedStdDev,
      },
      { signals: stats.stability, isCombo }
    );
    const pOverB = trackBResult.probability;
    const pSideRawB = isUnder ? 1 - pOverB : pOverB;
    const clampedPSideRawB = Math.max(0, Math.min(1, pSideRawB));

    // Calibration
    const pCalB = calibrateProbability(clampedPSideRawB, propTypeStr, 'trackB');

    // Read calibration params for this prop type
    const calArtifacts = require('../lib/betting/ev-calibration-artifacts.json');
    const key = propTypeStr.toLowerCase().trim();
    const calParams = calArtifacts.tracks.trackB[key] ?? calArtifacts.tracks.trackB.default;

    // Anchoring (odds-aware, capped)
    const BASE_ANCHOR_BUDGET = 0.08;
    const MIN_ANCHOR_GAP = 0.02;
    const MAX_ANCHOR_GAP = 0.10;
    const rawGap = BASE_ANCHOR_BUDGET / Math.max(oddsDecimal - 1, 0.1);
    const effectiveGap = Math.max(MIN_ANCHOR_GAP, Math.min(MAX_ANCHOR_GAP, rawGap));
    const lo = Math.max(0, marketProb - effectiveGap);
    const hi = Math.min(1, marketProb + effectiveGap);
    const pAnchB = Math.max(lo, Math.min(hi, pCalB));
    const anchorDelta = Math.abs(pAnchB - pCalB);

    // EV calculations
    const evRaw = clampedPSideRawB * oddsDecimal - 1;
    const evCal = pCalB * oddsDecimal - 1;
    const evAnch = pAnchB * oddsDecimal - 1;

    diagnostics.push({
      playerName: r.player_name,
      propType: propTypeStr,
      side: r.side,
      line: lineNum,
      oddsAmerican: r.odds_american,
      oddsDecimal,
      marketImpliedProb: marketProb,
      last10Avg: stats.last10Avg,
      last5Avg: stats.last5Avg,
      seasonAvg: stats.seasonAvg,
      observedStdDev: stats.observedStdDev,
      fallbackStdDev: fallbackStd,
      baseProjection,
      pOverBaseline: baselineResult.probability,
      pSideBaseline,
      trackBProjection: trackBResult.projection,
      pOverTrackB: pOverB,
      pSideRawB: clampedPSideRawB,
      sigmaEffective: trackBResult.sigmaEffective ?? null,
      pCalB,
      calSlope: calParams.slope,
      calIntercept: calParams.intercept,
      pAnchB,
      anchorApplied: anchorDelta > 1e-5,
      anchorDelta,
      evTrackBRaw: evRaw,
      evTrackBCalibrated: evCal,
      evTrackBAnchored: evAnch,
      confidenceTier: null,
      sampleGamesUsed: stats.stability.sampleGamesUsed,
    });
  }

  // Sort by absolute EV to find extremes
  diagnostics.sort((a, b) => Math.abs(b.evTrackBAnchored) - Math.abs(a.evTrackBAnchored));

  // Output the top 15 most extreme
  const extremes = diagnostics.slice(0, 15);
  
  // Also get EV distribution
  const evVals = diagnostics.map(d => d.evTrackBAnchored).filter(v => Number.isFinite(v));
  const evAbsVals = evVals.map(Math.abs);
  const maxEv = Math.max(...evVals);
  const minEv = Math.min(...evVals);
  const avgAbsEv = evAbsVals.reduce((a, b) => a + b, 0) / evAbsVals.length;
  
  const buckets = {
    'EV > 50%': evVals.filter(v => v > 0.5).length,
    'EV 20-50%': evVals.filter(v => v > 0.2 && v <= 0.5).length,
    'EV 10-20%': evVals.filter(v => v > 0.1 && v <= 0.2).length,
    'EV 5-10%': evVals.filter(v => v > 0.05 && v <= 0.1).length,
    'EV 0-5%': evVals.filter(v => v >= 0 && v <= 0.05).length,
    'EV -5-0%': evVals.filter(v => v >= -0.05 && v < 0).length,
    'EV -10 to -5%': evVals.filter(v => v >= -0.1 && v < -0.05).length,
    'EV -20 to -10%': evVals.filter(v => v >= -0.2 && v < -0.1).length,
    'EV < -20%': evVals.filter(v => v < -0.2).length,
  };

  const output = {
    summary: {
      totalProps: diagnostics.length,
      maxEv: (maxEv * 100).toFixed(1) + '%',
      minEv: (minEv * 100).toFixed(1) + '%',
      avgAbsEv: (avgAbsEv * 100).toFixed(1) + '%',
      distribution: buckets,
    },
    extremeCases: extremes.map(d => ({
      player: d.playerName,
      prop: `${d.propType} ${d.side} ${d.line}`,
      odds: `${d.oddsAmerican} (${d.oddsDecimal.toFixed(2)})`,
      marketImpliedProb: (d.marketImpliedProb * 100).toFixed(1) + '%',
      inputs: {
        last10Avg: d.last10Avg?.toFixed(1),
        last5Avg: d.last5Avg?.toFixed(1),
        seasonAvg: d.seasonAvg?.toFixed(1),
        observedStdDev: d.observedStdDev?.toFixed(2),
        fallbackStdDev: d.fallbackStdDev,
        sigmaEffective: d.sigmaEffective?.toFixed(2),
        sampleGamesUsed: d.sampleGamesUsed,
      },
      projections: {
        baselineProjection: d.baseProjection.toFixed(1),
        trackBProjection: d.trackBProjection.toFixed(1),
        line: d.line,
        gapFromLine: (d.trackBProjection - d.line).toFixed(1),
      },
      probabilityLadder: {
        pOverTrackB: (d.pOverTrackB * 100).toFixed(1) + '%',
        pSideRawB: (d.pSideRawB * 100).toFixed(1) + '%',
        calibration: `slope=${d.calSlope.toFixed(3)}, intercept=${d.calIntercept.toFixed(3)}`,
        pCalB: (d.pCalB * 100).toFixed(1) + '%',
        anchorApplied: d.anchorApplied,
        anchorDelta: (d.anchorDelta * 100).toFixed(1) + '%',
        pAnchB: (d.pAnchB * 100).toFixed(1) + '%',
      },
      evLadder: {
        evRaw: (d.evTrackBRaw * 100).toFixed(1) + '%',
        evCalibrated: (d.evTrackBCalibrated * 100).toFixed(1) + '%',
        evAnchored: (d.evTrackBAnchored * 100).toFixed(1) + '%',
      },
    })),
  };

  fs.writeFileSync('ev-diagnostic.json', JSON.stringify(output, null, 2));
  console.log('Diagnostic written to ev-diagnostic.json');
}

main().catch(console.error);
