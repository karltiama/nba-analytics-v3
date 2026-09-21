/**
 * Pure helpers for promoting preview drafts into the curated registry.
 * Emitted modules follow Detroit/Boston hand-authored TS style.
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

/** Prefer single quotes; double quotes when the string contains an apostrophe (Detroit style). */
export function quoteTsString(s: string): string {
  if (s.includes("'") && !s.includes('"')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}"`;
  }
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

const LONG_VALUE_KEYS = new Set([
  'detail',
  'watching',
  'previousRole',
  'outlook',
  'dek',
  'context',
  'title',
]);

/** Detroit keeps player refs / bench slots on one line. */
function isInlineObject(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  if (keys.length === 0 || keys.length > 4) return false;
  if (keys.some((k) => LONG_VALUE_KEYS.has(k) || k === 'headline')) return false;
  return keys.every((k) => {
    const v = obj[k];
    if (v === null || typeof v === 'boolean' || typeof v === 'number') return true;
    if (typeof v === 'string') return v.length <= 48;
    return false;
  });
}

function formatProp(
  key: string,
  value: unknown,
  indent: number
): string {
  const pad = '  '.repeat(indent);
  const rendered = toTsObjectLiteral(value, indent, key);
  const wrapLong = typeof value === 'string' && value.length > 70;

  if (wrapLong) {
    return `${pad}${key}:\n${pad}  ${rendered},`;
  }
  return `${pad}${key}: ${rendered},`;
}

/**
 * Serialize preview content as Detroit/Boston-style TS object literal
 * (unquoted keys, Detroit quoting, trailing commas, compact player refs).
 */
export function toTsObjectLiteral(
  value: unknown,
  indent = 0,
  parentKey?: string
): string {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);

  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') return quoteTsString(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(
      (v) => `${padIn}${toTsObjectLiteral(v, indent + 1)},`
    );
    return `[\n${items.join('\n')}\n${pad}]`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';

    if (isInlineObject(obj)) {
      const inner = entries
        .map(([k, v]) => `${k}: ${toTsObjectLiteral(v, 0, k)}`)
        .join(', ');
      return `{ ${inner} }`;
    }

    // Top-level preview module: Detroit section blank lines
    if (indent === 0 && parentKey === undefined) {
      return formatTopLevelPreviewObject(obj);
    }

    const lines = entries.map(([k, v]) => formatProp(k, v, indent + 1));
    return `{\n${lines.join('\n')}\n${pad}}`;
  }

  return quoteTsString(String(value));
}

/** Stable Detroit field order + blank lines between sections. */
const TOP_LEVEL_ORDER = [
  'season',
  'slug',
  'teamId',
  'headline',
  'dek',
  'bigPicture',
  'keyQuestions',
  'additions',
  'departures',
  'draftPicks',
  'projectedRotation',
  'playersToWatch',
  'roleWatch',
  'wowyContext',
  'outlook',
  'snapshotNotes',
] as const;

const BLANK_AFTER = new Set([
  'teamId',
  'dek',
  'bigPicture',
  'keyQuestions',
  'additions',
  'departures',
  'draftPicks',
  'projectedRotation',
  'playersToWatch',
  'roleWatch',
  'wowyContext',
  'outlook',
]);

function formatTopLevelPreviewObject(obj: Record<string, unknown>): string {
  const orderedKeys = [
    ...TOP_LEVEL_ORDER.filter((k) => k in obj),
    ...Object.keys(obj).filter(
      (k) => !(TOP_LEVEL_ORDER as readonly string[]).includes(k)
    ),
  ];

  const chunks: string[] = [];
  for (const key of orderedKeys) {
    chunks.push(formatProp(key, obj[key], 1));
    if (BLANK_AFTER.has(key)) chunks.push('');
  }

  // Drop trailing blank line before closing brace
  while (chunks.length > 0 && chunks[chunks.length - 1] === '') {
    chunks.pop();
  }

  return `{\n${chunks.join('\n')}\n}`;
}

export function renderCuratedPreviewModule(args: {
  exportName: string;
  content: unknown;
  displayName: string;
  season: string;
}): string {
  const body = toTsObjectLiteral(args.content, 0);
  return `import type { TeamPreseasonPreviewContent } from '../types';

/**
 * ${args.displayName} — ${args.season}–${String(Number(args.season) + 1).slice(-2)} Team Preseason Preview (curated editorial).
 * Structured lists + prose only. Snapshot metrics come from live prior-season data when available.
 */
export const ${args.exportName}: TeamPreseasonPreviewContent = ${body};
`;
}
