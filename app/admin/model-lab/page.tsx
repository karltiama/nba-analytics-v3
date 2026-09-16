import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdminPage } from '@/lib/auth/require-admin';
import { loadCatalog } from '@/lib/model-lab/catalog';
import { loadModelLabStatus } from '@/lib/model-lab/status';
import { ModelLabApp } from '@/components/admin/model-lab/ModelLabApp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Model Lab',
  description: 'Private experiment workbench for Court Context projections.',
  robots: { index: false, follow: false },
};

function Forbidden({
  reason,
  email,
}: {
  reason: 'forbidden' | 'allowlist_empty';
  email: string | null;
}) {
  return (
    <main className="max-w-xl mx-auto px-4 py-16 space-y-3">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Internal · admin</p>
      <h1 className="text-2xl font-bold text-white">Forbidden</h1>
      {reason === 'allowlist_empty' ? (
        <p className="text-sm text-muted-foreground">
          The admin allowlist is empty. In <code className="text-white/80">.env</code> or{' '}
          <code className="text-white/80">.env.local</code> set{' '}
          <code className="text-white/80">ADMIN_EMAILS=your-login-email</code> (plural), then restart{' '}
          <code className="text-white/80">npm run dev</code>.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Signed in as {email ?? 'an account with no email'} — that address is not on{' '}
          <code className="text-white/80">ADMIN_EMAILS</code>. Use the same email you sign in with, then restart the
          dev server.
        </p>
      )}
    </main>
  );
}

export default async function ModelLabPage() {
  const auth = await requireAdminPage();
  if (!auth.ok && auth.reason === 'unauthenticated') {
    redirect('/login?next=%2Fadmin%2Fmodel-lab');
  }
  if (!auth.ok) return <Forbidden reason={auth.reason} email={auth.email} />;

  const catalog = loadCatalog();
  const status = await loadModelLabStatus();

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Internal · admin allowlist · not indexed
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-white">Model Lab</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Personal workbench for experiment history, honest comparisons, and what to investigate next. It does not
            train models, deploy shadow, or change production projections.
          </p>
        </header>
        <ModelLabApp catalog={catalog} status={status} />
      </div>
    </main>
  );
}
