'use client';

import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { LandingSection } from '@/components/landing/LandingSection';
import { LandingSectionHeader } from '@/components/landing/LandingSectionHeader';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
import { WowyResults } from '@/app/wowy/WowyResults';
import {
  findLandingWowyScenario,
  LANDING_WOWY_DEMO_SCENARIOS,
} from '@/lib/landing/wowy-demo';

const selectClass =
  'w-full rounded-lg border border-[#DCE9EA] bg-white px-3 py-2 text-sm text-[#063f46]';

/**
 * Landing marketing preview of game-level WOWY.
 * Reuses WowyResults (same as /wowy) with a classify→summarize fixture — no live pair API.
 */
export function WowyImpactSection() {
  const [scenarioId, setScenarioId] = useState(LANDING_WOWY_DEMO_SCENARIOS[0].id);
  const [drill, setDrill] = useState<'with' | 'without'>('with');
  const [view, setView] = useState<'perGame' | 'perMinute'>('perGame');

  const scenario = findLandingWowyScenario(scenarioId);
  const drillGames = useMemo(
    () => scenario.summary.classifiedGames.filter((g) => g.bucket === drill),
    [drill, scenario.summary.classifiedGames]
  );

  return (
    <LandingSection
      className="slide-up"
      style={{ animationDelay: '610ms' }}
      aria-labelledby="landing-wowy-impact-heading"
    >
      <LandingSectionHeader
        id="landing-wowy-impact-heading"
        icon={Users}
        accent="cyan"
        variant="watermark"
        title="WOWY Impact"
        description="Sample game-level split — illustration only, not a live pair load."
        href="/wowy"
        linkLabel="Open WOWY"
      />

      <p
        className="rounded-xl border border-amber-200 bg-[#fff8ee] px-4 py-3 text-sm text-[#9a3412] mb-5"
        role="status"
      >
        Design preview — fictional layout data built through the same WOWY summarize path. Historical context only, not a guarantee of what happens next.
      </p>

      <div className="space-y-6">
        <header className="flex flex-col lg:flex-row lg:items-end gap-6">
          <div className="flex-1 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8aa0a3]">
              Game-level WOWY
            </p>
            <h3 className="text-4xl sm:text-5xl font-black tracking-tight">
              <span className="text-[#55ddb1]">WOWY</span>{' '}
              <span className="text-[#063f46]">Impact</span>
            </h3>
            <p className="text-sm text-[#4a6366] max-w-2xl">
              See how a player&apos;s box moved in games a teammate appeared versus games with a verified did-not-play roster row. This is game-level participation, not shared-court possessions. A selected teammate is not implied to be injured.
            </p>
          </div>
          <div className="flex items-center gap-4 bg-white border border-[#DCE9EA] rounded-2xl px-4 py-3 min-w-[240px]">
            <PlayerHeadshot
              nbaPlayerId={scenario.subjectNbaId}
              name={scenario.subjectName}
              className="relative w-16 h-20 rounded-xl overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0"
            />
            <div>
              <p className="text-base font-bold text-[#063f46]">{scenario.subjectName}</p>
              <p className="text-xs text-[#4a6366]">
                PG · {scenario.summary.team.abbreviation}
              </p>
            </div>
          </div>
        </header>

        <section className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[#4a6366]">Player</span>
              <select
                className={selectClass}
                value={scenarioId}
                onChange={(e) => {
                  setScenarioId(e.target.value);
                  setDrill('with');
                  setView('perGame');
                }}
                aria-label="Select sample WOWY player pair"
              >
                {LANDING_WOWY_DEMO_SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.subjectName}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[#4a6366]">Season</span>
              <select className={selectClass} value={scenario.seasonLabel} disabled>
                <option>{scenario.seasonLabel}</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[#4a6366]">Team stint</span>
              <select className={selectClass} value={scenario.teamLabel} disabled>
                <option>{scenario.teamLabel}</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[#4a6366]">Season type</span>
              <select className={selectClass} value={scenario.seasonTypeLabel} disabled>
                <option>{scenario.seasonTypeLabel}</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[#4a6366]">Teammate</span>
              <div className="flex items-center gap-2">
                <PlayerHeadshot
                  nbaPlayerId={scenario.teammateNbaId}
                  name={scenario.teammateName}
                  className="relative w-9 h-11 rounded-lg overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0"
                />
                <select className={selectClass} value={scenario.teammateName} disabled>
                  <option>{scenario.teammateName}</option>
                </select>
              </div>
            </label>

            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-[#4a6366]">Stat view</span>
              <div className="flex rounded-lg border border-[#DCE9EA] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setView('perGame')}
                  className={`flex-1 px-3 py-2 text-sm font-semibold ${
                    view === 'perGame' ? 'bg-[#063f46] text-white' : 'bg-white text-[#4a6366]'
                  }`}
                >
                  Per game
                </button>
                <button
                  type="button"
                  onClick={() => setView('perMinute')}
                  className={`flex-1 px-3 py-2 text-sm font-semibold ${
                    view === 'perMinute' ? 'bg-[#063f46] text-white' : 'bg-white text-[#4a6366]'
                  }`}
                >
                  Per minute
                </button>
              </div>
            </div>
          </div>
        </section>

        <WowyResults
          summary={scenario.summary}
          drill={drill}
          onDrill={setDrill}
          drillGames={drillGames}
          subjectNbaId={scenario.subjectNbaId}
          teammateNbaId={scenario.teammateNbaId}
          view={view}
          onView={setView}
          linkGames={false}
        />
      </div>
    </LandingSection>
  );
}
