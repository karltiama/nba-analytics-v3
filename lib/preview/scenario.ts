/**
 * Court Context UI preview scenarios.
 * One `?preview=` value. Existing historical/replay/design flags stay separate.
 */

export const PREVIEW_SCENARIOS = [
  'default',
  'mobile-dense',
  'empty',
  'partial',
  'error',
] as const;

export type PreviewScenario = (typeof PREVIEW_SCENARIOS)[number];

const SCENARIO_SET: ReadonlySet<string> = new Set(PREVIEW_SCENARIOS);

export function parsePreviewScenario(
  flag: string | null | undefined
): PreviewScenario | null {
  if (!flag) return null;
  return SCENARIO_SET.has(flag) ? (flag as PreviewScenario) : null;
}

export function previewScenarioLabel(scenario: PreviewScenario): string {
  switch (scenario) {
    case 'default':
      return 'DEFAULT';
    case 'mobile-dense':
      return 'MOBILE DENSE';
    case 'empty':
      return 'EMPTY';
    case 'partial':
      return 'PARTIAL';
    case 'error':
      return 'ERROR';
  }
}

export function previewHref(path: string, scenario: PreviewScenario): string {
  const [pathname, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('preview', scenario);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
