import { AUTHENTICATED_HOME, safeInternalPath } from '@/lib/auth/safe-next';

export const PASSWORD_UPDATE_PATH = '/update-password';

export type AuthCallbackPlan =
  | { action: 'exchange'; code: string; next: string }
  | { action: 'redirect'; location: string };

function isRecoveryNext(next: string): boolean {
  return next === PASSWORD_UPDATE_PATH || next.startsWith(`${PASSWORD_UPDATE_PATH}?`);
}

function failureLocation(origin: string, next: string): string {
  if (isRecoveryNext(next)) {
    return `${origin}/forgot-password?error=recovery_expired`;
  }
  return `${origin}/login?error=auth_callback`;
}

/**
 * Decide the callback redirect without calling Supabase.
 * Recovery links use the same PKCE callback, then land on /update-password.
 * Onboarding stays on the destination page (E9); this does not rewrite it.
 */
export function planAuthCallback(input: {
  origin: string;
  code: string | null;
  next: string | null;
  providerError: string | null;
}): AuthCallbackPlan {
  const next = safeInternalPath(input.next, AUTHENTICATED_HOME);
  if (input.providerError || !input.code) {
    return { action: 'redirect', location: failureLocation(input.origin, next) };
  }
  return { action: 'exchange', code: input.code, next };
}

export function finishAuthCallback(input: {
  origin: string;
  next: string;
  exchangeOk: boolean;
}): string {
  if (!input.exchangeOk) return failureLocation(input.origin, input.next);
  return `${input.origin}${input.next}`;
}
