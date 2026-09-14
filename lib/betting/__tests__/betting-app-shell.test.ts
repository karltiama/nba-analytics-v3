import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

describe('BettingAppShell hydration', () => {
  it('keeps Header outside the OnboardingGate Suspense fallback', () => {
    const src = readFileSync(join(ROOT, 'components/betting/BettingAppShell.tsx'), 'utf8');
    expect(src).toMatch(/<Header/);
    expect(src).toMatch(/<OnboardingGate/);
    expect(src).toMatch(/<Suspense fallback=\{null\}>/);
    expect(src).not.toMatch(/fallback=\{renderShell/);
    expect(src).not.toMatch(/OnboardingGate>\{/);
    const headerIdx = src.indexOf('<Header');
    const suspenseIdx = src.indexOf('<Suspense');
    expect(headerIdx).toBeGreaterThan(-1);
    expect(suspenseIdx).toBeGreaterThan(headerIdx);
  });
});
