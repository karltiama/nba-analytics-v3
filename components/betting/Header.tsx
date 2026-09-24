'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { Sun, Moon, User, Zap, LogIn, LogOut, ChevronDown, Settings, Menu, CircleHelp } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { PRIMARY_NAV } from '@/components/betting/primary-nav';
import { ProductTourDialog } from '@/components/onboarding/ProductTourDialog';
import {
  contextualWorkspaceNavAriaLabel,
  contextualWorkspaceNavLabel,
} from '@/lib/parlay/preview-fixture';
import { PARLAY_WORKSPACE_HREF } from '@/lib/parlay/selection';
import { useParlaySelection } from '@/lib/parlay/use-parlay-selection';

interface HeaderProps {
  isDarkMode: boolean;
  onThemeToggle: () => void;
  teamName?: string;
  teamAbbr?: string;
}

type ProfilePayload = {
  displayName: string | null;
  username: string | null;
  email: string | null;
  timezone: string;
};

function navItemActive(pathname: string, href: string): boolean {
  if (href === '/betting') return pathname === '/betting';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  label,
  active,
  className,
}: {
  href: string;
  label: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'transition-colors',
        active ? 'text-[#063f46] font-semibold' : 'text-[#4a6366] hover:text-[#063f46]',
        className
      )}
    >
      {label}
    </Link>
  );
}

function ContextualParlayNav({
  variant,
  hideBelowLg = false,
}: {
  variant: 'desktop' | 'mobile-badge' | 'mobile-menu';
  hideBelowLg?: boolean;
}) {
  const { legs } = useParlaySelection();
  const label = contextualWorkspaceNavLabel(legs.length);
  if (!label) return null;
  const aria = contextualWorkspaceNavAriaLabel(legs.length);
  if (variant === 'mobile-badge') {
    if (hideBelowLg) return null;
    return (
      <Link
        href={PARLAY_WORKSPACE_HREF}
        aria-label={aria}
        className={cn(
          'md:hidden inline-flex items-center justify-center min-h-[36px] min-w-[36px] px-2 rounded-xl',
          'bg-white border border-[#DCE9EA] text-xs font-semibold tabular-nums text-[#063f46]',
          'hover:bg-[#f7f9f7] outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/40'
        )}
      >
        <span aria-hidden="true">{legs.length}</span>
      </Link>
    );
  }
  if (variant === 'mobile-menu') {
    return (
      <DropdownMenu.Item
        className="flex cursor-pointer items-center rounded-lg px-3 py-2.5 text-sm text-[#063f46] outline-none hover:bg-[#f7f9f7] focus:bg-[#f7f9f7]"
        asChild
      >
        <Link href={PARLAY_WORKSPACE_HREF} aria-label={aria}>
          {label}
        </Link>
      </DropdownMenu.Item>
    );
  }
  return (
    <Link
      href={PARLAY_WORKSPACE_HREF}
      aria-label={aria}
      aria-live="polite"
      className={
        hideBelowLg
          ? 'hidden lg:inline-flex items-center text-sm font-medium text-[#4a6366] hover:text-[#063f46] transition-colors'
          : 'hidden md:inline-flex items-center text-sm font-medium text-[#4a6366] hover:text-[#063f46] transition-colors'
      }
    >
      {label}
    </Link>
  );
}

export function Header({ isDarkMode, onThemeToggle, teamName, teamAbbr }: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname() || '/betting';
  const nextEncoded = encodeURIComponent(pathname);

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [sessionState, setSessionState] = useState<'loading' | 'guest' | 'user'>('loading');
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  /** Signed-in UI follows the browser Supabase session (same as middleware). Profile API only enriches fields. */
  const syncAccount = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      setSessionState('guest');
      setProfile(null);
      return;
    }

    const sessionEmail = user.email ?? null;
    setSessionState('user');
    setProfile({
      displayName: null,
      username: null,
      email: sessionEmail,
      timezone: 'America/New_York',
    });

    try {
      const res = await fetch('/api/user/profile', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { profile?: ProfilePayload };
      const p = data.profile;
      if (!p) return;
      setProfile({
        displayName: p.displayName ?? null,
        username: p.username ?? null,
        email: p.email ?? sessionEmail,
        timezone: p.timezone ?? 'America/New_York',
      });
    } catch {
      // keep session-derived email
    }
  }, [supabase]);

  useEffect(() => {
    void syncAccount();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void syncAccount();
    });
    return () => subscription.unsubscribe();
  }, [supabase, syncAccount]);

  const handleSignOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // still refresh UI
    }
    setSessionState('guest');
    setProfile(null);
    router.refresh();
  }, [router, supabase]);

  const explorerOwnsWorkspaceEntry = pathname.startsWith('/betting/props-explorer');
  const displayLabel =
    profile?.displayName?.trim() ||
    profile?.username?.trim() ||
    profile?.email?.split('@')[0] ||
    'Account';

  return (
    <header className="sticky top-0 z-50 bg-[#f7f9f7]/90 backdrop-blur-md border-b border-[#DCE9EA]">
      <ProductTourDialog open={tourOpen} onOpenChange={setTourOpen} />
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Title */}
          <div className="flex items-center gap-3 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/court-context-logo.png"
              alt=""
              className="h-9 w-auto select-none shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight text-[#063f46] truncate">
                {teamName ? (
                  <>
                    <span className="text-[#075B5C]">{teamAbbr || 'TEAM'}</span>
                    <span className="ml-1">{teamName}</span>
                  </>
                ) : (
                  'Court Context'
                )}
              </h1>
              <p className="text-xs text-[#4a6366] -mt-0.5">
                {teamName ? 'Analytics' : 'Betting Dashboard'}
              </p>
            </div>
          </div>

          {!teamName && (
            <nav
              className="hidden md:flex items-center gap-3 lg:gap-4 text-sm"
              aria-label="Primary"
            >
              {PRIMARY_NAV.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  active={navItemActive(pathname, item.href)}
                />
              ))}
            </nav>
          )}

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            {!teamName && (
              <>
                <ContextualParlayNav variant="desktop" hideBelowLg={explorerOwnsWorkspaceEntry} />
                <ContextualParlayNav variant="mobile-badge" hideBelowLg={explorerOwnsWorkspaceEntry} />
                <DropdownMenu.Root modal={false}>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'md:hidden p-2.5 rounded-xl bg-white border border-[#DCE9EA] hover:bg-[#f7f9f7] transition-colors',
                        'outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/40'
                      )}
                      aria-label="Open primary navigation"
                      aria-haspopup="menu"
                    >
                      <Menu className="w-4 h-4 text-[#063f46]" aria-hidden />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      sideOffset={8}
                      align="end"
                      className={cn(
                        'min-w-[200px] rounded-xl border border-[#DCE9EA] bg-white p-1 shadow-xl z-[300]',
                        'data-[state=open]:animate-in data-[state=closed]:animate-out'
                      )}
                    >
                      <ContextualParlayNav variant="mobile-menu" />
                      {PRIMARY_NAV.map((item) => (
                        <DropdownMenu.Item
                          key={item.href}
                          className="flex cursor-pointer items-center rounded-lg px-3 py-2.5 text-sm text-[#063f46] outline-none hover:bg-[#f7f9f7] focus:bg-[#f7f9f7]"
                          asChild
                        >
                          <Link href={item.href}>{item.label}</Link>
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </>
            )}

            <button
              type="button"
              onClick={onThemeToggle}
              className="p-2.5 rounded-xl bg-white border border-[#DCE9EA] hover:bg-[#f7f9f7] transition-colors"
              aria-label="Toggle theme"
            >
              {isDarkMode ? (
                <Sun className="w-4 h-4 text-[#ff6b35]" />
              ) : (
                <Moon className="w-4 h-4 text-[#bf5af2]" />
              )}
            </button>

            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex items-center gap-2 rounded-xl bg-white border border-[#DCE9EA] hover:bg-[#f7f9f7] transition-colors',
                    'outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/40',
                    sessionState === 'user' ? 'pl-2 pr-1.5 py-1.5 min-w-0' : 'p-2'
                  )}
                  aria-label={
                    sessionState === 'user'
                      ? `Account menu for ${displayLabel}`
                      : sessionState === 'guest'
                        ? 'Sign in or create an account'
                        : 'Loading account'
                  }
                  aria-haspopup="menu"
                >
                  <div className="w-7 h-7 rounded-lg bg-[#55ddb1] flex items-center justify-center shrink-0">
                    {sessionState === 'guest' ? (
                      <LogIn className="w-4 h-4 text-[#063f46]" aria-hidden />
                    ) : (
                      <User className="w-4 h-4 text-[#063f46]" aria-hidden />
                    )}
                  </div>
                  {sessionState === 'loading' ? (
                    <span className="text-sm text-[#4a6366] tabular-nums w-6 text-left hidden sm:inline">
                      …
                    </span>
                  ) : sessionState === 'guest' ? (
                    <span className="text-sm font-medium text-[#063f46] pr-0.5 max-sm:sr-only">Sign in</span>
                  ) : (
                    <span className="text-sm font-medium text-[#063f46] truncate min-w-0 max-w-[7rem] sm:max-w-[11rem] md:max-w-[15rem] text-left max-sm:hidden">
                      {displayLabel}
                    </span>
                  )}
                  <ChevronDown className="w-3.5 h-3.5 text-[#4a6366] shrink-0" aria-hidden />
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  sideOffset={8}
                  align="end"
                  className={cn(
                    'min-w-[240px] rounded-xl border border-[#DCE9EA] bg-white p-1 shadow-xl z-[300]',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out'
                  )}
                >
                  {sessionState === 'loading' ? (
                    <div className="px-3 py-3 text-sm text-[#4a6366]">Loading account…</div>
                  ) : sessionState === 'guest' ? (
                    <>
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-[#063f46] outline-none hover:bg-[#f7f9f7] focus:bg-[#f7f9f7]"
                        asChild
                      >
                        <Link href={`/login?next=${nextEncoded}`}>
                          <LogIn className="w-4 h-4 text-[#075B5C]" />
                          Sign in
                        </Link>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-[#063f46] outline-none hover:bg-[#f7f9f7] focus:bg-[#f7f9f7]"
                        asChild
                      >
                        <Link href={`/signup?next=${nextEncoded}`}>
                          <User className="w-4 h-4 text-[#55ddb1]" />
                          Create account
                        </Link>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-[#063f46] outline-none hover:bg-[#f7f9f7] focus:bg-[#f7f9f7]"
                        onSelect={(e) => {
                          e.preventDefault();
                          setTourOpen(true);
                        }}
                      >
                        <CircleHelp className="w-4 h-4 text-[#075B5C]" />
                        How Court Context works
                      </DropdownMenu.Item>
                    </>
                  ) : (
                    <>
                      <div className="px-3 py-2 border-b border-[#DCE9EA] mb-1">
                        <p className="text-sm font-medium text-[#063f46] truncate">{displayLabel}</p>
                        {profile?.email ? (
                          <p className="text-xs text-[#4a6366] truncate mt-0.5">{profile.email}</p>
                        ) : null}
                        <p className="type-metadata mt-1">TZ: {profile?.timezone}</p>
                      </div>
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-[#063f46] outline-none hover:bg-[#f7f9f7] focus:bg-[#f7f9f7]"
                        onSelect={(e) => {
                          e.preventDefault();
                          setTourOpen(true);
                        }}
                      >
                        <CircleHelp className="w-4 h-4 text-[#075B5C]" />
                        How Court Context works
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-[#063f46] outline-none hover:bg-[#f7f9f7] focus:bg-[#f7f9f7]"
                        asChild
                      >
                        <Link href="/betting/profile">
                          <Settings className="w-4 h-4 text-[#075B5C]" />
                          Profile & preferences
                        </Link>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-[#063f46] outline-none hover:bg-[#f7f9f7] focus:bg-[#f7f9f7]"
                        asChild
                      >
                        <Link href="/billing">
                          <Zap className="w-4 h-4 text-[#55ddb1]" />
                          Billing
                        </Link>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-[#063f46] outline-none hover:bg-[#f7f9f7] focus:bg-[#f7f9f7]"
                        onSelect={(e) => {
                          e.preventDefault();
                          void handleSignOut();
                        }}
                      >
                        <LogOut className="w-4 h-4 text-[#c2410c]" />
                        Sign out
                      </DropdownMenu.Item>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>
    </header>
  );
}
