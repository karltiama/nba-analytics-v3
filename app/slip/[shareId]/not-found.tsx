import Link from 'next/link';
import { MarketingHeader } from '@/components/landing/MarketingHeader';

export default function SharedSlipNotFound() {
  return (
    <div className="min-h-screen bg-[#F8FBFA] text-[#063f46]">
      <div className="relative">
        <MarketingHeader />
        <div className="h-20 sm:h-24" aria-hidden />
      </div>
      <div className="mx-auto w-full max-w-xl px-4 py-16 text-center sm:px-6">
        <p className="type-metadata uppercase tracking-wide text-[#4a6366]">Court Context</p>
        <h1 className="type-page-title mt-3 text-[#063f46]">Shared slip unavailable</h1>
        <p className="type-body mt-3 text-cc-secondary">
          This shared slip could not be found.
        </p>
        <Link
          href="/"
          className="type-interactive mt-8 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-4 text-white hover:opacity-90"
        >
          Back to Court Context
        </Link>
      </div>
    </div>
  );
}
