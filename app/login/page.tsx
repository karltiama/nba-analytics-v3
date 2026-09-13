import { Suspense } from 'react';
import { LoginClient } from './LoginClient';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f7f9f7] flex items-center justify-center text-[#4a6366] text-sm">
          Loading…
        </div>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
