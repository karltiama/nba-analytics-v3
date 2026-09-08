import Link from 'next/link';

export default function BillingCancelPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-8 pb-16">
      <Link
        href="/billing"
        className="text-sm text-muted-foreground hover:text-white transition-colors inline-block mb-6"
      >
        ← Back to billing
      </Link>
      <h1 className="text-2xl font-bold text-white tracking-tight mb-3">Checkout canceled</h1>
      <p className="text-sm text-muted-foreground">
        No subscription change was made. You can return to billing whenever you want to upgrade.
      </p>
    </main>
  );
}
