/**
 * Shared immutable raw-acquisition primitive (STEP 14D.DATA2A).
 * Not wired into any collector. S3 adapter lives in ./s3-store (kept out of
 * this barrel so importing the core does not pull in the AWS SDK).
 */

export * from './headers';
export * from './capture';
export * from './envelope';
export * from './keys';
export * from './archive';
export * from './ledger';
