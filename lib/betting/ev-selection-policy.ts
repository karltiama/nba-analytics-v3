export type EvTrack = 'baseline' | 'trackA_calibrated' | 'trackB_calibrated';

const DEFAULT_TRACK: EvTrack = 'baseline';

export function resolveEvTrack(): EvTrack {
  const raw = (process.env.EV_RANKING_TRACK ?? '').toLowerCase().trim();
  if (raw === 'tracka_calibrated' || raw === 'tracka' || raw === 'track_a_calibrated') return 'trackA_calibrated';
  if (raw === 'trackb_calibrated' || raw === 'trackb' || raw === 'track_b_calibrated') return 'trackB_calibrated';
  if (raw === 'baseline') return 'baseline';
  return DEFAULT_TRACK;
}
