import { Suspense } from 'react';
import type { Metadata } from 'next';
import { WelcomeClient } from './WelcomeClient';

export const metadata: Metadata = {
  title: 'Set up Court Context',
};

export default function WelcomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f7f9f7] flex items-center justify-center text-[#4a6366] text-sm">
          Loading…
        </div>
      }
    >
      <WelcomeClient />
    </Suspense>
  );
}
