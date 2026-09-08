import { query, queryOne } from '@/lib/db';

export const CLAIM_WEBHOOK_EVENT_SQL = `
INSERT INTO public.billing_webhook_events (provider, provider_event_id, event_type)
VALUES ($1, $2, $3)
ON CONFLICT (provider, provider_event_id) DO NOTHING
RETURNING id
`;

export const COMPLETE_WEBHOOK_EVENT_SQL = `
UPDATE public.billing_webhook_events
SET processed_at = now(), outcome = $2, error = $3
WHERE provider = $1 AND provider_event_id = $4
`;

export const RELEASE_WEBHOOK_EVENT_SQL = `
DELETE FROM public.billing_webhook_events
WHERE provider = $1 AND provider_event_id = $2 AND processed_at IS NULL
`;

export async function claimWebhookEvent(input: {
  provider: string;
  eventId: string;
  eventType: string;
}): Promise<'claimed' | 'duplicate'> {
  const row = await queryOne<{ id: string }>(CLAIM_WEBHOOK_EVENT_SQL, [
    input.provider,
    input.eventId,
    input.eventType,
  ]);
  return row?.id ? 'claimed' : 'duplicate';
}

export async function completeWebhookEvent(input: {
  provider: string;
  eventId: string;
  outcome: string;
  error?: string | null;
}): Promise<void> {
  await query(COMPLETE_WEBHOOK_EVENT_SQL, [
    input.provider,
    input.outcome,
    input.error ?? null,
    input.eventId,
  ]);
}

export async function releaseWebhookEvent(input: { provider: string; eventId: string }): Promise<void> {
  await query(RELEASE_WEBHOOK_EVENT_SQL, [input.provider, input.eventId]);
}
