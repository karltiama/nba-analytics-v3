'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { User, Zap, LogIn, LogOut, ChevronDown, Settings, Menu, CircleHelp } from 'lucide-react';
import { signOutToLogin } from '@/lib/auth/logout';
import { PROFILE_UPDATED_EVENT } from '@/lib/auth/profile-events';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { PRIMARY_NAV } from '@/components/betting/primary-nav';
import { ProductTourDialog } from '@/components/onboarding/ProductTourDialog';
import {
  contextualWorkspaceNavAriaLabel,
} from '@/lib/parlay/preview-fixture';
import { PARLAY_WORKSPACE_HREF } from '@/lib/parlay/selection';
import { useParlaySelection } from '@/lib/parlay/use-parlay-selection';

interface HeaderProps {
  teamName?: string;
  teamAbbr?: string;
}

type ProfilePayload = {
  displayName: string | null;
  username: string | null;
  email: string | null;
  timezone: string;
};

/**
 * Last account this browser tab resolved. Client-only: it is written from effects, never on the server,
 * so the first server render and hydration both start from null.
 */
let accountCache: { userId: string; profile: ProfilePayload; loaded: boolean } | null = null;

function navItemActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function selectedLegCount(href: string, legCount: number): number | null {
  return href === PARLAY_WORKSPACE_HREF && legCount > 0 ? legCount : null;
}

function NavLink({
  href,
  label,
  active,
  className,
  legCount,
}: {
  href: string;
  label: string;
  active?: boolean;
  className?: string;
  legCount: number;
}) {
  const count = selectedLegCount(href, legCount);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      aria-label={count != null ? contextualWorkspaceNavAriaLabel(count) : undefined}
      className={cn(
        'transition-colors',
        active ? 'text-[#063f46] font-semibold' : 'text-[#4a6366] hover:text-[#063f46]',
        className
      )}
    >
      {label}
      {count != null ? (
        <span className="ml-1 tabular-nums" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

export function Header({ teamName, teamAbbr }: HeaderProps) {
  const pathname = usePathname() || '/dashboard';
  const nextEncoded = encodeURIComponent(pathname);
  const { legs } = useParlaySelection();

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  // Each section layout mounts its own Header, so seed from the last account this tab saw.
  const [sessionState, setSessionState] = useState<'loading' | 'guest' | 'user'>(() =>
    accountCache ? 'user' : 'loading'
  );
  const [profile, setProfile] = useState<ProfilePayload | null>(() => accountCache?.profile ?? null);
  const [profileLoaded, setProfileLoaded] = useState(() => accountCache?.loaded ?? false);
  const [tourOpen, setTourOpen] = useState(false);
  const userIdRef = useRef<string | null>(accountCache?.userId ?? null);

  /**
   * Signed-in UI follows getUser, the same check the proxy uses. Profile API only enriches fields.
   * Keeps the last known profile for the same user while it refreshes, so the label never drops
   * back to the email prefix mid-session.
   */
  const syncAccount = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) {
      accountCache = null;
      userIdRef.current = null;
      setSessionState('guest');
      setProfile(null);
      setProfileLoaded(false);
      return;
    }

    const sessionEmail = user.email ?? null;
    if (userIdRef.current !== user.id) {
      userIdRef.current = user.id;
      const seed = { displayName: null, username: null, email: sessionEmail, timezone: 'America/New_York' };
      accountCache = { userId: user.id, profile: seed, loaded: false };
      setProfile(seed);
      setProfileLoaded(false);
    }
    setSessionState('user');

    try {
      const res = await fetch('/api/user/profile', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { profile?: ProfilePayload };
      const p = body.profile;
      if (!p || userIdRef.current !== user.id) return;
      const next = {
        displayName: p.displayName ?? null,
        username: p.username ?? null,
        email: p.email ?? sessionEmail,
        timezone: p.timezone ?? 'America/New_York',
      };
      accountCache = { userId: user.id, profile: next, loaded: true };
      setProfile(next);
      setProfileLoaded(true);
    } catch {
      // keep the last known profile
    } finally {
      if (userIdRef.current === user.id) setProfileLoaded(true);
    }
  }, [supabase]);

  useEffect(() => {
    void syncAccount();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      // INITIAL_SESSION duplicates the mount sync; token refreshes don't change who is signed in.
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      void syncAccount();
    });
    const onProfileUpdated = () => void syncAccount();
    window.addEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
    };
  }, [supabase, syncAccount]);

  const handleSignOut = useCallback(async () => {
    accountCache = null;
    userIdRef.current = null;
    setSessionState('guest');
    setProfile(null);
    const next = await signOutToLogin(() => supabase.auth.signOut());
    window.location.assign(next);
  }, [supabase]);

  const namedLabel = profile?.displayName?.trim() || profile?.username?.trim() || null;
  // Email prefix only once the profile has answered with no name; before that, a neutral placeholder.
  const displayLabel = namedLabel || (profileLoaded ? profile?.email?.split('@')[0] || 'Account' : null);

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
              <p className="type-metadata -mt-0.5 hidden md:block">
                {teamName ? 'Analytics' : 'Betting Dashboard'}
              </p>
            </div>
          </div>

          {!teamName && (
            <nav
              className="hidden lg:flex items-center gap-3 lg:gap-4 text-sm"
              aria-label="Primary"
            >
              {PRIMARY_NAV.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  active={navItemActive(pathname, item.href)}
                  legCount={legs.length}
                />
              ))}
            </nav>
          )}

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            {!teamName && (
                <DropdownMenu.Root modal={false}>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'lg:hidden p-2.5 rounded-xl bg-white border border-[#DCE9EA] hover:bg-[#f7f9f7] transition-colors',
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
                      {PRIMARY_NAV.map((item) => {
                        const count = selectedLegCount(item.href, legs.length);
                        const active = navItemActive(pathname, item.href);
                        return (
                          <DropdownMenu.Item
                            key={item.href}
                            className="flex cursor-pointer items-center rounded-lg px-3 py-2.5 text-sm text-[#063f46] outline-none hover:bg-[#f7f9f7] focus:bg-[#f7f9f7]"
                            asChild
                          >
                            <Link
                              href={item.href}
                              aria-current={active ? 'page' : undefined}
                              aria-label={count != null ? contextualWorkspaceNavAriaLabel(count) : undefined}
                            >
                              {item.label}
                              {count != null ? (
                                <span className="ml-1 tabular-nums" aria-hidden="true">
                                  {count}
                                </span>
                              ) : null}
                            </Link>
                          </DropdownMenu.Item>
                        );
                      })}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
            )}

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
                      ? `Account menu for ${displayLabel ?? 'your account'}`
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
                    displayLabel ? (
                      <span className="text-sm font-medium text-[#063f46] truncate min-w-0 max-w-[7rem] sm:max-w-[11rem] md:max-w-[15rem] text-left max-sm:hidden">
                        {displayLabel}
                      </span>
                    ) : (
                      <span className="h-4 w-20 animate-pulse rounded bg-[#E8F0F1] max-sm:hidden" aria-hidden />
                    )
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
                          <p className="type-metadata truncate mt-0.5">{profile.email}</p>
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
