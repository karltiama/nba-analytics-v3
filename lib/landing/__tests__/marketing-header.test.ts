import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');

describe('marketing header session', () => {
  it('keeps guests on Sign In / Get Started and sends signed-in users to the dashboard', () => {
    const src = readFileSync(join(ROOT, 'components/landing/MarketingHeader.tsx'), 'utf8');
    expect(src).toMatch(/getUser/);
    expect(src).toMatch(/href="\/login"/);
    expect(src).toMatch(/href="\/signup"/);
    expect(src).toMatch(/href="\/betting"/);
    expect(src).toMatch(/Dashboard/);
    expect(src).not.toMatch(/signOut/);
  });
});
