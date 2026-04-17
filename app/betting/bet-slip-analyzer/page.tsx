'use client';

import Link from 'next/link';

export default function BetSlipAnalyzerPage() {
  return (
    <main className="max-w-[900px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-12">
      <div className="mb-8">
        <p className="text-xs text-muted-foreground mb-1">
          <Link href="/betting" className="hover:text-[#00d4ff]">
            Dashboard
          </Link>
          <span className="mx-1">/</span>
          Bet slip analyzer
        </p>
        <h1 className="text-2xl font-bold text-white tracking-tight">Bet slip analyzer</h1>
      </div>

      <section className="rounded-xl border border-white/10 bg-secondary/20 p-5">
        <p className="text-sm text-muted-foreground">
          This feature has been moved out of the live product for now. We can reimplement it on a
          future branch when the experience is ready.
        </p>
      </section>
    </main>
  );
}
