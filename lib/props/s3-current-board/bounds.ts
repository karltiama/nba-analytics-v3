/**
 * Read bounds shared by the website reader and the S3 publisher read-back.
 *
 * A repetitive 30,000-row board gzips to about 366 KB. That figure is not
 * the publisher maximum. The same row count with the documented field caps
 * and a distinct 512-byte raw_json on every row is about 34 MB of JSON and
 * about 12.9 MB gzipped. A diverse realistic provider shape is about 1.7 MB
 * gzipped. Both are over the historical 1,000,000-byte compressed cap.
 *
 * The compressed cap is 16 MiB, above that measured gzip with room for the
 * real envelope header. The decompressed cap stays 48 MiB, above the measured
 * 34 MB JSON. Larger objects fail closed. The historical 16 MB decompressed
 * cap still rejects these boards.
 */
export const CURRENT_BOARD_MAX_COMPRESSED_BYTES = 16 * 1024 * 1024;

export const CURRENT_BOARD_MAX_UNCOMPRESSED_BYTES = 48 * 1024 * 1024;

/**
 * Retained decompressed JSON bytes, not V8 heap size and not age.
 * A parsed envelope and its clone use more heap than this count.
 * A legal board larger than this is returned and not stored.
 * Observed boards are about 2.6 MB, so this holds about twelve of them.
 * A publisher-max board is about 34 MB of JSON, so it is served and not retained.
 */
export const CURRENT_BOARD_CACHE_MAX_DECODED_BYTES = 32 * 1024 * 1024;

export const CURRENT_BOARD_DECODE_LIMITS = {
  maxCompressedBytes: CURRENT_BOARD_MAX_COMPRESSED_BYTES,
  maxUncompressedBytes: CURRENT_BOARD_MAX_UNCOMPRESSED_BYTES,
} as const;
