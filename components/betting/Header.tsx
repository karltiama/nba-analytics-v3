'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { Sun, Moon, User, Zap, LogIn, LogOut, ChevronDown, Settings, Menu } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { PRIMARY_NAV } from '@/components/betting/primary-nav';

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

function NavLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'hover:text-[#00d4ff] transition-colors text-muted-foreground',
        className
      )}
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

  const displayLabel =
    profile?.displayName?.trim() ||
    profile?.username?.trim() ||
    profile?.email?.split('@')[0] ||
    'Account';

  return (
    <header className="sticky top-0 z-50 glass-card border-b border-white/5">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00d4ff] to-[#bf5af2] flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-[#39ff14] rounded-full pulse-dot" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">
                {teamName ? (
                  <>
                    <span className="neon-text-cyan">{teamAbbr || 'TEAM'}</span>
                    <span className="text-white ml-1">{teamName}</span>
                  </>
                ) : (
                  <>
                    <span className="neon-text-cyan">NBA</span>
                    <span className="text-white ml-1">Analytics</span>
                  </>
                )}
              </h1>
              <p className="text-xs text-muted-foreground -mt-0.5">
                {teamName ? 'Analytics' : 'Betting Dashboard'}
              </p>
            </div>
          </div>

          {!teamName && (
            <nav
              className="hidden md:flex items-center gap-4 text-sm"
              aria-label="Primary"
            >
              {PRIMARY_NAV.map((item) => (
                <NavLink key={item.href} href={item.href} label={item.label} />
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
                      'md:hidden p-2.5 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors',
                      'outline-none focus-visible:ring-2 focus-visible:ring-[#00d4ff]/40'
                    )}
                    aria-label="Open primary navigation"
                    aria-haspopup="menu"
                  >
                    <Menu className="w-4 h-4 text-white" aria-hidden />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    sideOffset={8}
                    align="end"
                    className={cn(
                      'min-w-[200px] rounded-xl border border-white/10 bg-zinc-950/95 backdrop-blur-md p-1 shadow-xl z-[300]',
                      'data-[state=open]:animate-in data-[state=closed]:animate-out'
                    )}
                  >
                    {PRIMARY_NAV.map((item) => (
                      <DropdownMenu.Item
                        key={item.href}
                        className="flex cursor-pointer items-center rounded-lg px-3 py-2.5 text-sm text-white outline-none hover:bg-white/10 focus:bg-white/10"
                        asChild
                      >
                        <Link href={item.href}>{item.label}</Link>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}

            <button
              type="button"
              onClick={onThemeToggle}
              className="p-2.5 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
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
                    'flex items-center gap-2 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors',
                    'outline-none focus-visible:ring-2 focus-visible:ring-[#00d4ff]/40',
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
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#ff00ff] to-[#00d4ff] flex items-center justify-center shrink-0">
                    {sessionState === 'guest' ? (
                      <LogIn className="w-4 h-4 text-white" aria-hidden />
                    ) : (
                      <User className="w-4 h-4 text-white" aria-hidden />
                    )}
                  </div>
                  {sessionState === 'loading' ? (
                    <span className="text-sm text-muted-foreground tabular-nums w-6 text-left hidden sm:inline">
                      …
                    </span>
                  ) : sessionState === 'guest' ? (
                    <span className="text-sm font-medium text-white pr-0.5 max-sm:sr-only">Sign in</span>
                  ) : (
                    <span className="text-sm font-medium text-white truncate min-w-0 max-w-[7rem] sm:max-w-[11rem] md:max-w-[15rem] text-left max-sm:hidden">
                      {displayLabel}
                    </span>
                  )}
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  sideOffset={8}
                  align="end"
                  className={cn(
                    'min-w-[240px] rounded-xl border border-white/10 bg-zinc-950/95 backdrop-blur-md p-1 shadow-xl z-[300]',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out'
                  )}
                >
                  {sessionState === 'loading' ? (
                    <div className="px-3 py-3 text-sm text-muted-foreground">Loading account…</div>
                  ) : sessionState === 'guest' ? (
                    <>
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-white outline-none hover:bg-white/10 focus:bg-white/10"
                        asChild
                      >
                        <Link href={`/login?next=${nextEncoded}`}>
                          <LogIn className="w-4 h-4 text-[#00d4ff]" />
                          Sign in
                        </Link>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-white outline-none hover:bg-white/10 focus:bg-white/10"
                        asChild
                      >
                        <Link href={`/signup?next=${nextEncoded}`}>
                          <User className="w-4 h-4 text-[#bf5af2]" />
                          Create account
                        </Link>
                      </DropdownMenu.Item>
                    </>
                  ) : (
                    <>
                      <div className="px-3 py-2 border-b border-white/10 mb-1">
                        <p className="text-sm font-medium text-white truncate">{displayLabel}</p>
                        {profile?.email ? (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{profile.email}</p>
                        ) : null}
                        <p className="text-[10px] text-muted-foreground/80 mt-1">TZ: {profile?.timezone}</p>
                      </div>
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-white outline-none hover:bg-white/10 focus:bg-white/10"
                        asChild
                      >
                        <Link href="/betting/profile">
                          <Settings className="w-4 h-4 text-[#00d4ff]" />
                          Profile & preferences
                        </Link>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-white outline-none hover:bg-white/10 focus:bg-white/10"
                        asChild
                      >
                        <Link href="/billing">
                          <Zap className="w-4 h-4 text-[#bf5af2]" />
                          Billing
                        </Link>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-white outline-none hover:bg-white/10 focus:bg-white/10"
                        onSelect={(e) => {
                          e.preventDefault();
                          void handleSignOut();
                        }}
                      >
                        <LogOut className="w-4 h-4 text-[#ff6b35]" />
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
