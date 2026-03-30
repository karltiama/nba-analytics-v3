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
    preferredVendor: process.env.PREFERRED_VENDOR || DEFAULT_PREFERRED_VENDOR,
    storePropRawJson: (process.env.STORE_PROP_RAW_JSON || 'false').toLowerCase() === 'true',
    propRawJsonSampleRate: rawJsonSampleRate,
  };
}
