'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { ContinueWithGoogleButton } from '@/components/auth/ContinueWithGoogleButton';
import { AuthInsightCard, AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { safeInternalPath } from '@/lib/auth/safe-next';
import {
  SIGNUP_COMPLETED,
  SIGNUP_STARTED,
  signupSurfaceProperties,
} from '@/lib/product-analytics/conversion-events';
import { trackEvent } from '@/lib/product-analytics/track-event';

const fieldClass =
  'w-full rounded-xl border border-[#DCE9EA] bg-white py-3 text-sm text-[#063f46] placeholder:text-[#8aa0a3] focus:outline-none focus:ring-2 focus:ring-[#55ddb1]/40 focus:border-[#55ddb1]';

export function SignupClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(
    () => safeInternalPath(searchParams.get('next'), '/betting'),
    [searchParams]
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    trackEvent(SIGNUP_STARTED, signupSurfaceProperties());
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const { data, error: signError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      });
      if (signError) {
        setError(signError.message);
        return;
      }
      if (data.session) {
        trackEvent(SIGNUP_COMPLETED, signupSurfaceProperties());
        router.refresh();
        router.push(nextPath);
        return;
      }
      setInfo('Check your email to confirm your account, then sign in.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  }

  const loginHref = `/login?next=${encodeURIComponent(nextPath)}`;

  return (
    <AuthSplitLayout
      topRight={
        <>
          Already have an account?{' '}
          <Link href={loginHref} className="font-semibold text-[#075B5C] hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#063f46]">Create account</h1>
      <p className="mt-2 text-sm sm:text-base text-[#4a6366] leading-relaxed">
        Use email and a password (min. 6 characters), or continue with Google below.
      </p>

      <div className="mt-8">
        <ContinueWithGoogleButton
          nextPath={nextPath}
          disabled={loading}
          onStart={() => trackEvent(SIGNUP_STARTED, signupSurfaceProperties())}
        />
      </div>

      <div className="flex items-center gap-3 my-6">
        <div className="h-px flex-1 bg-[#DCE9EA]" />
        <span className="text-[11px] font-semibold text-[#8aa0a3] uppercase tracking-wider">or</span>
        <div className="h-px flex-1 bg-[#DCE9EA]" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="text-sm font-medium text-[#063f46]">
            Email
          </label>
          <div className="relative mt-1.5">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8aa0a3]" />
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${fieldClass} pl-10 pr-3`}
            />
          </div>
        </div>
        <div>
          <label htmlFor="password" className="text-sm font-medium text-[#063f46]">
            Password
          </label>
          <div className="relative mt-1.5">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8aa0a3]" />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={6}
              placeholder="Create a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${fieldClass} pl-10 pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8aa0a3] hover:text-[#063f46]"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        {info ? (
          <p className="text-sm text-[#075B5C]" role="status">
            {info}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          className="group w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#55ddb1] py-3.5 text-sm font-bold text-[#063f46] hover:bg-[#3dcc9f] disabled:opacity-50 transition-colors"
        >
          {loading ? 'Creating…' : 'Create account'}
          {!loading ? (
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          ) : null}
        </button>
      </form>

      <AuthInsightCard />
    </AuthSplitLayout>
  );
}
