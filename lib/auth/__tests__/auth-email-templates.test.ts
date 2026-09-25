import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

const confirm = read('emails/auth/confirm-signup.html');
const reset = read('emails/auth/reset-password.html');
const readme = read('emails/auth/README.md');
const pkg = read('package.json');

describe('auth email template source', () => {
  it('uses the Supabase confirmation URL and the existing callback contract', () => {
    for (const html of [confirm, reset]) {
      expect(html).toContain('{{ .ConfirmationURL }}');
      expect(html).not.toContain('{{ .TokenHash }}');
      expect(html).not.toContain('/auth/confirm');
    }
    expect(readme).toContain('/auth/callback');
    expect(readme).toContain('{{ .ConfirmationURL }}');
  });

  it('keeps confirmation and reset copy transactional', () => {
    expect(confirm).toContain('Court Context');
    expect(confirm).toContain('Confirm email');
    expect(confirm).toMatch(/If you didn'?t create a Court Context account/);
    expect(reset).toContain('Reset password');
    expect(reset).toMatch(/Didn'?t request this\?|If you did not request a password reset/);
    expect(reset).toContain('cannot see or change your password');
    expect(reset).toMatch(/password stays the same|Your password will stay the same/);
    for (const html of [confirm, reset, readme]) {
      expect(html.toLowerCase()).not.toMatch(/\blocks\b|guaranteed win|betting win/);
      expect(html).not.toMatch(/re_[A-Za-z0-9]{8,}|service_role|sb_secret_/);
    }
  });

  it('does not add the Resend SDK for Supabase SMTP', () => {
    expect(pkg).not.toMatch(/"resend"/);
  });
});
