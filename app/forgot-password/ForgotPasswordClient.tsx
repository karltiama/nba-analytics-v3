'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Mail } from 'lucide-react';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { forgotPasswordErrorMessage } from '@/lib/auth/auth-notices';
import { requestPasswordReset } from '@/lib/auth/password-recovery';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const fieldClass =
  'type-interactive w-full rounded-xl border border-[#DCE9EA] bg-white py-3 text-[#063f46] placeholder:text-[#4a6366] focus:outline-none focus:ring-2 focus:ring-[#55ddb1]/40 focus:border-[#55ddb1]';

export function ForgotPasswordClient() {
  const searchParams = useSearchParams();
  const linkError = useMemo(
    () => forgotPasswordErrorMessage(searchParams.get('error')),
    [searchParams]
  );

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const errorId = 'forgot-password-error';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading || inFlight.current) return;
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const result = await requestPasswordReset({
        email,
        origin: window.location.origin,
        inFlight,
        resetPasswordForEmail: (address, options) =>
          supabase.auth.resetPasswordForEmail(address, options),
      });
      if (result.status === 'invalid_email') {
        setError('Enter a valid email address.');
        return;
      }
      if (result.status === 'error') {
        setError(result.message);
        return;
      }
      if (result.status === 'success') {
        setInfo(result.message);
      }
    } finally {
      setLoading(false);
    }
  }

  const visibleError = error ?? linkError;

  return (
    <AuthSplitLayout
      topRight={
        <Link href="/login" className="type-interactive text-[#075B5C] hover:underline">
          Back to sign in
        </Link>
      }
    >
      <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#063f46]">Reset password</h1>
      <p className="type-body text-cc-secondary mt-2">
        Enter your email and we&apos;ll send a reset link.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="type-interactive text-[#063f46]">
            Email
          </label>
          <div className="relative mt-1.5">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4a6366]" />
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              aria-invalid={visibleError ? true : undefined}
              aria-describedby={visibleError ? errorId : undefined}
              className={`${fieldClass} pl-10 pr-3`}
            />
          </div>
        </div>
        {visibleError ? (
          <p id={errorId} className="type-body text-red-600" role="alert">
            {visibleError}
          </p>
        ) : null}
        {info ? (
          <p className="type-body text-[#075B5C]" role="status">
            {info}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          className="type-interactive w-full inline-flex items-center justify-center rounded-xl bg-[#55ddb1] py-3.5 text-[#063f46] hover:bg-[#3dcc9f] disabled:opacity-50 transition-colors"
        >
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthSplitLayout>
  );
}
