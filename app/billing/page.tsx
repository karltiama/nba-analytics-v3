'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOUNDING_PRO_PRICE_CONCEPT } from '@/lib/entitlements/types';
import {
  billingPlanLabel,
  billingRetentionCopy,
  billingStatusLine,
  formatBillingPeriodDay,
  isManualProWithoutStripe,
  showManageBilling,
  showUpgradeCheckout,
} from '@/lib/billing/status-copy';

type BillingStatus = {
  plan: string;
  isPro: boolean;
  status: string;
  currentPeriodEnd: string | null;
  provider: string | null;
  canManageBilling: boolean;
  billingMode?: 'disabled' | 'stripe_test' | 'stripe_live';
  checkoutEnabled?: boolean;
  portalEnabled?: boolean;
  billingNotice?: string | null;
  priceLabel?: string;
};

const cardCls = 'glass-card border border-white/10 rounded-2xl p-5 sm:p-6';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#00d4ff]/90 to-[#bf5af2]/90 px-4 py-2 text-sm font-medium text-white hover:opacity-95 disabled:opacity-50';
const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50';

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
        setActionError(data.error || 'Billing management is not available for this account.');
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

  const showUpgrade = Boolean(status && showUpgradeCheckout(status));
  const showPortal = Boolean(status && showManageBilling(status));
  const manualPro = Boolean(status && isManualProWithoutStripe(status));
  const priceLabel = status?.priceLabel || FOUNDING_PRO_PRICE_CONCEPT;

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 pb-16">
      <Link
        href="/betting"
        className="text-sm text-muted-foreground hover:text-white transition-colors inline-block mb-6"
      >
        ← Back to betting
      </Link>

      <h1 className="text-2xl font-bold text-white tracking-tight mb-1">Billing</h1>
      <p className="text-sm text-muted-foreground mb-8">Founding Pro plan and Stripe-hosted billing.</p>

      {error ? <p className="text-sm text-red-400 mb-4">{error}</p> : null}

      {status?.billingNotice ? (
        <p className="text-xs text-amber-200/90 mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
          {status.billingNotice}
        </p>
      ) : null}

      <section className={cn(cardCls, 'mb-6')}>
        <h2 className="text-sm font-semibold text-white mb-4">Current plan</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="text-white">{status ? billingPlanLabel(status) : '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="text-white">{status ? billingStatusLine(status) : '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Current period end</dt>
            <dd className="text-white">{formatBillingPeriodDay(status?.currentPeriodEnd ?? null) ?? '—'}</dd>
          </div>
        </dl>

        {status && billingRetentionCopy(status) ? (
          <p className="text-xs text-muted-foreground mt-4">{billingRetentionCopy(status)}</p>
        ) : null}

        {manualPro ? (
          <p className="text-xs text-muted-foreground mt-4">
            Founding Pro is active on this account. Stripe billing management is not available because no
            Stripe customer is on file.
          </p>
        ) : null}

        {actionError ? <p className="text-sm text-amber-300 mt-4">{actionError}</p> : null}

        <div className="flex flex-wrap gap-3 mt-6">
          {showUpgrade ? (
            <button type="button" className={btnPrimary} disabled={busy !== null} onClick={() => void startCheckout()}>
              {busy === 'checkout' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Upgrade to Founding Pro
            </button>
          ) : null}
          {showPortal ? (
            <button type="button" className={btnSecondary} disabled={busy !== null} onClick={() => void openPortal()}>
              {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Manage billing
            </button>
          ) : null}
        </div>
      </section>

      <section className={cardCls}>
        <h2 className="text-sm font-semibold text-white mb-1">Founding Pro</h2>
        <p className="text-lg font-semibold text-white mb-2">{priceLabel}</p>
        <p className="text-sm text-white mb-4">Stop checking multiple sportsbooks manually.</p>
        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
          <li>Exact best sportsbook for the selected market</li>
          <li>Best available Over/Under line and best same-line price</li>
          <li>Deeper sportsbook comparison</li>
          <li>Movement history when real snapshot history exists</li>
          <li>AI research briefings as a supporting benefit</li>
        </ul>
      </section>
    </main>
  );
}
