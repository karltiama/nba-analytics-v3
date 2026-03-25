export const BDL_BASE = 'https://api.balldontlie.io/v2';
export const DEFAULT_PREFERRED_VENDOR = 'draftkings';

export interface LambdaEnv {
  dbUrl: string;
  apiKey: string;
  preferredVendor: string;
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
  return {
    dbUrl: cleanUrl(dbUrl),
    apiKey,
    preferredVendor: process.env.PREFERRED_VENDOR || DEFAULT_PREFERRED_VENDOR,
  };
}
