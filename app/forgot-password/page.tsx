import { Suspense } from 'react';
import { ForgotPasswordClient } from './ForgotPasswordClient';

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f7f9f7] flex items-center justify-center text-[#4a6366] text-sm">
          Loading…
        </div>
      }
    >
      <ForgotPasswordClient />
    </Suspense>
  );
}
