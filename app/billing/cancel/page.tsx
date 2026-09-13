import Link from 'next/link';

export default function BillingCancelPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-8 pb-16">
      <Link
        href="/billing"
        className="text-sm text-[#075B5C] hover:underline inline-block mb-6"
      >
        ← Back to billing
      </Link>
      <h1 className="text-2xl font-bold text-[#063f46] tracking-tight mb-3">Checkout canceled</h1>
      <p className="text-sm text-[#4a6366]">
        No subscription change was made. You can return to billing whenever you want to upgrade.
      </p>
    </main>
  );
}
