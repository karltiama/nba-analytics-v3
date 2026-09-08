import type { Metadata } from 'next';
import { ContextCheckStudio } from '@/components/content/context-check/ContextCheckStudio';

export const metadata: Metadata = {
  title: 'Context Check Studio',
  description: 'Internal editorial studio for Court Context Context Checks.',
  robots: { index: false, follow: false },
};

export default function ContextCheckStudioPage() {
  return (
    <main className="min-h-screen bg-background gradient-mesh">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Internal · editorial studio · not indexed
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-white">Context Check Studio</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Build and preview Context Checks from mock candidates or a manual claim. The card is
            presentation-only: every path normalizes into ContextCheckData. Publishing is not enabled
            in v1.
          </p>
        </header>
        <ContextCheckStudio />
      </div>
    </main>
  );
}
