import artifacts from './ev-calibration-artifacts.json';

type Track = 'trackA' | 'trackB';

interface LinearCal {
  slope: number;
  intercept: number;
}

interface TrackArtifact {
  default: LinearCal;
  [propType: string]: LinearCal;
}

interface ArtifactRoot {
  version: string;
  tracks: Record<Track, TrackArtifact>;
}

const model = artifacts as ArtifactRoot;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function normalizePropType(propType: string): string {
  return (propType ?? '').toLowerCase().trim();
}

export function calibrateProbability(
  rawProbability: number,
  propType: string,
  track: Track
): number {
  const t = model.tracks[track];
  const key = normalizePropType(propType);
  const params = t[key] ?? t.default;
  const p = params.slope * clamp01(rawProbability) + params.intercept;
  return clamp01(p);
}

export function getCalibrationVersion(): string {
  return model.version;
}
