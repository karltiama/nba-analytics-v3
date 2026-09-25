'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { signOutToLogin } from '@/lib/auth/logout';
import { recoveryPresence, updateRecoveredPassword } from '@/lib/auth/password-recovery';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const fieldClass =
  'type-interactive w-full rounded-xl border border-[#DCE9EA] bg-white py-3 text-[#063f46] placeholder:text-[#4a6366] focus:outline-none focus:ring-2 focus:ring-[#55ddb1]/40 focus:border-[#55ddb1]';

type Phase = 'checking' | 'ready' | 'missing' | 'done';

export function UpdatePasswordClient() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const errorId = 'update-password-error';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      for (let i = 0; i < 8; i++) {
        const { data } = await supabase.auth.getUser();
        if (cancelled) return;
        if (recoveryPresence(data.user?.id) === 'ready') {
          setPhase('ready');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      if (!cancelled) setPhase('missing');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading || phase !== 'ready') return;
    setError(null);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const result = await updateRecoveredPassword({
        password,
        confirm,
        updateUser: (credentials) => supabase.auth.updateUser(credentials),
      });
      if (result.status === 'invalid' || result.status === 'error') {
        setError(result.message);
        return;
      }
      setPhase('done');
      const next = await signOutToLogin(() => supabase.auth.signOut());
      window.location.assign(`${next}?notice=password_updated`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthSplitLayout
      topRight={
        <Link href="/login" className="type-interactive text-[#075B5C] hover:underline">
          Back to sign in
        </Link>
      }
    >
      <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#063f46]">Choose a new password</h1>
      <p className="type-body text-cc-secondary mt-2">
        Use at least 6 characters. You&apos;ll sign in again after it saves.
      </p>

      {phase === 'checking' ? (
        <p className="type-body text-cc-secondary mt-8" role="status">
          Checking your reset link…
        </p>
      ) : null}

      {phase === 'missing' ? (
        <div className="mt-8 space-y-4">
          <p className="type-body text-red-600" role="alert">
            This reset link is missing, expired, or already used.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/forgot-password"
              className="type-interactive inline-flex items-center justify-center rounded-xl bg-[#55ddb1] px-4 py-3 text-[#063f46] hover:bg-[#3dcc9f]"
            >
              Forgot password
            </Link>
            <Link
              href="/login"
              className="type-interactive inline-flex items-center justify-center rounded-xl border border-[#DCE9EA] bg-white px-4 py-3 text-[#063f46] hover:bg-[#f7f9f7]"
            >
              Sign in
            </Link>
          </div>
        </div>
      ) : null}

      {phase === 'ready' || phase === 'done' ? (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="password" className="type-interactive text-[#063f46]">
              New password
            </label>
            <div className="relative mt-1.5">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4a6366]" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={`${fieldClass} pl-10 pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a6366] hover:text-[#063f46] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/40 rounded"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="confirm-password" className="type-interactive text-[#063f46]">
              Confirm password
            </label>
            <div className="relative mt-1.5">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4a6366]" />
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={6}
                value={confirm}
                onChange={(ev) => setConfirm(ev.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={`${fieldClass} pl-10 pr-3`}
              />
            </div>
          </div>
          {error ? (
            <p id={errorId} className="type-body text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loading || phase === 'done'}
            className="type-interactive w-full inline-flex items-center justify-center rounded-xl bg-[#55ddb1] py-3.5 text-[#063f46] hover:bg-[#3dcc9f] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Saving…' : 'Update password'}
          </button>
        </form>
      ) : null}
    </AuthSplitLayout>
  );
}
