'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

type UnauthorizedPanelProps = {
  className?: string;
  /** Optional override; default explains session required for betting APIs. */
  message?: string;
  onRetry?: () => void;
};

/**
 * On-page state for HTTP 401 from private `/api/betting/*` routes.
 * Prefer this over a raw "Failed to fetch" string so users can sign in again.
 */
export function UnauthorizedPanel({
  className,
  message = 'Your session expired or you are signed out. Sign in to load live betting data.',
  onRetry,
}: UnauthorizedPanelProps) {
  const pathname = usePathname() || '/betting';
  const next = encodeURIComponent(pathname);

  return (
    <div
      role="alert"
      className={cn(
        'glass-card rounded-xl p-6 border-l-4 border-l-[#ff6b35]',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-[#ff6b35]/15 p-2">
          <Lock className="h-4 w-4 text-[#ff6b35]" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-white">Sign in required</h2>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href={`/login?next=${next}`}
              className="inline-flex items-center rounded-lg bg-[#00d4ff] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#00e5ff]"
            >
              Sign in
            </Link>
            <Link
              href={`/signup?next=${next}`}
              className="text-sm text-muted-foreground hover:text-[#00d4ff] transition-colors"
            >
              Create account
            </Link>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="text-sm text-[#00d4ff] hover:underline"
              >
                Retry
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
