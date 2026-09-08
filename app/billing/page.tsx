'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type BillingStatus = {
  plan: string;
  isPro: boolean;
  status: string;
  currentPeriodEnd: string | null;
  provider: string | null;
  canManageBilling: boolean;
};

const cardCls = 'glass-card border border-white/10 rounded-2xl p-5 sm:p-6';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#00d4ff]/90 to-[#bf5af2]/90 px-4 py-2 text-sm font-medium text-white hover:opacity-95 disabled:opacity-50';
const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50';

function planLabel(plan: string, isPro: boolean): string {
  if (isPro || plan === 'founding_pro') return 'Founding Pro';
  return 'Free';
}

function statusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'trialing':
      return 'Trialing';
    case 'canceled':
      return 'Cancels at period end';
    case 'past_due':
      return 'Past due';
    case 'unpaid':
      return 'Unpaid';
    case 'expired':
      return 'Expired';
    case 'none':
      return 'None';
    default:
      return status;
  }
}

function formatPeriodEnd(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString();
}

export default function BillingPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/billing/status', { credentials: 'include', cache: 'no-store' });
      if (res.status === 401) {
        setError('You need to sign in again.');
        return;
      }
      if (!res.ok) {
        setError('Could not load billing status.');
        return;
      }
      setStatus((await res.json()) as BillingStatus);
    } catch {
      setError('Could not load billing status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startCheckout() {
    setActionError(null);
    setBusy('checkout');
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'upgrade_founding_pro' }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
        code?: string;
      };
      if (res.status === 409) {
        setActionError(data.error || 'Founding Pro is already active. Use Manage billing.');
        await load();
        return;
      }
      if (!res.ok || !data.url) {
        setActionError(data.error || 'Could not start checkout.');
        return;
      }
      window.location.href = data.url;
    } catch {
      setActionError('Could not start checkout.');
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    setActionError(null);
    setBusy('portal');
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setActionError(data.error || 'Billing management is not available yet.');
        return;
      }
      window.location.href = data.url;
    } catch {
      setActionError('Could not open billing portal.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8 pb-16">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading billing…
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 pb-16">
      <Link
        href="/betting"
        className="text-sm text-muted-foreground hover:text-white transition-colors inline-block mb-6"
      >
        ← Back to betting
      </Link>

      <h1 className="text-2xl font-bold text-white tracking-tight mb-1">Billing</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Current plan and Stripe-hosted billing management.
      </p>

      {error ? <p className="text-sm text-red-400 mb-4">{error}</p> : null}

      <section className={cn(cardCls, 'mb-6')}>
        <h2 className="text-sm font-semibold text-white mb-4">Current plan</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="text-white">{status ? planLabel(status.plan, status.isPro) : '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="text-white">{status ? statusLabel(status.status) : '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Current period end</dt>
            <dd className="text-white">{formatPeriodEnd(status?.currentPeriodEnd ?? null)}</dd>
          </div>
        </dl>

        {actionError ? <p className="text-sm text-amber-300 mt-4">{actionError}</p> : null}

        <div className="flex flex-wrap gap-3 mt-6">
          {status && !status.isPro ? (
            <button type="button" className={btnPrimary} disabled={busy !== null} onClick={() => void startCheckout()}>
              {busy === 'checkout' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Upgrade to Founding Pro
            </button>
          ) : null}
          {status?.canManageBilling ? (
            <button type="button" className={btnSecondary} disabled={busy !== null} onClick={() => void openPortal()}>
              {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Manage billing
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
