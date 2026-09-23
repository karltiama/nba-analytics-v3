import { parsePreviewScenario } from './scenario';
import { resolvePreviewRequest, type PreviewFetchInput } from './gateway';

let depth = 0;
let originalFetch: typeof window.fetch | null = null;

async function previewFetch(input: PreviewFetchInput, init?: RequestInit): Promise<Response> {
  const scenario = parsePreviewScenario(new URLSearchParams(window.location.search).get('preview'));
  const decision = await resolvePreviewRequest(input, init, scenario);
  if (decision.action === 'passthrough') {
    if (!originalFetch) {
      throw new Error('Preview fetch passthrough is unavailable.');
    }
    return originalFetch(input, init);
  }
  return new Response(JSON.stringify(decision.body), {
    status: decision.status,
    headers: {
      'content-type': 'application/json',
      'x-court-context-preview': '1',
    },
  });
}

/** Install only while a preview scenario is active. Cleanup restores fetch. */
export function installPreviewFetch(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if (depth === 0) {
    originalFetch = window.fetch.bind(window);
    window.fetch = previewFetch as typeof window.fetch;
  }
  depth += 1;
  return () => {
    depth -= 1;
    if (depth <= 0) {
      depth = 0;
      if (originalFetch) window.fetch = originalFetch;
      originalFetch = null;
    }
  };
}
