import { createHash } from 'crypto';
import artifacts from '@/lib/betting/ev-calibration-artifacts.json';
import { getStdDev } from '@/lib/betting/player-prop-model';
import { LEDGER_MARKETS } from '@/lib/betting/projection-ledger/protocol';
import { COMBO_SIGMA_MULT, W_L5_MAX } from '@/lib/betting/track-b1-policy';

/** Hash of the constants the production functions actually read. Not a learned artifact. */
export function projectionConfigFingerprint(): string {
  const payload = {
    formula: '0.7 * last10Avg + 0.3 * seasonAvg',
    servingBlend: 'trackB.1',
    wL5Max: W_L5_MAX,
    comboSigmaMultiplier: COMBO_SIGMA_MULT,
    stdByMarket: LEDGER_MARKETS.map((market) => [market, getStdDev(market)]),
    calibration: artifacts,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
