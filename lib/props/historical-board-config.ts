/**
 * The archive is off until HISTORICAL_BOARD_ARCHIVE is set to "local" or "s3".
 * A directory or bucket name alone does not enable it.
 */
export const HISTORICAL_BOARD_BUCKET = 'nba-analytics-data-260029269390';
export const HISTORICAL_BOARD_REGION = 'us-east-1';

export type HistoricalBoardSource =
  | { mode: 'off' }
  | { mode: 'local'; directory: string }
  | { mode: 's3'; bucket: typeof HISTORICAL_BOARD_BUCKET; region: typeof HISTORICAL_BOARD_REGION };

export function historicalBoardSourceFromEnv(
  env: { [name: string]: string | undefined } = process.env
): HistoricalBoardSource {
  const mode = (env.HISTORICAL_BOARD_ARCHIVE ?? '').trim().toLowerCase();
  if (mode === '' || mode === 'off' || mode === '0' || mode === 'false') return { mode: 'off' };
  if (mode === 'local') {
    const directory = (env.HISTORICAL_BOARD_ARCHIVE_DIR ?? '').trim();
    if (!directory) throw new Error('archive_config_rejected');
    return { mode: 'local', directory };
  }
  if (mode === 's3') {
    const bucket = (env.HISTORICAL_BOARD_S3_BUCKET ?? HISTORICAL_BOARD_BUCKET).trim();
    const region = (env.AWS_REGION ?? HISTORICAL_BOARD_REGION).trim();
    if (bucket !== HISTORICAL_BOARD_BUCKET || region !== HISTORICAL_BOARD_REGION) {
      throw new Error('archive_config_rejected');
    }
    return { mode: 's3', bucket: HISTORICAL_BOARD_BUCKET, region: HISTORICAL_BOARD_REGION };
  }
  throw new Error('archive_config_rejected');
}

/** Current dates and a disabled archive never open S3 or the local directory. */
export function shouldReadHistoricalBoard(source: HistoricalBoardSource, date: string, todayEt: string): boolean {
  return source.mode !== 'off' && date < todayEt;
}
