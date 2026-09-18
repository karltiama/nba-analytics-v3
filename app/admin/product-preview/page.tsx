import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdminPage } from '@/lib/auth/require-admin';
import { ProductPreviewHub } from '@/components/admin/product-preview/ProductPreviewHub';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Product Preview',
  description: 'Internal deterministic preview hub for Court Context parlay surfaces.',
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
      <p className="text-xs uppercase tracking-[0.2em] text-[#8aa0a3]">Internal · admin</p>
      <h1 className="text-2xl font-bold text-[#063f46]">Forbidden</h1>
      {reason === 'allowlist_empty' ? (
        <p className="text-sm text-[#4a6366]">
          The admin allowlist is empty. Set <code className="text-[#063f46]">ADMIN_EMAILS</code> to
          your login email, then restart the dev server.
        </p>
      ) : (
        <p className="text-sm text-[#4a6366]">
          Signed in as {email ?? 'an account with no email'} — that address is not on{' '}
          <code className="text-[#063f46]">ADMIN_EMAILS</code>.
        </p>
      )}
    </main>
  );
}

export default async function ProductPreviewPage() {
  const auth = await requireAdminPage();
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') {
      redirect('/login?next=%2Fadmin%2Fproduct-preview');
    }
    return <Forbidden reason={auth.reason} email={auth.email} />;
  }

  return <ProductPreviewHub />;
}
