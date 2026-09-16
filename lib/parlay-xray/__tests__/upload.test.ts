import { describe, expect, it } from 'vitest';
import { XRAY_MAX_UPLOAD_BYTES } from '../types';
import { displayFilename, validateParlayScreenshot } from '../upload';

function file(partial: { name?: string; type?: string; size?: number }) {
  return {
    name: partial.name ?? 'slip.png',
    type: partial.type ?? 'image/png',
    size: partial.size ?? 1200,
  };
}

describe('validateParlayScreenshot', () => {
  it('accepts png, jpeg, and webp', () => {
    expect(validateParlayScreenshot(file({ name: 'a.png', type: 'image/png' }))).toEqual({
      ok: true,
      mimeType: 'image/png',
    });
    expect(validateParlayScreenshot(file({ name: 'a.jpg', type: 'image/jpeg' }))).toEqual({
      ok: true,
      mimeType: 'image/jpeg',
    });
    expect(validateParlayScreenshot(file({ name: 'a.webp', type: 'image/webp' }))).toEqual({
      ok: true,
      mimeType: 'image/webp',
    });
  });

  it('infers jpeg from .jpg when mime is empty', () => {
    expect(validateParlayScreenshot(file({ name: 'slip.JPG', type: '', size: 800 }))).toEqual({
      ok: true,
      mimeType: 'image/jpeg',
    });
  });

  it('rejects pdf and other unsupported types', () => {
    expect(validateParlayScreenshot(file({ name: 'slip.pdf', type: 'application/pdf' }))).toEqual({
      ok: false,
      code: 'unsupported_file',
    });
    expect(validateParlayScreenshot(file({ name: 'slip.gif', type: 'image/gif' }))).toEqual({
      ok: false,
      code: 'unsupported_file',
    });
  });

  it('rejects files over 10 MB and empty files', () => {
    expect(
      validateParlayScreenshot(file({ size: XRAY_MAX_UPLOAD_BYTES + 1 }))
    ).toEqual({ ok: false, code: 'file_too_large' });
    expect(validateParlayScreenshot(file({ size: 0 }))).toEqual({ ok: false, code: 'unsupported_file' });
  });
});

describe('displayFilename', () => {
  it('strips path-like prefixes and does not expose directories', () => {
    expect(displayFilename('C:/Users/me/parlay-slip.png')).toBe('parlay-slip.png');
    expect(displayFilename('/tmp/secret/slip.png')).toBe('slip.png');
    expect(displayFilename('parlay-slip.png')).toBe('parlay-slip.png');
  });
});
