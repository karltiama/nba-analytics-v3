import { describe, expect, it } from 'vitest';
import { upsertPreseasonRegistry } from '../promote-registry';

describe('upsertPreseasonRegistry', () => {
  it('adds import + PREVIEWS entry once', () => {
    const fixture = `import type { TeamPreseasonPreviewContent } from './types';
import { detroitPreseasonPreview } from './content/detroit';
import { bostonPreseasonPreview } from './content/boston';

const PREVIEWS: TeamPreseasonPreviewContent[] = [
  detroitPreseasonPreview,
  bostonPreseasonPreview,
];
`;
    const once = upsertPreseasonRegistry({
      registrySrc: fixture,
      stem: 'charlotte',
      exportName: 'charlottePreseasonPreview',
    });
    expect(once).toContain(
      "import { charlottePreseasonPreview } from './content/charlotte';"
    );
    expect(once).toContain('charlottePreseasonPreview,');

    const twice = upsertPreseasonRegistry({
      registrySrc: once,
      stem: 'charlotte',
      exportName: 'charlottePreseasonPreview',
    });
    expect((twice.match(/from '\.\/content\/charlotte'/g) ?? []).length).toBe(
      1
    );
  });
});
