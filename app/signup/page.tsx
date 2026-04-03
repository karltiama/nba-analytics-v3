import { Suspense } from 'react';
import { SignupClient } from './SignupClient';

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      }
    >
      <SignupClient />
    </Suspense>
  );
}
