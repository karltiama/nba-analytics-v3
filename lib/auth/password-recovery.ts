import { PASSWORD_UPDATE_PATH } from '@/lib/auth/auth-callback';

/** Matches the signup form (min. 6 characters). */
export const MIN_PASSWORD_LENGTH = 6;

export const RESET_SUCCESS_MESSAGE =
  "If an account exists for that email, you'll receive a password reset link.";

export const RESET_PROVIDER_ERROR = "We couldn't send the reset link. Try again.";
export const RESET_RATE_LIMIT_ERROR = 'Too many attempts. Wait a moment and try again.';
export const PASSWORD_MISMATCH_ERROR = 'Passwords do not match.';
export const PASSWORD_TOO_SHORT_ERROR = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
export const PASSWORD_UPDATE_ERROR = "We couldn't update your password. Try again.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidAuthEmail(raw: string): boolean {
  const email = raw.trim();
  if (!email || email.length > 320) return false;
  return EMAIL_RE.test(email);
}

export function recoveryRedirectUrl(origin: string): string {
  const base = origin.replace(/\/$/, '');
  return `${base}/auth/callback?next=${encodeURIComponent(PASSWORD_UPDATE_PATH)}`;
}

function looksLikeMissingAccount(message: string): boolean {
  return /user not found|not registered|no user/i.test(message);
}

function looksLikeRateLimit(message: string): boolean {
  return /rate limit|too many|over_request|429/i.test(message);
}

export type ResetRequestResult =
  | { status: 'invalid_email' }
  | { status: 'ignored' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

/**
 * Ask Supabase Auth to email a recovery link.
 * Missing accounts use the same success copy as real accounts.
 */
export async function requestPasswordReset(input: {
  email: string;
  origin: string;
  inFlight: { current: boolean };
  resetPasswordForEmail: (
    email: string,
    options: { redirectTo: string }
  ) => Promise<{ error: { message: string } | null }>;
}): Promise<ResetRequestResult> {
  if (input.inFlight.current) return { status: 'ignored' };
  const email = input.email.trim();
  if (!isValidAuthEmail(email)) return { status: 'invalid_email' };

  input.inFlight.current = true;
  try {
    const redirectTo = recoveryRedirectUrl(input.origin);
    const { error } = await input.resetPasswordForEmail(email, { redirectTo });
    if (!error) return { status: 'success', message: RESET_SUCCESS_MESSAGE };
    if (looksLikeMissingAccount(error.message)) {
      return { status: 'success', message: RESET_SUCCESS_MESSAGE };
    }
    if (looksLikeRateLimit(error.message)) {
      return { status: 'error', message: RESET_RATE_LIMIT_ERROR };
    }
    return { status: 'error', message: RESET_PROVIDER_ERROR };
  } catch {
    return { status: 'error', message: RESET_PROVIDER_ERROR };
  } finally {
    input.inFlight.current = false;
  }
}

export type PasswordUpdateResult =
  | { status: 'invalid'; message: string }
  | { status: 'success' }
  | { status: 'error'; message: string };

export function validateNewPassword(password: string, confirm: string): PasswordUpdateResult | { status: 'ok' } {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { status: 'invalid', message: PASSWORD_TOO_SHORT_ERROR };
  }
  if (password !== confirm) {
    return { status: 'invalid', message: PASSWORD_MISMATCH_ERROR };
  }
  return { status: 'ok' };
}

export async function updateRecoveredPassword(input: {
  password: string;
  confirm: string;
  updateUser: (credentials: { password: string }) => Promise<{ error: { message: string } | null }>;
}): Promise<PasswordUpdateResult> {
  const check = validateNewPassword(input.password, input.confirm);
  if (check.status !== 'ok') return check;
  try {
    const { error } = await input.updateUser({ password: input.password });
    if (error) return { status: 'error', message: PASSWORD_UPDATE_ERROR };
    return { status: 'success' };
  } catch {
    return { status: 'error', message: PASSWORD_UPDATE_ERROR };
  }
}

export type RecoveryPresence = 'ready' | 'missing';

export function recoveryPresence(userId: string | null | undefined): RecoveryPresence {
  return userId ? 'ready' : 'missing';
}
