'use client';

import Link from 'next/link';
import { Sun, Moon, User, Zap } from 'lucide-react';

interface HeaderProps {
  isDarkMode: boolean;
  onThemeToggle: () => void;
  teamName?: string;
  teamAbbr?: string;
}

export function Header({ isDarkMode, onThemeToggle, teamName, teamAbbr }: HeaderProps) {
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
            <nav className="hidden md:flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/betting" className="hover:text-white transition-colors">
                Dashboard
              </Link>
              <Link href="/betting/props-explorer" className="hover:text-[#00d4ff] transition-colors">
                Props Explorer
              </Link>
              <Link href="/betting/research" className="hover:text-[#00d4ff]/90 transition-colors text-muted-foreground">
                Research
              </Link>
              <Link href="/betting/paper" className="hover:text-[#00d4ff]/90 transition-colors text-muted-foreground">
                Paper
              </Link>
            </nav>
          )}

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <button
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

            {/* User Account */}
            <button
              className="flex items-center gap-2 p-2 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
              aria-label="User account"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#ff00ff] to-[#00d4ff] flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

