const LOGIN_ERRORS: Record<string, string> = {
  auth_callback: 'That sign-in link is invalid or has expired. Request a new one, or sign in if you already confirmed.',
  auth_config: 'Sign-in is temporarily unavailable. Try again in a few minutes.',
};

const LOGIN_NOTICES: Record<string, string> = {
  password_updated: 'Password updated. Sign in with your new password.',
};

const FORGOT_ERRORS: Record<string, string> = {
  recovery_expired: 'That reset link is invalid or has expired. Request a new one.',
};

export function loginErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return LOGIN_ERRORS[code] ?? null;
}

export function loginNoticeMessage(code: string | null): string | null {
  if (!code) return null;
  return LOGIN_NOTICES[code] ?? null;
}

export function forgotPasswordErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return FORGOT_ERRORS[code] ?? null;
}
