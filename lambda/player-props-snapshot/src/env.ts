export const BDL_BASE = 'https://api.balldontlie.io/v2';
export const DEFAULT_PREFERRED_VENDOR = 'draftkings';

export interface LambdaEnv {
  dbUrl: string;
  apiKey: string;
  preferredVendor: string;
  storePropRawJson: boolean;
  propRawJsonSampleRate: number;
}

function cleanUrl(raw: string): string {
  const value = raw.trim();
  if (!value.startsWith('postgresql://') && !value.startsWith('postgres://')) {
    throw new Error(`Invalid SUPABASE_DB_URL format: ${value.slice(0, 24)}...`);
  }
  return value;
}

export type RuntimeMode = {
  dataMode: string;
  offseason: boolean;
  cronDryRun: boolean;
  shouldSkipMutations: boolean;
};

/** Same skip rule as Vercel crons: dry-run, offseason, or non-live data mode. */
export function getRuntimeMode(): RuntimeMode {
  const dataMode = (process.env.DATA_MODE || 'live_api').trim().toLowerCase();
  const offseason = process.env.OFFSEASON_MODE === '1';
  const cronDryRun = process.env.CRON_DRY_RUN === '1';
  const shouldSkipMutations = cronDryRun || offseason || dataMode !== 'live_api';
  return { dataMode, offseason, cronDryRun, shouldSkipMutations };
}

export function getLambdaEnv(): LambdaEnv {
  const dbUrl = process.env.SUPABASE_DB_URL;
  const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY;
  if (!dbUrl) throw new Error('Missing SUPABASE_DB_URL');
  if (!apiKey) throw new Error('Missing BALLDONTLIE_API_KEY');
  const rawJsonSampleRateRaw = process.env.PROP_RAW_JSON_SAMPLE_RATE || '0';
  const rawJsonSampleRate = Number(rawJsonSampleRateRaw);
  if (!Number.isFinite(rawJsonSampleRate) || rawJsonSampleRate < 0 || rawJsonSampleRate > 1) {
    throw new Error(`Invalid PROP_RAW_JSON_SAMPLE_RATE: ${rawJsonSampleRateRaw}`);
  }

  return {
    dbUrl: cleanUrl(dbUrl),
    apiKey,
    preferredVendor: (process.env.PREFERRED_VENDOR || DEFAULT_PREFERRED_VENDOR).trim().toLowerCase(),
    storePropRawJson: (process.env.STORE_PROP_RAW_JSON || 'false').toLowerCase() === 'true',
    propRawJsonSampleRate: rawJsonSampleRate,
  };
}
