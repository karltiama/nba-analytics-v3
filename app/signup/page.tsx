import { Suspense } from 'react';
import { SignupClient } from './SignupClient';

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f7f9f7] flex items-center justify-center text-[#4a6366] text-sm">
          Loading…
        </div>
      }
    >
      <SignupClient />
    </Suspense>
  );
}
