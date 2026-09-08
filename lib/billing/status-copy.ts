export type BillingStatusCopyInput = {
  isPro: boolean;
  status: string;
  currentPeriodEnd: string | null;
  canManageBilling: boolean;
  checkoutEnabled?: boolean;
};

export function billingPlanLabel(status: BillingStatusCopyInput): string {
  if (status.isPro) return 'Founding Pro';
  return 'Free';
}

export function formatBillingPeriodDay(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function billingStatusLine(status: BillingStatusCopyInput): string {
  const day = formatBillingPeriodDay(status.currentPeriodEnd);
  if (status.isPro && status.status === 'canceled' && day) {
    return `Cancels on ${day}`;
  }
  switch (status.status) {
    case 'active':
      return 'Active';
    case 'trialing':
      return 'Trialing';
    case 'canceled':
      return day ? `Canceled · ended ${day}` : 'Canceled';
    case 'past_due':
      return 'Past due';
    case 'unpaid':
      return 'Unpaid';
    case 'expired':
      return 'Expired';
    case 'none':
      return 'None';
    default:
      return status.status;
  }
}

export function billingRetentionCopy(status: BillingStatusCopyInput): string | null {
  if (status.isPro && status.status === 'canceled') return null;
  if (status.status === 'past_due' || status.status === 'expired' || status.status === 'canceled') {
    return 'Your research is still saved. Renew Founding Pro to restore premium market tools.';
  }
  return null;
}

export function isManualProWithoutStripe(status: BillingStatusCopyInput): boolean {
  return status.isPro && !status.canManageBilling;
}

export function showUpgradeCheckout(status: BillingStatusCopyInput): boolean {
  return !status.isPro && Boolean(status.checkoutEnabled) && !status.canManageBilling;
}

export function showManageBilling(status: BillingStatusCopyInput): boolean {
  return Boolean(status.canManageBilling);
}
