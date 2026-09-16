import { describe, expect, it } from 'vitest';
import { loadXrayExtractionConfig } from '../config';
import { looksLikePdf, readImageGeometry, validateAndNormalizeScreenshot } from '../image';
import { MIN_PNG } from './fixtures';

describe('xray image validation', () => {
  it('reads a real png and pass-through normalizes', () => {
    const geometry = readImageGeometry(MIN_PNG);
    expect(geometry).toEqual({ mime: 'image/png', width: 1, height: 1 });
    const ok = validateAndNormalizeScreenshot(MIN_PNG, 'image/png', {
      maxBytes: 10_000,
      maxLongEdge: 4096,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.normalizedBytes).toBe(ok.originalBytes);
    expect(ok.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects pdf, empty, oversized bytes, and corrupt buffers before any hash identity is used for spend', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.4'))).toBe(true);
    expect(
      validateAndNormalizeScreenshot(Buffer.from('%PDF-1.4'), 'application/pdf', {
        maxBytes: 1000,
        maxLongEdge: 4096,
      }).ok
    ).toBe(false);
    expect(
      validateAndNormalizeScreenshot(Buffer.alloc(0), 'image/png', { maxBytes: 1000, maxLongEdge: 4096 })
    ).toEqual({ ok: false, code: 'unsupported_file' });
    expect(
      validateAndNormalizeScreenshot(Buffer.alloc(50), 'image/png', { maxBytes: 40, maxLongEdge: 4096 })
    ).toEqual({ ok: false, code: 'file_too_large' });
    expect(
      validateAndNormalizeScreenshot(Buffer.from([0, 1, 2, 3, 4, 5]), 'image/png', {
        maxBytes: 1000,
        maxLongEdge: 4096,
      })
    ).toEqual({ ok: false, code: 'unreadable_screenshot' });
  });

  it('rejects an oversized long edge without sending bytes to a provider', () => {
    const huge = Buffer.from(MIN_PNG);
    huge.writeUInt32BE(9000, 16);
    huge.writeUInt32BE(100, 20);
    expect(
      validateAndNormalizeScreenshot(huge, 'image/png', { maxBytes: 10_000, maxLongEdge: 4096 })
    ).toEqual({ ok: false, code: 'file_too_large' });
  });
});

describe('kill switch config', () => {
  it('treats missing PARLAY_XRAY_EXTRACTION_ENABLED as false', () => {
    const config = loadXrayExtractionConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(false);
    expect(config.visionModel).toBe('gpt-4o-mini');
    expect(config.visionDetail).toBe('low');
    expect(config.extractionVersion).toBe('xray-extract-v2.1');
    expect(config.schemaVersion).toBe('xray-legs-v2');
    expect(config.freeDailyLimit).toBe(3);
    expect(config.proDailyLimit).toBe(10);
    expect(config.globalDailyLimit).toBe(100);
  });
});
