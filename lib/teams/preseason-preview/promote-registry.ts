/**
 * Pure helpers for promoting preview drafts into the curated registry.
 */

export function upsertPreseasonRegistry(args: {
  registrySrc: string;
  stem: string;
  exportName: string;
}): string {
  let src = args.registrySrc.replace(/\r\n/g, '\n');
  const importLine = `import { ${args.exportName} } from './content/${args.stem}';`;

  if (!src.includes(importLine)) {
    const importRe =
      /^import \{ \w+PreseasonPreview \} from '\.\/content\/[^']+';\s*$/gm;
    const imports = [...src.matchAll(importRe)];
    if (imports.length > 0) {
      const last = imports[imports.length - 1]!;
      const insertAt = (last.index ?? 0) + last[0].length;
      src = `${src.slice(0, insertAt)}\n${importLine}${src.slice(insertAt)}`;
    } else {
      src = src.replace(
        /import type \{ TeamPreseasonPreviewContent \} from '\.\/types';\n/,
        (m) => `${m}${importLine}\n`
      );
    }
  }

  const arrayRe =
    /const PREVIEWS: TeamPreseasonPreviewContent\[\] = \[([\s\S]*?)\];/;
  const m = src.match(arrayRe);
  if (!m) {
    throw new Error('Could not find PREVIEWS array in registry.ts');
  }
  const inner = m[1] ?? '';
  if (!inner.includes(args.exportName)) {
    const trimmed = inner.replace(/\s+$/, '');
    const needsComma = trimmed.length > 0 && !trimmed.trimEnd().endsWith(',');
    const nextInner = `${trimmed}${needsComma ? ',' : ''}\n  ${args.exportName},\n`;
    src = src.replace(
      arrayRe,
      `const PREVIEWS: TeamPreseasonPreviewContent[] = [${nextInner}];`
    );
  }

  return src;
}

export function renderCuratedPreviewModule(args: {
  exportName: string;
  contentJson: string;
  displayName: string;
  season: string;
  slug: string;
}): string {
  return `import type { TeamPreseasonPreviewContent } from '../types';

/**
 * ${args.displayName} — ${args.season}–${String(Number(args.season) + 1).slice(-2)} Team Preseason Preview (curated editorial).
 * Promoted from content/preseason/${args.season}/${args.slug}.preview.draft.json
 * Structured lists + prose only. Snapshot metrics come from live prior-season data when available.
 */
export const ${args.exportName}: TeamPreseasonPreviewContent = ${args.contentJson};
`;
}
