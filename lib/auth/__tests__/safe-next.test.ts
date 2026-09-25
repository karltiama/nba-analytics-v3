import { describe, expect, it } from 'vitest';
import { AUTHENTICATED_HOME, safeInternalPath } from '@/lib/auth/safe-next';

describe('safeInternalPath', () => {
  it('accepts an internal path', () => {
    expect(safeInternalPath('/betting/props-explorer', AUTHENTICATED_HOME)).toBe(
      '/betting/props-explorer'
    );
  });

  it('keeps a date query that contains a colon', () => {
    expect(
      safeInternalPath('/betting/props-explorer?date=2026-09-24', AUTHENTICATED_HOME)
    ).toBe('/betting/props-explorer?date=2026-09-24');
  });

  it('rejects an absolute external URL', () => {
    expect(safeInternalPath('https://evil.example', AUTHENTICATED_HOME)).toBe(AUTHENTICATED_HOME);
  });

  it('rejects a protocol-relative URL', () => {
    expect(safeInternalPath('//evil.example', AUTHENTICATED_HOME)).toBe(AUTHENTICATED_HOME);
  });

  it('rejects javascript and data URLs', () => {
    expect(safeInternalPath('javascript:alert(1)', AUTHENTICATED_HOME)).toBe(AUTHENTICATED_HOME);
    expect(safeInternalPath('data:text/html,hi', AUTHENTICATED_HOME)).toBe(AUTHENTICATED_HOME);
    expect(safeInternalPath('/javascript:alert(1)', AUTHENTICATED_HOME)).toBe(AUTHENTICATED_HOME);
  });

  it('falls back when the value is malformed', () => {
    expect(safeInternalPath('dashboard', AUTHENTICATED_HOME)).toBe(AUTHENTICATED_HOME);
    expect(safeInternalPath('/foo\\bar', AUTHENTICATED_HOME)).toBe(AUTHENTICATED_HOME);
    expect(safeInternalPath(null, AUTHENTICATED_HOME)).toBe(AUTHENTICATED_HOME);
  });
});
