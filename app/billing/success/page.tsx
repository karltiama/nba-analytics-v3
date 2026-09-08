'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

type BillingStatus = {
  plan: string;
  isPro: boolean;
  status: string;
};

type Phase = 'confirming' | 'pro' | 'incomplete' | 'error';

export default function BillingSuccessPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('confirming');

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    async function poll() {
      try {
        const res = await fetch('/api/billing/status', { credentials: 'include', cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 401) {
          setPhase('error');
          return;
        }
        if (!res.ok) {
          setPhase('incomplete');
          return;
        }
        const data = (await res.json()) as BillingStatus;
        if (data.isPro) {
          setPhase('pro');
          router.refresh();
          return;
        }
        attempts += 1;
        if (attempts >= 8) {
          if (data.status === 'unpaid' || data.status === 'expired') {
            setPhase('incomplete');
          } else {
            setPhase('confirming');
          }
          return;
        }
        setTimeout(() => {
          if (!cancelled) void poll();
        }, 2000);
      } catch {
        if (!cancelled) setPhase('error');
      }
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 pb-16">
      <Link
        href="/billing"
        className="text-sm text-muted-foreground hover:text-white transition-colors inline-block mb-6"
      >
        ← Back to billing
      </Link>

      <h1 className="text-2xl font-bold text-white tracking-tight mb-3">Checkout</h1>

      {phase === 'confirming' ? (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mt-0.5" />
            <p>Payment received. Waiting for billing confirmation.</p>
          </div>
          <p className="text-xs text-muted-foreground">
            This page does not unlock Founding Pro by itself. Access updates after confirmation.
          </p>
        </div>
      ) : null}

      {phase === 'pro' ? (
        <p className="text-sm text-white">Founding Pro is active on this account.</p>
      ) : null}

      {phase === 'incomplete' ? (
        <p className="text-sm text-amber-300">
          Billing setup is incomplete. If you completed payment, wait a moment and refresh billing status.
        </p>
      ) : null}

      {phase === 'error' ? (
        <p className="text-sm text-red-400">Could not confirm billing status. Sign in and open Billing.</p>
      ) : null}
    </main>
  );
}
