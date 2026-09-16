import {
  XRAY_ALLOWED_EXTENSIONS,
  XRAY_ALLOWED_MIME,
  XRAY_MAX_UPLOAD_BYTES,
  type UploadErrorCode,
} from './types';

export type UploadValidation =
  | { ok: true; mimeType: string }
  | { ok: false; code: Extract<UploadErrorCode, 'unsupported_file' | 'file_too_large'> };

const MIME_SET = new Set<string>(XRAY_ALLOWED_MIME);
const EXT_SET = new Set<string>(XRAY_ALLOWED_EXTENSIONS);

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i).toLowerCase() : '';
}

function inferredMime(file: { name: string; type: string }): string | null {
  if (MIME_SET.has(file.type)) return file.type;
  const ext = extensionOf(file.name);
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return null;
}

export function validateParlayScreenshot(file: { name: string; type: string; size: number }): UploadValidation {
  const ext = extensionOf(file.name);
  const mime = inferredMime(file);
  const typeOk = Boolean(mime) && (MIME_SET.has(file.type) || EXT_SET.has(ext));
  if (!typeOk || !mime) {
    return { ok: false, code: 'unsupported_file' };
  }
  if (file.size <= 0 || file.size > XRAY_MAX_UPLOAD_BYTES) {
    return { ok: false, code: file.size > XRAY_MAX_UPLOAD_BYTES ? 'file_too_large' : 'unsupported_file' };
  }
  return { ok: true, mimeType: mime };
}

export function displayFilename(name: string): string {
  const base = name.replace(/^.*[/\\]/, '').trim();
  if (!base) return 'screenshot';
  return base.length > 48 ? `${base.slice(0, 40)}…${base.slice(-6)}` : base;
}
