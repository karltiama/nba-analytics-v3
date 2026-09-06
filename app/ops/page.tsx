import type { Metadata } from 'next';
import { getCachedPlatformHealth } from '@/lib/ops/platform-health';
import { PlatformHealthView } from './PlatformHealthView';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Data Platform Health',
  robots: { index: false, follow: false },
};

export default async function OpsHealthPage() {
  try {
    const report = await getCachedPlatformHealth();
    return <PlatformHealthView report={report} />;
  } catch {
    return (
      <main className="max-w-3xl mx-auto px-4 py-16 space-y-3">
        <h1 className="text-2xl font-bold text-white">Data Platform Health</h1>
        <p className="text-sm text-muted-foreground">
          Health report unavailable. Missing metrics are treated as UNKNOWN rather than a crash.
        </p>
      </main>
    );
  }
}
