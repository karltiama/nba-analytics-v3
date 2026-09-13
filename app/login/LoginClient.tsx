'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { ContinueWithGoogleButton } from '@/components/auth/ContinueWithGoogleButton';
import { AuthInsightCard, AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { safeInternalPath } from '@/lib/auth/safe-next';

const fieldClass =
  'w-full rounded-xl border border-[#DCE9EA] bg-white py-3 text-sm text-[#063f46] placeholder:text-[#8aa0a3] focus:outline-none focus:ring-2 focus:ring-[#55ddb1]/40 focus:border-[#55ddb1]';

export function LoginClient() {
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
  const [loading, setLoading] = useState(false);

  async function waitForSessionReady(maxAttempts = 8, delayMs = 120) {
    const supabase = createSupabaseBrowserClient();
    for (let i = 0; i < maxAttempts; i++) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) return true;
      if (i < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return false;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signError } = await supabase.auth.signInWithPassword({ email, password });
      if (signError) {
        setError(signError.message);
        return;
      }

      await waitForSessionReady();
      router.push(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  const signupHref = `/signup?next=${encodeURIComponent(nextPath)}`;

  return (
    <AuthSplitLayout
      topRight={
        <>
          New to Court Context?{' '}
          <Link href={signupHref} className="font-semibold text-[#075B5C] hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#063f46]">Welcome back</h1>
      <p className="mt-2 text-sm sm:text-base text-[#4a6366] leading-relaxed">
        Sign in to your Court Context account and get back to the game.
      </p>

      <div className="mt-8">
        <ContinueWithGoogleButton nextPath={nextPath} disabled={loading} />
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
              autoComplete="current-password"
              required
              placeholder="Enter your password"
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
        <button
          type="submit"
          disabled={loading}
          className="group w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#55ddb1] py-3.5 text-sm font-bold text-[#063f46] hover:bg-[#3dcc9f] disabled:opacity-50 transition-colors"
        >
          {loading ? 'Signing in…' : 'Sign In'}
          {!loading ? (
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          ) : null}
        </button>
      </form>

      <AuthInsightCard />
    </AuthSplitLayout>
  );
}
