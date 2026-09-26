/**
 * Live nightly ingestion season. This is not the Court Context model input season.
 * getAnalyticsSeason() / PINNED_ANALYTICS_SEASON must not read this variable.
 */

export class IngestionSeasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestionSeasonError';
  }
}

const FOUR_DIGIT_YEAR = /^\d{4}$/;

/** NBA season start years we will accept on a live ingestion run. */
export function requireLiveIngestionSeasonStartYear(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = (env.INGESTION_SEASON_START_YEAR ?? '').trim();
  if (!FOUR_DIGIT_YEAR.test(raw)) {
    throw new IngestionSeasonError(
      'INGESTION_SEASON_START_YEAR must be a four-digit season start year before live nightly ingestion. Refusing to fall back to 2025.'
    );
  }
  const year = Number(raw);
  if (year < 1946 || year > 2100) {
    throw new IngestionSeasonError(
      `INGESTION_SEASON_START_YEAR=${raw} is outside the accepted NBA season start range.`
    );
  }
  return year;
}
