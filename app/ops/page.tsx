import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { requireAdminPage } from '@/lib/auth/require-admin';
import { getCachedPlatformHealth } from '@/lib/ops/platform-health';
import { PlatformHealthView } from './PlatformHealthView';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Data Platform Health',
  robots: { index: false, follow: false },
};

export default async function OpsHealthPage() {
  const auth = await requireAdminPage();
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') {
      redirect('/login?next=%2Fops');
    }
    return <AdminForbidden reason={auth.reason} email={auth.email} />;
  }

  const loaded = await getCachedPlatformHealth().then(
    (report) => ({ ok: true as const, report }),
    () => ({ ok: false as const })
  );
  if (!loaded.ok) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-16 space-y-3">
        <h1 className="text-2xl font-bold text-white">Data Platform Health</h1>
        <p className="text-sm text-muted-foreground">
          Health report unavailable. Missing metrics are treated as UNKNOWN rather than a crash.
        </p>
      </main>
    );
  }

  return <PlatformHealthView report={loaded.report} />;
}
