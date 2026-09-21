import { describe, expect, it } from 'vitest';
import {
  quoteTsString,
  renderCuratedPreviewModule,
  toTsObjectLiteral,
  upsertPreseasonRegistry,
} from '../promote-registry';

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

describe('Detroit-style promote formatting', () => {
  it('quotes like Detroit (double when apostrophe present)', () => {
    expect(quoteTsString('Cade')).toBe("'Cade'");
    expect(quoteTsString("Duren's deal")).toBe('"Duren\'s deal"'.replace("\\'", "'"));
    expect(quoteTsString("Duren's deal")).toBe(`"Duren's deal"`);
  });

  it('inlines compact player refs', () => {
    const out = toTsObjectLiteral({
      player: { name: 'Cade Cunningham', nbaPlayerId: '1630595' },
    });
    expect(out).toContain(
      "player: { name: 'Cade Cunningham', nbaPlayerId: '1630595' },"
    );
  });

  it('emits section blank lines and no JSON keys', () => {
    const mod = renderCuratedPreviewModule({
      exportName: 'charlottePreseasonPreview',
      displayName: 'Charlotte Hornets',
      season: '2026',
      content: {
        season: '2026',
        slug: 'CHA',
        teamId: '4',
        headline: 'Charlotte Hornets',
        dek: 'Short dek.',
        bigPicture: ['Paragraph one.'],
        keyQuestions: [
          {
            headline: "Does Coby White's usage change?",
            detail:
              'A long detail line that should wrap below the key because it is lengthy enough for Detroit-style wrapping in curated modules.',
          },
        ],
        additions: [
          {
            name: 'Grayson Allen',
            nbaPlayerId: '1628960',
            position: 'Guard',
            context: 'Sharpshooting',
          },
        ],
        departures: [],
        draftPicks: [],
        projectedRotation: {
          starters: {
            PG: { name: 'Coby White', nbaPlayerId: '1629632' },
          },
          keyBench: [
            { name: 'Grayson Allen', nbaPlayerId: '1628960', position: 'G' },
          ],
        },
        playersToWatch: [],
        roleWatch: [
          {
            player: { name: 'Coby White', nbaPlayerId: '1629632' },
            previousRole: 'Primary creator',
            watch: 'Stable',
          },
        ],
        wowyContext: [],
        outlook: 'Outlook sentence.',
        snapshotNotes: { playoffResult: null },
      },
    });

    expect(mod).toContain("season: '2026',");
    expect(mod).toContain("teamId: '4',\n\n  headline:");
    expect(mod).toContain("dek: 'Short dek.',\n\n  bigPicture:");
    expect(mod).not.toContain('"season"');
    expect(mod).toContain("PG: { name: 'Coby White', nbaPlayerId: '1629632' },");
    expect(mod).toContain(
      "{ name: 'Grayson Allen', nbaPlayerId: '1628960', position: 'G' },"
    );
    expect(mod).toContain('detail:\n');
    expect(mod).toContain("headline: \"Does Coby White's usage change?\"");
  });
});
