/**
 * The in-memory store models one-key conditional writes. It is not S3.
 * - The critical section is a synchronous Map update. S3 applies If-Match and
 *   If-None-Match atomically per key, and two requests can be in flight.
 * - A conflict is 412. Tests can force the next conflict to 409. S3 PutObject
 *   uses 412; some SDK wrappers surface 409. The publisher treats both as
 *   reread-and-recheck and does not write again on that attempt.
 * - The etag is the SHA-256 of the body. A single-part S3 ETag is the MD5,
 *   and user metadata is not part of it either way.
 * - There is no ListObjects, versioning, replication delay, or 403.
 * - User metadata keeps the supplied keys. S3 prefixes them with x-amz-meta-
 *   and lowercases them.
 */
export const IN_MEMORY_S3_DIFFERENCES = [
  'synchronous map instead of in-flight S3 requests',
  '412 by default, 409 only when a test forces it',
  'etag is sha256 of the body, not md5',
  'no list, versioning, replication delay, or 403',
  'metadata keys are not lowercased or prefixed',
] as const;
