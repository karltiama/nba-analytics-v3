import { loadXrayExtractionConfig, type XrayExtractionConfig } from './config';
import { createMemoryXrayStore } from './memory-store';
import { createPostgresXrayStore } from './postgres-store';
import { fetchXrayVisionFromOpenAi, type XrayVisionProvider } from './provider';
import type { XrayExtractionStore } from './store';

type Runtime = {
  config: XrayExtractionConfig;
  store: XrayExtractionStore;
  provider: XrayVisionProvider;
};

let injected: Partial<Runtime> | null = null;
let cachedStore: { kind: XrayExtractionConfig['store']; store: XrayExtractionStore } | null = null;

export function setXrayExtractionRuntimeForTests(runtime: Partial<Runtime>): void {
  injected = runtime;
}

export function resetXrayExtractionRuntimeForTests(): void {
  injected = null;
  cachedStore = null;
}

export async function getXrayRuntime(): Promise<Runtime> {
  const config = injected?.config ?? loadXrayExtractionConfig();
  const provider = injected?.provider ?? fetchXrayVisionFromOpenAi;
  if (injected?.store) {
    return { config, store: injected.store, provider };
  }

  if (cachedStore && cachedStore.kind === config.store) {
    return { config, store: cachedStore.store, provider };
  }

  let store: XrayExtractionStore;
  if (config.store === 'memory') {
    store = createMemoryXrayStore();
  } else {
    const db = await import('@/lib/db');
    store = createPostgresXrayStore(db.default);
  }
  cachedStore = { kind: config.store, store };
  return { config, store, provider };
}
