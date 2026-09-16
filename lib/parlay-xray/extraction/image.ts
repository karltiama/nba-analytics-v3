import { createHash } from 'node:crypto';
import { XRAY_ALLOWED_MIME } from '@/lib/parlay-xray/types';

export type ImageGeometry = {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
};

export type ImageValidationOk = {
  ok: true;
  mime: ImageGeometry['mime'];
  width: number;
  height: number;
  originalBytes: number;
  normalizedBytes: number;
  originalWidth: number;
  originalHeight: number;
  normalizedWidth: number;
  normalizedHeight: number;
  bytes: Buffer;
  sha256: string;
};

export type ImageValidationFail = {
  ok: false;
  code: 'unsupported_file' | 'file_too_large' | 'unreadable_screenshot';
};

const ALLOWED = new Set<string>(XRAY_ALLOWED_MIME);

function u32be(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset);
}

function readPng(buf: Buffer): ImageGeometry | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = u32be(buf, 16);
  const height = u32be(buf, 20);
  if (width < 1 || height < 1) return null;
  return { mime: 'image/png', width, height };
}

function readJpeg(buf: Buffer): ImageGeometry | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const size = buf.readUInt16BE(i + 2);
    if (size < 2) return null;
    // SOF0 / SOF1 / SOF2
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      if (width < 1 || height < 1) return null;
      return { mime: 'image/jpeg', width, height };
    }
    i += 2 + size;
  }
  return null;
}

function readWebp(buf: Buffer): ImageGeometry | null {
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    if (buf.length < 30) return null;
    const width = 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16);
    const height = 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16);
    if (width < 1 || height < 1) return null;
    return { mime: 'image/webp', width, height };
  }
  if (kind === 'VP8 ' && buf.length >= 30) {
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    if (width < 1 || height < 1) return null;
    return { mime: 'image/webp', width, height };
  }
  if (kind === 'VP8L' && buf.length >= 25) {
    const bits = buf.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { mime: 'image/webp', width, height };
  }
  return null;
}

export function readImageGeometry(buf: Buffer): ImageGeometry | null {
  return readPng(buf) ?? readJpeg(buf) ?? readWebp(buf);
}

export function looksLikePdf(buf: Buffer): boolean {
  return buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF';
}

/**
 * v1 normalization: validate and pass through. Do not re-encode (avoids extra
 * lossy passes). Oversized long-edge or byte-size images are rejected before
 * any provider call rather than downscaled with an extra dependency.
 */
export function validateAndNormalizeScreenshot(
  bytes: Buffer,
  declaredMime: string,
  limits: { maxBytes: number; maxLongEdge: number }
): ImageValidationOk | ImageValidationFail {
  if (bytes.length <= 0) {
    return { ok: false, code: 'unsupported_file' };
  }
  if (bytes.length > limits.maxBytes) {
    return { ok: false, code: 'file_too_large' };
  }
  if (looksLikePdf(bytes)) {
    return { ok: false, code: 'unsupported_file' };
  }

  const geometry = readImageGeometry(bytes);
  if (!geometry) {
    return { ok: false, code: 'unreadable_screenshot' };
  }
  if (declaredMime && !ALLOWED.has(declaredMime) && declaredMime !== 'application/octet-stream') {
    return { ok: false, code: 'unsupported_file' };
  }
  if (declaredMime && ALLOWED.has(declaredMime) && declaredMime !== geometry.mime) {
    return { ok: false, code: 'unsupported_file' };
  }

  const longEdge = Math.max(geometry.width, geometry.height);
  if (longEdge > limits.maxLongEdge) {
    return { ok: false, code: 'file_too_large' };
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    ok: true,
    mime: geometry.mime,
    width: geometry.width,
    height: geometry.height,
    originalBytes: bytes.length,
    normalizedBytes: bytes.length,
    originalWidth: geometry.width,
    originalHeight: geometry.height,
    normalizedWidth: geometry.width,
    normalizedHeight: geometry.height,
    bytes,
    sha256,
  };
}

export function toDataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
