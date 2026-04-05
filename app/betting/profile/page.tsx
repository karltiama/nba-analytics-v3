'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SPORTSBOOK_OPTIONS } from '@/lib/onboarding/sportsbooks';

type OddsFormat = 'american' | 'decimal' | 'fractional';
type PaperMode = 'dollars' | 'units' | 'off';
type PrimaryGoal = 'find_edges' | 'track_picks' | 'learn';
type Experience = 'novice' | 'intermediate' | 'advanced';
type Risk = 'low' | 'medium' | 'high';

const labelCls =
  'block text-xs font-medium text-muted-foreground mb-1.5';
const inputCls =
  'w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-muted-foreground/60 outline-none focus:border-[#00d4ff]/50';
const selectCls = cn(inputCls, 'cursor-pointer');
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#00d4ff]/90 to-[#bf5af2]/90 px-4 py-2 text-sm font-medium text-white hover:opacity-95 disabled:opacity-50';
const cardCls = 'glass-card border border-white/10 rounded-2xl p-5 sm:p-6';

export default function BettingProfilePage() {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');

  const [sportsbook, setSportsbook] = useState('');
  const [oddsFormat, setOddsFormat] = useState<OddsFormat>('american');
  const [paperMode, setPaperMode] = useState<PaperMode>('units');
  const [primaryGoal, setPrimaryGoal] = useState<PrimaryGoal | ''>('');
  const [experience, setExperience] = useState<Experience | ''>('');
  const [risk, setRisk] = useState<Risk | ''>('');
  const [bankroll, setBankroll] = useState('');
  const [minEdge, setMinEdge] = useState('');
  const [favoriteTeams, setFavoriteTeams] = useState('');
  const [notifications, setNotifications] = useState(false);

  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [prefsMsg, setPrefsMsg] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const [pr, sr] = await Promise.all([
        fetch('/api/user/profile', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/user/settings', { credentials: 'include', cache: 'no-store' }),
      ]);
      if (pr.status === 401 || sr.status === 401) {
        setLoadError('You need to sign in again.');
        return;
      }
      if (!pr.ok) {
        setLoadError('Could not load profile.');
        return;
      }
      if (!sr.ok) {
        setLoadError('Could not load preferences.');
        return;
      }
      const pj = (await pr.json()) as {
        profile?: {
          displayName?: string | null;
          username?: string | null;
          email?: string | null;
          timezone?: string;
        };
      };
      const sj = (await sr.json()) as {
        settings?: {
          preferredSportsbook?: string | null;
          oddsFormat?: string | null;
          paperDisplayMode?: string | null;
          primaryGoal?: string | null;
          experienceLevel?: string | null;
          bankroll?: number | null;
          riskTolerance?: Risk | null;
          minEdgePercent?: number | null;
          favoriteTeams?: string[];
          notificationEnabled?: boolean;
        };
      };
      const p = pj.profile;
      const s = sj.settings;
      if (p) {
        setEmail(p.email ?? '');
        setDisplayName(p.displayName ?? '');
        setUsername(p.username ?? '');
        setTimezone(p.timezone || 'America/New_York');
      }
      if (s) {
        setSportsbook(s.preferredSportsbook ?? '');
        if (s.oddsFormat === 'american' || s.oddsFormat === 'decimal' || s.oddsFormat === 'fractional') {
          setOddsFormat(s.oddsFormat);
        }
        if (s.paperDisplayMode === 'dollars' || s.paperDisplayMode === 'units' || s.paperDisplayMode === 'off') {
          setPaperMode(s.paperDisplayMode);
        }
        setPrimaryGoal(
          s.primaryGoal === 'find_edges' || s.primaryGoal === 'track_picks' || s.primaryGoal === 'learn'
            ? s.primaryGoal
            : ''
        );
        setExperience(
          s.experienceLevel === 'novice' || s.experienceLevel === 'intermediate' || s.experienceLevel === 'advanced'
            ? s.experienceLevel
            : ''
        );
        setRisk(s.riskTolerance === 'low' || s.riskTolerance === 'medium' || s.riskTolerance === 'high' ? s.riskTolerance : '');
        setBankroll(s.bankroll != null && Number.isFinite(s.bankroll) ? String(s.bankroll) : '');
        setMinEdge(s.minEdgePercent != null && Number.isFinite(s.minEdgePercent) ? String(s.minEdgePercent) : '');
        setFavoriteTeams((s.favoriteTeams ?? []).join(', '));
        setNotifications(Boolean(s.notificationEnabled));
      }
    } catch {
      setLoadError('Network error while loading.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProfile = useCallback(async () => {
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          username: username.trim() ? username.trim() : null,
          timezone: timezone.trim() || 'America/New_York',
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setProfileMsg(typeof data.error === 'string' ? data.error : 'Could not save profile.');
        return;
      }
      setProfileMsg('Profile saved.');
    } catch {
      setProfileMsg('Network error.');
    } finally {
      setSavingProfile(false);
    }
  }, [displayName, username, timezone]);

  const savePreferences = useCallback(async () => {
    setPrefsMsg(null);
    setSavingPrefs(true);
    try {
      const bankrollNum = bankroll.trim() === '' ? null : Number(bankroll);
      const edgeNum = minEdge.trim() === '' ? null : Number(minEdge);
      const teams = favoriteTeams
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 50);
      const body: Record<string, unknown> = {
        preferredSportsbook: sportsbook.trim() || null,
        oddsFormat,
        paperDisplayMode: paperMode,
        primaryGoal: primaryGoal || null,
        experienceLevel: experience || null,
        riskTolerance: risk || null,
        bankroll: bankrollNum != null && Number.isFinite(bankrollNum) ? bankrollNum : null,
        minEdgePercent: edgeNum != null && Number.isFinite(edgeNum) ? edgeNum : null,
        favoriteTeams: teams,
        notificationEnabled: notifications,
      };
      const res = await fetch('/api/user/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setPrefsMsg(typeof data.error === 'string' ? data.error : 'Could not save preferences.');
        return;
      }
      setPrefsMsg('Preferences saved.');
    } catch {
      setPrefsMsg('Network error.');
    } finally {
      setSavingPrefs(false);
    }
  }, [
    sportsbook,
    oddsFormat,
    paperMode,
    primaryGoal,
    experience,
    risk,
    bankroll,
    minEdge,
    favoriteTeams,
    notifications,
  ]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span className="text-sm">Loading profile…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <p className="text-sm text-white mb-4">{loadError}</p>
        <Link href="/login?next=%2Fbetting%2Fprofile" className="text-sm text-[#00d4ff] hover:underline">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 pb-16">
      <Link
        href="/betting"
        className="text-sm text-muted-foreground hover:text-white transition-colors inline-block mb-6"
      >
        ← Back to betting
      </Link>

      <h1 className="text-2xl font-bold text-white tracking-tight mb-1">Profile & preferences</h1>
      <p className="text-sm text-muted-foreground mb-8">Update how you appear and how odds and paper trading are shown.</p>

      <section className={cn(cardCls, 'mb-6')}>
        <h2 className="text-sm font-semibold text-white mb-4">Account</h2>
        {email ? (
          <p className="text-xs text-muted-foreground mb-4">
            Signed in as <span className="text-white/90">{email}</span>
          </p>
        ) : null}
        <div className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="displayName">
              Display name
            </label>
            <input
              id="displayName"
              className={inputCls}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How we greet you"
              maxLength={80}
              autoComplete="nickname"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className={inputCls}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Unique handle (optional)"
              maxLength={30}
              autoComplete="username"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="timezone">
              Timezone
            </label>
            <input
              id="timezone"
              className={inputCls}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/New_York"
              maxLength={80}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">IANA name, e.g. America/Los_Angeles</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" className={btnPrimary} onClick={() => void saveProfile()} disabled={savingProfile}>
            {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save account
          </button>
          {profileMsg ? (
            <span className={cn('text-xs', profileMsg.includes('saved') ? 'text-emerald-400' : 'text-amber-400')}>
              {profileMsg}
            </span>
          ) : null}
        </div>
      </section>

      <section className={cardCls}>
        <h2 className="text-sm font-semibold text-white mb-4">Betting preferences</h2>
        <div className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="sportsbook">
              Preferred sportsbook
            </label>
            <input
              id="sportsbook"
              className={inputCls}
              list="sportsbook-suggestions"
              value={sportsbook}
              onChange={(e) => setSportsbook(e.target.value)}
              placeholder="DraftKings, FanDuel, …"
              maxLength={60}
            />
            <datalist id="sportsbook-suggestions">
              {SPORTSBOOK_OPTIONS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls} htmlFor="oddsFormat">
                Odds format
              </label>
              <select
                id="oddsFormat"
                className={selectCls}
                value={oddsFormat}
                onChange={(e) => setOddsFormat(e.target.value as OddsFormat)}
              >
                <option value="american">American</option>
                <option value="decimal">Decimal</option>
                <option value="fractional">Fractional</option>
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="paperMode">
                Paper display
              </label>
              <select
                id="paperMode"
                className={selectCls}
                value={paperMode}
                onChange={(e) => setPaperMode(e.target.value as PaperMode)}
              >
                <option value="dollars">Dollars</option>
                <option value="units">Units</option>
                <option value="off">Off</option>
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls} htmlFor="primaryGoal">
                Primary goal
              </label>
              <select
                id="primaryGoal"
                className={selectCls}
                value={primaryGoal}
                onChange={(e) => setPrimaryGoal(e.target.value as PrimaryGoal | '')}
              >
                <option value="">Not set</option>
                <option value="find_edges">Find edges</option>
                <option value="track_picks">Track picks</option>
                <option value="learn">Learn & explore</option>
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="experience">
                Experience
              </label>
              <select
                id="experience"
                className={selectCls}
                value={experience}
                onChange={(e) => setExperience(e.target.value as Experience | '')}
              >
                <option value="">Not set</option>
                <option value="novice">Novice</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls} htmlFor="risk">
                Risk tolerance
              </label>
              <select id="risk" className={selectCls} value={risk} onChange={(e) => setRisk(e.target.value as Risk | '')}>
                <option value="">Not set</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="bankroll">
                Bankroll (reference)
              </label>
              <input
                id="bankroll"
                type="number"
                min={0}
                step="0.01"
                className={inputCls}
                value={bankroll}
                onChange={(e) => setBankroll(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="minEdge">
              Minimum edge % (reference)
            </label>
            <input
              id="minEdge"
              type="number"
              min={-100}
              max={100}
              step="0.1"
              className={inputCls}
              value={minEdge}
              onChange={(e) => setMinEdge(e.target.value)}
              placeholder="e.g. 2 for 2%"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="teams">
              Favorite teams
            </label>
            <input
              id="teams"
              className={inputCls}
              value={favoriteTeams}
              onChange={(e) => setFavoriteTeams(e.target.value)}
              placeholder="LAL, BOS, … (comma-separated)"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-white/90">
            <input
              type="checkbox"
              className="rounded border-white/20 bg-black/40 text-[#00d4ff] focus:ring-[#00d4ff]/40"
              checked={notifications}
              onChange={(e) => setNotifications(e.target.checked)}
            />
            Notifications enabled
          </label>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" className={btnPrimary} onClick={() => void savePreferences()} disabled={savingPrefs}>
            {savingPrefs ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save preferences
          </button>
          {prefsMsg ? (
            <span className={cn('text-xs', prefsMsg.includes('saved') ? 'text-emerald-400' : 'text-amber-400')}>
              {prefsMsg}
            </span>
          ) : null}
        </div>
      </section>
    </main>
  );
}
