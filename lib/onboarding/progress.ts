import type { ChecklistItemId } from './contract';
import { markChecklistItem, readOnboardingState } from './storage';
import { shouldSuppressProductPreviewAnalytics } from '@/lib/parlay/preview-fixture';
import { trackEvent } from '@/lib/product-analytics/track-event';

function previewFlagFromWindow(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get('preview');
  } catch {
    return null;
  }
}

export function completeChecklistItem(
  id: ChecklistItemId,
  previewFlag: string | null | undefined = previewFlagFromWindow()
): void {
  if (shouldSuppressProductPreviewAnalytics(previewFlag)) return;
  const before = readOnboardingState();
  if (before.checklist[id]) return;
  markChecklistItem(id);
  trackEvent('checklist_item_completed', { surface: 'onboarding', item_id: id });
}
