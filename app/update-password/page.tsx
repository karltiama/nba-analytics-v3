import { Suspense } from 'react';
import { UpdatePasswordClient } from './UpdatePasswordClient';

export default function UpdatePasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f7f9f7] flex items-center justify-center text-[#4a6366] text-sm">
          Loading…
        </div>
      }
    >
      <UpdatePasswordClient />
    </Suspense>
  );
}
