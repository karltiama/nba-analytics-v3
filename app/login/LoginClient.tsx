'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity } from 'lucide-react';
import { ContinueWithGoogleButton } from '@/components/auth/ContinueWithGoogleButton';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { safeInternalPath } from '@/lib/auth/safe-next';

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(
    () => safeInternalPath(searchParams.get('next'), '/betting'),
    [searchParams]
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
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
      router.refresh();
      router.push(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      <div className="absolute inset-0 gradient-mesh opacity-80 pointer-events-none" />
      <header className="relative z-10 p-6">
        <Link href="/" className="inline-flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#00d4ff]/10 border border-[#00d4ff]/30 flex items-center justify-center">
            <Activity className="w-5 h-5 text-[#00d4ff]" />
          </div>
          <span className="font-bold text-xl tracking-tight text-white">
            NBA<span className="text-[#00d4ff]">Edge</span>
          </span>
        </Link>
      </header>
      <main className="relative z-10 flex items-center justify-center px-4 pb-20">
        <div className="w-full max-w-md glass-card border border-white/10 rounded-2xl p-8 shadow-2xl">
          <h1 className="text-2xl font-bold text-white mb-1">Sign in</h1>
          <p className="text-sm text-muted-foreground mb-6">Use your email and password, or continue with Google below.</p>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-xl bg-secondary/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#00d4ff]/40"
              />
            </div>
            <div>
              <label htmlFor="password" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl bg-secondary/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#00d4ff]/40"
              />
            </div>
            {error ? (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-[#00d4ff] to-[#bf5af2] py-3 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div className="flex items-center gap-3 my-6">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">or</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>
          <ContinueWithGoogleButton nextPath={nextPath} disabled={loading} />
          <p className="mt-6 text-center text-sm text-muted-foreground">
            No account?{' '}
            <Link href={`/signup?next=${encodeURIComponent(nextPath)}`} className="text-[#00d4ff] hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
