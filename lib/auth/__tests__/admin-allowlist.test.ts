import { describe, expect, it } from 'vitest';
import { isAdminEmail, parseAdminEmails } from '@/lib/auth/admin-allowlist';

describe('parseAdminEmails', () => {
  it('returns empty when unset', () => {
    expect(parseAdminEmails({})).toEqual([]);
    expect(parseAdminEmails({ ADMIN_EMAILS: '' })).toEqual([]);
    expect(parseAdminEmails({ ADMIN_EMAILS: '  ,  ' })).toEqual([]);
  });

  it('accepts ADMIN_EMAIL as a singular alias', () => {
    expect(parseAdminEmails({ ADMIN_EMAIL: 'a@x.com' })).toEqual(['a@x.com']);
    expect(isAdminEmail('a@x.com', { ADMIN_EMAIL: 'a@x.com' })).toBe(true);
  });

  it('prefers ADMIN_EMAILS when both are set', () => {
    expect(parseAdminEmails({ ADMIN_EMAILS: 'a@x.com', ADMIN_EMAIL: 'b@x.com' })).toEqual(['a@x.com']);
  });

  it('trims, lowercases, and dedupes', () => {
    expect(parseAdminEmails({ ADMIN_EMAILS: 'A@X.com, a@x.com, b@x.com ' })).toEqual([
      'a@x.com',
      'b@x.com',
    ]);
  });
});

describe('isAdminEmail', () => {
  it('fails closed when the allowlist is empty', () => {
    expect(isAdminEmail('a@x.com', {})).toBe(false);
    expect(isAdminEmail('a@x.com', { ADMIN_EMAILS: '' })).toBe(false);
  });

  it('rejects missing email even when allowlist is set', () => {
    expect(isAdminEmail(null, { ADMIN_EMAILS: 'a@x.com' })).toBe(false);
    expect(isAdminEmail(undefined, { ADMIN_EMAILS: 'a@x.com' })).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(isAdminEmail('A@X.com', { ADMIN_EMAILS: 'a@x.com' })).toBe(true);
    expect(isAdminEmail('other@x.com', { ADMIN_EMAILS: 'a@x.com' })).toBe(false);
  });
});
