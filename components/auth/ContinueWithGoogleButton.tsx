'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  generateGoogleNoncePair,
  getGoogleClientId,
  loadGoogleIdentityServices,
  type GoogleCredentialResponse,
} from '@/lib/auth/google-identity';
import { cn } from '@/lib/utils';

type ContinueWithGoogleButtonProps = {
  nextPath: string;
  /** Disable while email/password form is submitting */
  disabled?: boolean;
  className?: string;
  /** Fires when the user chooses Google. Does not mean the account was created. */
  onStart?: () => void;
};

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

export function ContinueWithGoogleButton({
  nextPath,
  disabled,
  className,
  onStart,
}: ContinueWithGoogleButtonProps) {
  const router = useRouter();
  const buttonHostRef = useRef<HTMLDivElement>(null);
  const nonceRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const nextPathRef = useRef(nextPath);
  const onStartRef = useRef(onStart);
  const [loading, setLoading] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  nextPathRef.current = nextPath;
  onStartRef.current = onStart;

  useEffect(() => {
    let cancelled = false;

    async function mountGoogleButton() {
      const clientId = getGoogleClientId();
      if (!clientId) {
        if (!cancelled) {
          setError('Google sign-in is not configured (missing NEXT_PUBLIC_GOOGLE_CLIENT_ID).');
        }
        return;
      }

      try {
        await loadGoogleIdentityServices();
        if (cancelled || !buttonHostRef.current || !window.google?.accounts?.id) return;

        const { nonce, hashedNonce } = await generateGoogleNoncePair();
        nonceRef.current = nonce;

        const handleCredential = async (response: GoogleCredentialResponse) => {
          if (inFlightRef.current) return;
          inFlightRef.current = true;
          setError(null);
          setLoading(true);
          try {
            try {
              onStartRef.current?.();
            } catch {
              // Tracking must not block auth.
            }

            const credential = response.credential?.trim();
            if (!credential) {
              setError('Google did not return a credential.');
              return;
            }

            const supabase = createSupabaseBrowserClient();
            const { error: idTokenError } = await supabase.auth.signInWithIdToken({
              provider: 'google',
              token: credential,
              nonce: nonceRef.current ?? undefined,
            });
            if (idTokenError) {
              setError(idTokenError.message);
              return;
            }

            await waitForSessionReady();
            router.refresh();
            router.push(nextPathRef.current);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Google sign-in failed');
          } finally {
            inFlightRef.current = false;
            setLoading(false);
          }
        };

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredential,
          nonce: hashedNonce,
          context: 'signin',
          ux_mode: 'popup',
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
        });

        buttonHostRef.current.innerHTML = '';
        const width = Math.max(240, Math.floor(buttonHostRef.current.clientWidth || 320));
        window.google.accounts.id.renderButton(buttonHostRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
          width,
        });

        if (!cancelled) setSdkReady(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load Google sign-in');
        }
      }
    }

    void mountGoogleButton();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="space-y-2">
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <div
        className={cn(
          'relative w-full min-h-[48px] rounded-2xl border border-[#DCE9EA] bg-white shadow-sm overflow-hidden',
          (disabled || loading) && 'opacity-50 pointer-events-none',
          className
        )}
      >
        {!sdkReady && !error ? (
          <div className="absolute inset-0 flex items-center justify-center gap-3 px-4 text-sm font-semibold text-[#063f46]">
            <GoogleMark />
            Loading Google…
          </div>
        ) : null}
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 text-sm font-semibold text-[#063f46]">
            Signing in…
          </div>
        ) : null}
        <div
          ref={buttonHostRef}
          className="flex w-full items-center justify-center [&_div]:!w-full [&_iframe]:!w-full"
          aria-busy={loading || !sdkReady}
        />
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
