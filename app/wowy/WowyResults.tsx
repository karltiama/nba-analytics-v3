'use client';

import Link from 'next/link';
import { BarChart3, ShieldAlert, Sparkles } from 'lucide-react';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
import { gameDetailHref } from '@/lib/betting/research-journey';
import { buildWowyInsights, wowyChartStats, wowyDiffPolarity } from '@/lib/wowy/insights';
import { wowyShowsComparisonHero } from '@/lib/wowy/policy';
import type { WowyClassifiedGame, WowyPairSummary, WowyRateStatKey, WowyStatKey } from '@/lib/wowy/types';
import { WOWY_STAT_KEYS } from '@/lib/wowy/types';

const STAT_LABEL: Record<WowyStatKey, string> = {
  minutes: 'MIN',
  pts: 'PTS',
  oppPts: 'Opp PTS',
  reb: 'REB',
  ast: 'AST',
  tpm: '3PM',
  fga: 'FGA',
  tpa: '3PA',
  fta: 'FTA',
};

function fmt(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function signed(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
}

function rateFmt(group: WowyPairSummary['with'], key: WowyStatKey): string {
  if (key === 'minutes' || key === 'oppPts') return '—';
  return fmt(group.perMinute[key], 3);
}

function coverageRange(group: WowyPairSummary['with']): string {
  if (!group.dateCoverage.first || !group.dateCoverage.last) return '—';
  return `${group.dateCoverage.first} → ${group.dateCoverage.last}`;
}

function splitCardBlurb(summary: WowyPairSummary, side: 'with' | 'without'): string {
  const self = summary.mode === 'subject';
  const subject = summary.subject.fullName;
  const teammate = summary.teammate?.fullName ?? subject;
  const team = summary.team?.fullName ?? 'the team';
  if (self) {
    return side === 'with'
      ? `When ${subject} appeared, ${team} averaged…`
      : `When ${subject} had a verified DNP, ${team} averaged…`;
  }
  return side === 'with'
    ? `When ${teammate} played, ${subject} averaged…`
    : `When ${teammate} had a verified DNP, ${subject} averaged…`;
}

export function WowyResults({
  summary,
  drill,
  onDrill,
  drillGames,
  subjectNbaId,
  teammateNbaId,
  view,
  onView,
  linkGames = true,
}: {
  summary: WowyPairSummary;
  drill: 'with' | 'without';
  onDrill: (value: 'with' | 'without') => void;
  drillGames: WowyClassifiedGame[];
  subjectNbaId?: string | null;
  teammateNbaId?: string | null;
  view: 'perGame' | 'perMinute';
  onView: (value: 'perGame' | 'perMinute') => void;
  /** Landing/demo previews pass false so fictional game ids are not deep-linked. */
  linkGames?: boolean;
}) {
  const blocked = !wowyShowsComparisonHero(summary.support.tier);
  const low = summary.support.tier === 'low_support';
  const insights = buildWowyInsights(summary);
  const chartStats = wowyChartStats(summary.mode);
  const splitName =
    summary.mode === 'subject' ? summary.subject.fullName : (summary.teammate?.fullName ?? summary.subject.fullName);
  const self = summary.mode === 'subject';
  const effectiveView = self ? 'perGame' : view;
  const splitNbaId = self ? subjectNbaId : teammateNbaId;

  return (
    <section className="space-y-6">
      <div
        className={`rounded-2xl border px-4 py-3 text-sm ${
          blocked || low ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-[#DCE9EA] bg-white text-[#4a6366]'
        }`}
        role="status"
      >
        {low ? <p className="type-badge text-[#063f46]">Low support</p> : null}
        {blocked ? <p className="type-badge text-[#063f46]">Insufficient sample</p> : null}
        <p className="type-body">
          <span className="font-semibold text-[#063f46]">Sample size · </span>
          {self ? `When ${splitName} appeared` : `When ${splitName} played`}: {summary.with.gameCount} games · When{' '}
          {splitName} had a verified DNP: {summary.without.gameCount} games
        </p>
        <p className="type-metadata mt-1">
          Appeared {coverageRange(summary.with)} · Verified DNP {coverageRange(summary.without)}
        </p>
        <p className="type-secondary mt-1">{summary.support.label}</p>
      </div>

      {blocked ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-5 space-y-2" role="status">
          <h2 className="type-section-heading text-[#063f46]">Not a comparable WITH / WITHOUT split</h2>
          <p className="type-body text-cc-secondary">
            Need at least 2 appeared games and 2 verified-DNP games before showing numeric comparison cards. Raw
            eligible games remain in the drill-down below. Games without a verified teammate participation row are
            excluded rather than counted as WITHOUT.
          </p>
          <p className="type-card-data text-[#063f46]">
            {summary.with.gameCount} appeared · {summary.without.gameCount} verified DNP
            {summary.unknownMembershipCount > 0
              ? ` · ${summary.unknownMembershipCount} excluded unknown membership`
              : ''}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {chartStats.map((stat) => {
            const diff = summary.diff.absolutePerGame[stat.key];
            const withVal = summary.with.perGame[stat.key];
            const withoutVal = summary.without.perGame[stat.key];
            const polarity = wowyDiffPolarity(stat.key, diff);
            const color =
              polarity === 'favorable'
                ? 'text-[#075B5C]'
                : polarity === 'unfavorable'
                  ? 'text-[#c45c4a]'
                  : 'text-[#063f46]';
            return (
              <div key={stat.key} className="bg-white border border-[#DCE9EA] rounded-2xl p-3">
                <p className="type-metadata">{stat.label} / game</p>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{signed(diff)}</p>
                <p className="type-table-data mt-1 whitespace-nowrap">
                  {fmt(withVal)} appeared · {fmt(withoutVal)} verified DNP
                </p>
                {stat.key === 'oppPts' && polarity !== 'neutral' ? (
                  <p className="type-secondary mt-1">
                    {polarity === 'unfavorable' ? 'Unfavorable (higher opponent scoring)' : 'Favorable (lower opponent scoring)'}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px] gap-4">
        {!blocked ? (
          <>
            <SplitTable
              title={self ? `When ${splitName} appeared` : `When ${splitName} played`}
              accent="with"
              blurb={splitCardBlurb(summary, 'with')}
              summary={summary}
              side="with"
              nbaPlayerId={splitNbaId}
              splitName={splitName}
              view={effectiveView}
            />
            <SplitTable
              title={`When ${splitName} had a verified DNP`}
              accent="without"
              blurb={splitCardBlurb(summary, 'without')}
              note="Verified did-not-play roster rows in historical player game logs. Not labeled as injury."
              summary={summary}
              side="without"
              nbaPlayerId={splitNbaId}
              splitName={splitName}
              view={effectiveView}
            />
          </>
        ) : null}
        <aside className={`bg-white border border-[#DCE9EA] rounded-2xl p-4 sm:p-5 space-y-4 ${blocked ? 'xl:col-span-3' : 'xl:row-span-2'}`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="type-section-heading flex items-center gap-2 text-[#063f46]">
              <Sparkles className="w-4 h-4 text-[#075B5C]" aria-hidden />
              Insights
            </h2>
          </div>
          <ul className="space-y-3">
            {insights.map((insight) => (
              <li
                key={insight.id}
                className={`rounded-xl p-3 ${
                  insight.tone === 'caution'
                    ? 'bg-amber-50'
                    : insight.tone === 'down'
                      ? 'bg-[#fdf3f1]'
                      : 'bg-[#f7f9f7]'
                }`}
              >
                <p className="type-secondary text-[#063f46]">{insight.title}</p>
                <p className="type-body mt-1 text-cc-secondary">{insight.body}</p>
              </li>
            ))}
          </ul>
        </aside>

        {!blocked && (
          <div className="xl:col-span-2 bg-white border border-[#DCE9EA] rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="type-section-heading mr-auto flex items-center gap-2 text-[#063f46]">
                <BarChart3 className="w-4 h-4 text-[#075B5C]" aria-hidden />
                Key metric comparison
              </h2>
              <div className="type-metadata flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#075B5C]" /> {self ? 'Appeared' : 'Played'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#e08a7a]" /> Verified DNP
                </span>
              </div>
              {!self ? (
                <div className="flex overflow-hidden rounded-lg border border-[#DCE9EA]">
                  <button
                    type="button"
                    onClick={() => onView('perGame')}
                    className={`type-interactive px-3 py-1.5 ${view === 'perGame' ? 'bg-[#063f46] text-white' : 'bg-white text-[#4a6366]'}`}
                  >
                    Per game
                  </button>
                  <button
                    type="button"
                    onClick={() => onView('perMinute')}
                    className={`type-interactive px-3 py-1.5 ${view === 'perMinute' ? 'bg-[#063f46] text-white' : 'bg-white text-[#4a6366]'}`}
                  >
                    Per minute
                  </button>
                </div>
              ) : null}
            </div>
            <p className="type-secondary">
              {self
                ? 'Team counting stats in games this player appeared versus verified DNP. Not per 100 possessions, and not a causal effect.'
                : 'Descriptive appeared − verified DNP only. Not a causal effect, and not per 100 possessions.'}
            </p>
            <ComparisonChart summary={summary} view={effectiveView} />
          </div>
        )}
      </div>

      <div className="bg-[#f7f9f7] border border-dashed border-[#DCE9EA] rounded-2xl p-4 sm:p-5 flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-cc-secondary" aria-hidden />
        <div>
          <h2 className="type-section-heading text-[#063f46]">Top 5 lineup combinations</h2>
          <p className="type-body mt-1 text-cc-secondary">
            Coming later. This page is game-level played/missed, not five-man stints or shared-court possessions, so
            lineup combinations are not computed here.
          </p>
        </div>
      </div>

      <div className="bg-white border border-[#DCE9EA] rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-b border-[#DCE9EA]">
          <h2 className="type-section-heading mr-auto text-[#063f46]">Game-log drill-down</h2>
          <button
            type="button"
            onClick={() => onDrill('with')}
            className={`type-interactive rounded-lg px-3 py-1.5 ${
              drill === 'with' ? 'bg-[#063f46] text-white' : 'bg-[#f7f9f7] text-[#4a6366]'
            }`}
          >
            Appeared ({summary.with.gameCount})
          </button>
          <button
            type="button"
            onClick={() => onDrill('without')}
            className={`type-interactive rounded-lg px-3 py-1.5 ${
              drill === 'without' ? 'bg-[#063f46] text-white' : 'bg-[#f7f9f7] text-[#4a6366]'
            }`}
          >
            Verified DNP ({summary.without.gameCount})
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="type-metadata bg-[#f7f9f7]">
              <tr>
                <th className="text-left font-medium px-4 py-2">Date</th>
                <th className="text-left font-medium px-4 py-2">Opp</th>
                {self ? (
                  <>
                    <th className="text-right font-medium px-4 py-2">PTS</th>
                    <th className="text-right font-medium px-4 py-2">Opp PTS</th>
                    <th className="text-right font-medium px-4 py-2">REB</th>
                    <th className="text-right font-medium px-4 py-2">AST</th>
                    <th className="text-right font-medium px-4 py-2">3PM</th>
                    <th className="text-right font-medium px-4 py-2">FGA</th>
                  </>
                ) : (
                  <>
                    <th className="text-right font-medium px-4 py-2">MIN</th>
                    <th className="text-right font-medium px-4 py-2">PTS</th>
                    <th className="text-right font-medium px-4 py-2">REB</th>
                    <th className="text-right font-medium px-4 py-2">AST</th>
                    <th className="text-right font-medium px-4 py-2">3PM</th>
                    <th className="text-right font-medium px-4 py-2">FGA</th>
                  </>
                )}
                <th className="text-left font-medium px-4 py-2">Game ID</th>
              </tr>
            </thead>
            <tbody className="type-table-data text-[#063f46]">
              {drillGames.map((g) => (
                <tr key={g.gameId} className="border-t border-[#DCE9EA]">
                  <td className="px-4 py-2 tabular-nums">{g.basketballDateEt}</td>
                  <td className="px-4 py-2">{g.opponentAbbr ?? '—'}</td>
                  {self ? (
                    <>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.pts, 0)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.oppPts, 0)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.reb, 0)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.ast, 0)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.tpm, 0)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.fga, 0)}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.minutes, 0)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.pts, 0)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.reb, 0)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.ast, 0)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.tpm, 0)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(g.subject.stats.fga, 0)}</td>
                    </>
                  )}
                  <td className="px-4 py-2">
                    {linkGames ? (
                      <Link href={gameDetailHref(g.gameId)} className="type-interactive font-mono text-[#075B5C] hover:underline">
                        {g.gameId}
                      </Link>
                    ) : (
                      <span className="type-metadata font-mono">{g.gameId}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SplitTable({
  title,
  accent,
  blurb,
  note,
  summary,
  side,
  nbaPlayerId,
  splitName,
  view,
}: {
  title: string;
  accent: 'with' | 'without';
  blurb: string;
  note?: string;
  summary: WowyPairSummary;
  side: 'with' | 'without';
  nbaPlayerId?: string | null;
  splitName: string;
  view: 'perGame' | 'perMinute';
}) {
  const group = summary[side];
  const self = summary.mode === 'subject';
  const rows = WOWY_STAT_KEYS.filter((key) => {
    if (self) return key !== 'minutes';
    if (key === 'oppPts') return false;
    return view === 'perGame' ? true : key !== 'minutes';
  });
  return (
    <div className="bg-white border border-[#DCE9EA] rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex items-start gap-3">
        <PlayerHeadshot
          nbaPlayerId={nbaPlayerId}
          name={splitName}
          className="relative w-12 h-14 rounded-xl overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0"
        />
        <div>
          <h2 className={`type-section-heading ${accent === 'with' ? 'text-[#075B5C]' : 'text-[#c45c4a]'}`}>
            {title}
          </h2>
          <p className="type-secondary">{blurb}</p>
          {note ? <p className="type-metadata mt-1">{note}</p> : null}
        </div>
      </div>
      <p className="type-secondary text-[#063f46]">
        <span className="type-card-data whitespace-nowrap">{group.gameCount}</span> games
        {!self ? (
          <>
            {' '}
            · <span className="tabular-nums">{fmt(group.totalMinutes, 0)}</span> total minutes
          </>
        ) : null}
      </p>
      <table className="w-full">
        <thead>
          <tr className="type-metadata">
            <th className="text-left font-medium py-1">Stat</th>
            <th className="text-right font-medium py-1">{view === 'perGame' ? 'Value' : 'Per min'}</th>
          </tr>
        </thead>
        <tbody className="type-table-data">
          {rows.map((key) => (
            <tr key={key} className="border-t border-[#DCE9EA]">
              <td className="py-1.5 text-[#4a6366]">{STAT_LABEL[key]}</td>
              <td className="py-1.5 text-right tabular-nums font-semibold text-[#063f46]">
                {view === 'perGame' ? fmt(group.perGame[key]) : rateFmt(group, key)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonChart({
  summary,
  view,
}: {
  summary: WowyPairSummary;
  view: 'perGame' | 'perMinute';
}) {
  const rows = wowyChartStats(summary.mode)
    .filter((stat) => (view === 'perMinute' ? stat.key !== 'minutes' : true))
    .map((stat) => {
      const withVal = chartValue(summary.with, stat.key, view);
      const withoutVal = chartValue(summary.without, stat.key, view);
      return { ...stat, withVal, withoutVal };
    });
  const max = Math.max(
    0.01,
    ...rows.flatMap((row) => [row.withVal, row.withoutVal]).filter((n): n is number => n != null && Number.isFinite(n))
  );

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 items-center">
          <p className="type-metadata">{row.label}</p>
          <div className="space-y-1">
            <Bar color="#075B5C" value={row.withVal} max={max} />
            <Bar color="#e08a7a" value={row.withoutVal} max={max} />
          </div>
        </div>
      ))}
    </div>
  );
}

function chartValue(
  group: WowyPairSummary['with'],
  key: WowyStatKey,
  view: 'perGame' | 'perMinute'
): number | null {
  if (view === 'perGame' || key === 'minutes' || key === 'oppPts') return group.perGame[key];
  return group.perMinute[key as WowyRateStatKey];
}

function Bar({ color, value, max }: { color: string; value: number | null; max: number }) {
  const width = value != null && max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 flex-1 rounded-full bg-[#eef3f3] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
      <span className="type-table-data w-12 whitespace-nowrap text-right text-[#063f46]">
        {fmt(value, value != null && value < 2 ? 2 : 1)}
      </span>
    </div>
  );
}
