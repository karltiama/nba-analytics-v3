export class CompressedObjectTooLargeError extends Error {
  constructor() {
    super('archive_too_large');
    this.name = 'CompressedObjectTooLargeError';
  }
}

type ObjectBody = {
  transformToWebStream?: () => ReadableStream<Uint8Array>;
  transformToByteArray?: () => Promise<Uint8Array>;
};

function finiteLength(contentLength: number | null | undefined): number | null {
  if (typeof contentLength !== 'number' || !Number.isFinite(contentLength)) return null;
  return contentLength;
}

/**
 * Reads an object without trusting ContentLength as the end of the body.
 * A declared length over the cap fails before the stream is read. A missing
 * or low length still counts bytes and fails closed instead of truncating.
 */
export async function collectBoundedBytes(
  body: ObjectBody,
  contentLength: number | null | undefined,
  maxCompressedBytes: number,
): Promise<Buffer> {
  const declared = finiteLength(contentLength);
  if (declared != null && declared > maxCompressedBytes) {
    throw new CompressedObjectTooLargeError();
  }
  if (body.transformToWebStream) {
    const reader = body.transformToWebStream().getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        total += step.value.byteLength;
        if (total > maxCompressedBytes) {
          throw new CompressedObjectTooLargeError();
        }
        chunks.push(step.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }
  if (body.transformToByteArray) {
    const bytes = Buffer.from(await body.transformToByteArray());
    if (bytes.length > maxCompressedBytes) throw new CompressedObjectTooLargeError();
    return bytes;
  }
  throw new Error('archive_unavailable');
}
