'use client';

import Link from 'next/link';
import { dimensionLabel, playerConcentrationDisplayFields } from '@/lib/research/points-proxy-research-view-model';
import type { BreakdownDimension } from '@/lib/research/proxy-strategy-breakdowns';
import type {
  LeaderboardRowVM,
  PointsProxyLabViewModel,
  StrategyDetailVM,
} from '@/lib/research/points-proxy-research-view-model';
import type { BucketBreakdown } from '@/lib/research/proxy-strategy-breakdowns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function fmtRate(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(2)}%`;
}

function fmtBucket(key: string): string {
  return key.replace(/_/g, ' ');
}

function BucketTable({ title, rows }: { title: string; rows: BucketBreakdown[] }) {
  if (!rows.length) {
    return (
      <div className="mb-4">
        <h4 className="text-xs font-medium text-white mb-2">{title}</h4>
        <p className="text-xs text-muted-foreground">No rows.</p>
      </div>
    );
  }
  return (
    <div className="mb-4">
      <h4 className="text-xs font-medium text-white mb-2">{title}</h4>
      <div className="glass-card rounded-xl overflow-hidden border border-white/5 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bucket</TableHead>
              <TableHead className="text-right">Signals</TableHead>
              <TableHead className="text-right">Hits</TableHead>
              <TableHead className="text-right">Hit rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.bucket_key}>
                <TableCell className="font-mono text-xs">{fmtBucket(r.bucket_key)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{r.signal_count}</TableCell>
                <TableCell className="text-right font-mono text-xs">{r.hit_count}</TableCell>
                <TableCell className="text-right font-mono text-xs">{fmtRate(r.hit_rate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function BestWorstSection({ strategy }: { strategy: StrategyDetailVM }) {
  const entries = Object.entries(strategy.best_worst_by_dimension) as Array<
    [BreakdownDimension, { best: { bucket_key: string; signal_count: number; hit_rate: number | null } | null; worst: { bucket_key: string; signal_count: number; hit_rate: number | null } | null }]
  >;
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">No best/worst bucket summary.</p>;
  }
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      {entries.map(([dim, bw]) => (
        <p key={dim}>
          <span className="text-white/90 font-medium">{dimensionLabel(dim)}:</span> best{' '}
          <code className="text-[#00d4ff]">{bw.best ? fmtBucket(bw.best.bucket_key) : '—'}</code> (
          {fmtRate(bw.best?.hit_rate ?? null)}, n={bw.best?.signal_count ?? 0}) · worst{' '}
          <code className="text-[#00d4ff]">{bw.worst ? fmtBucket(bw.worst.bucket_key) : '—'}</code> (
          {fmtRate(bw.worst?.hit_rate ?? null)}, n={bw.worst?.signal_count ?? 0})
        </p>
      ))}
    </div>
  );
}

function LeaderboardTable({ rows }: { rows: LeaderboardRowVM[] }) {
  if (!rows.length) {
    return <p className="text-xs text-muted-foreground">No comparison leaderboard rows loaded.</p>;
  }
  return (
    <div className="glass-card rounded-xl overflow-hidden border border-white/5 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rank</TableHead>
            <TableHead>Strategy</TableHead>
            <TableHead className="text-right">Weighted hit</TableHead>
            <TableHead className="text-right">Total signals</TableHead>
            <TableHead className="text-right">Hit rate range</TableHead>
            <TableHead>Narrative</TableHead>
            <TableHead className="text-right">Unique players</TableHead>
            <TableHead className="text-right">Top-10 vol. share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.strategy_name}>
              <TableCell className="font-mono text-xs">{r.rank}</TableCell>
              <TableCell className="font-mono text-xs text-white/90">{r.strategy_name}</TableCell>
              <TableCell className="text-right font-mono text-xs">{fmtRate(r.weighted_hit_rate)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{r.total_signals}</TableCell>
              <TableCell className="text-right font-mono text-xs">{fmtRate(r.hit_rate_range)}</TableCell>
              <TableCell className="text-xs max-w-[200px]">
                <span className="text-white/90">{r.narrative_label}</span>
                {r.narrative_reasons.length > 0 && (
                  <span className="text-muted-foreground block mt-0.5">{r.narrative_reasons.join(' ')}</span>
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">{r.unique_players}</TableCell>
              <TableCell className="text-right font-mono text-xs">{fmtRate(r.top10_player_signal_share)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StrategyDetail({
  strategy,
  playerNameEnrichment,
}: {
  strategy: StrategyDetailVM;
  playerNameEnrichment: PointsProxyLabViewModel['player_display_name_enrichment'];
}) {
  return (
    <div className="space-y-6">
      <div className="glass-card rounded-xl p-4 border border-white/10 space-y-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="text-sm font-medium text-white font-mono">{strategy.strategy_name}</h3>
          <span className="text-xs text-muted-foreground">Rank {strategy.rank}</span>
        </div>
        <p className="text-xs">
          <span className="text-muted-foreground">Narrative:</span>{' '}
          <span className="text-white/90 font-medium">{strategy.narrative_label}</span>
          {strategy.narrative_reasons.length > 0 && (
            <span className="text-muted-foreground"> — {strategy.narrative_reasons.join(' ')}</span>
          )}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground uppercase tracking-wide text-[10px]">Signals</p>
            <p className="text-lg font-semibold text-white">{strategy.signal_count}</p>
          </div>
          <div>
            <p className="text-muted-foreground uppercase tracking-wide text-[10px]">Unique players</p>
            <p className="text-lg font-semibold text-white">{strategy.unique_players}</p>
          </div>
          <div>
            <p className="text-muted-foreground uppercase tracking-wide text-[10px]">Top-10 vol. share</p>
            <p className="text-lg font-semibold text-[#00d4ff]">{fmtRate(strategy.top10_player_signal_share)}</p>
          </div>
          <div>
            <p className="text-muted-foreground uppercase tracking-wide text-[10px]">Overall hit</p>
            <p className="text-lg font-semibold text-emerald-300">{fmtRate(strategy.overall_hit_rate)}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-white/80">Interpretation:</strong> {strategy.short_interpretation}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed border-t border-white/10 pt-2">
          <strong className="text-white/80">Recommended next step:</strong> {strategy.recommended_next_step}
        </p>
      </div>

      <div>
        <h4 className="text-xs font-medium text-white mb-2">Best / weakest buckets (min-sample extremes)</h4>
        <BestWorstSection strategy={strategy} />
      </div>

      <BucketTable title="By season" rows={strategy.by_season} />
      <BucketTable title="By prior games bucket" rows={strategy.by_prior_games} />
      <BucketTable title="By L5 minutes bucket" rows={strategy.by_minutes_l5} />
      <BucketTable title="By pre-game season points average bucket" rows={strategy.by_points_season_avg} />

      <div>
        <h4 className="text-xs font-medium text-white mb-2">Player concentration (top by signal volume)</h4>
        <p className="text-[11px] text-muted-foreground mb-2">
          <strong className="text-white/80">Display name</strong> uses breakdown{' '}
          <code className="text-[#00d4ff]">player_frequency[].player_name</code> when present, then S3 lookup JSON (
          {playerNameEnrichment.s3_lookup_entry_count.toLocaleString()} entries from{' '}
          {playerNameEnrichment.s3_lookup_files_found} file(s)), then optional BallDontLie players API when{' '}
          <code className="text-[#00d4ff]">BALLDONTLIE_API_KEY</code> is set
          {playerNameEnrichment.bdl_filled_count > 0
            ? ` (${playerNameEnrichment.bdl_filled_count} filled this load).`
            : '.'}{' '}
          The <code className="text-[#00d4ff]">player_id</code> column is always the BallDontLie id.
        </p>
        <div className="glass-card rounded-xl overflow-hidden border border-white/5 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Display name</TableHead>
                <TableHead className="font-mono text-[11px] text-muted-foreground">player_id</TableHead>
                <TableHead className="text-right">Signals</TableHead>
                <TableHead className="text-right">Hits</TableHead>
                <TableHead className="text-right">Hit rate</TableHead>
                <TableHead className="text-right">Share of strategy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {strategy.player_concentration_rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-xs text-muted-foreground">
                    No player rows.
                  </TableCell>
                </TableRow>
              ) : (
                strategy.player_concentration_rows.map((p) => {
                  const fields = playerConcentrationDisplayFields(p);
                  return (
                    <TableRow key={p.player_id}>
                      <TableCell className="text-xs whitespace-normal min-w-32 max-w-[18rem] align-top wrap-break-word">
                        {fields.resolvedName ? (
                          <span className="text-white/95">{fields.resolvedName}</span>
                        ) : (
                          <span className="text-muted-foreground italic">Not in lookup</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground align-top whitespace-nowrap">
                        {fields.canonicalPlayerId}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{p.signal_count}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{p.hit_count}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtRate(p.hit_rate)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtRate(p.share_of_strategy_signals)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

export function PointsProxyStrategiesDashboard({
  viewModel,
  bucket,
}: {
  viewModel: PointsProxyLabViewModel;
  bucket: string;
}) {
  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
      <div className="mb-6">
        <p className="text-xs text-muted-foreground mb-2">
          <Link href="/" className="text-[#00d4ff] hover:underline">
            Home
          </Link>
          <span className="mx-2">/</span>
          <span className="text-white">Research</span>
          <span className="mx-2">/</span>
          <span className="text-white">Points proxy strategies</span>
        </p>
        <h1 className="text-xl font-semibold text-white">Points Proxy Strategy Research</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Historical proxy research dashboard (seasons <span className="font-mono text-white/90">{viewModel.seasons_tag}</span>
          ). This is <strong className="text-white/90">not</strong> odds-backed betting advice and does not show picks or
          EV.
        </p>
        <p className="text-xs text-muted-foreground mt-3 max-w-3xl border-l-2 border-amber-500/60 pl-3">
          These results use a proxy target: whether a player scored above their own season average. They do not prove
          sportsbook profitability until validated against historical betting lines.
        </p>
      </div>

      {viewModel.data_quality_warnings.length > 0 && (
        <div className="glass-card rounded-xl p-4 mb-6 border-l-4 border-l-amber-500 space-y-2">
          <h2 className="text-sm font-medium text-amber-100">Data quality warnings</h2>
          <ul className="text-xs text-amber-50/90 list-disc pl-4 space-y-1">
            {viewModel.data_quality_warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <Tabs defaultValue="overview" className="w-full">
        <TabsList variant="line" className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="overview">Overview & leaderboard</TabsTrigger>
          {viewModel.strategies.map((s) => (
            <TabsTrigger key={s.strategy_name} value={s.strategy_name} className="font-mono text-[11px]">
              {s.strategy_name}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="glass-card rounded-xl p-4 border border-white/10 text-xs text-muted-foreground space-y-2">
            <p>
              <span className="text-white/90">Target:</span> {viewModel.target_definition}
            </p>
            <p>
              <span className="text-white/90">Comparison artifact:</span>{' '}
              <code className="text-[#00d4ff]">s3://{bucket}/{viewModel.comparison_s3_key}</code>
              {viewModel.comparison_generated_at && (
                <span className="block mt-1">Generated: {viewModel.comparison_generated_at}</span>
              )}
            </p>
            <p>
              <span className="text-white/90">Breakdown artifact:</span>{' '}
              <code className="text-[#00d4ff]">s3://{bucket}/{viewModel.breakdown_s3_key}</code>
              {viewModel.breakdown_generated_at && (
                <span className="block mt-1">Generated: {viewModel.breakdown_generated_at}</span>
              )}
            </p>
            {viewModel.total_rows_loaded != null && (
              <p>
                <span className="text-white/90">Rows loaded for breakdowns:</span>{' '}
                {viewModel.total_rows_loaded.toLocaleString()}
              </p>
            )}
            {viewModel.missing_seasons.length > 0 && (
              <p className="text-amber-200/90">
                Missing seasons in comparison build: {viewModel.missing_seasons.join(', ')}
              </p>
            )}
            {viewModel.player_display_name_enrichment.s3_lookup_entry_count === 0 &&
              viewModel.player_display_name_enrichment.bdl_filled_count === 0 && (
                <p className="text-amber-200/90 border-t border-white/10 pt-2 mt-2">
                  No display names loaded: S3 lookup had{' '}
                  {viewModel.player_display_name_enrichment.s3_lookup_entry_count} parsed entries (
                  {viewModel.player_display_name_enrichment.s3_lookup_files_found} file(s) found at{' '}
                  {viewModel.player_display_name_enrichment.s3_lookup_keys_tried.length} key(s)), and BallDontLie API
                  fallback did not add any (set <code className="text-[#00d4ff]">BALLDONTLIE_API_KEY</code> on the
                  server, or upload{' '}
                  <code className="text-[#00d4ff]">research/dimensions/league=nba/player_id_to_display_name.json</code>{' '}
                  / run <code className="text-[#00d4ff]">npm run research:materialize-player-names</code>).
                </p>
              )}
            {viewModel.player_display_name_enrichment.bdl_filled_count > 0 && (
              <p className="text-emerald-200/90 border-t border-white/10 pt-2 mt-2">
                Filled {viewModel.player_display_name_enrichment.bdl_filled_count.toLocaleString()} display name(s) via
                BallDontLie API (S3 lookup had {viewModel.player_display_name_enrichment.s3_lookup_entry_count}{' '}
                entries).
              </p>
            )}
          </div>

          <div>
            <h2 className="text-sm font-medium text-white mb-3">Strategy leaderboard</h2>
            <LeaderboardTable rows={viewModel.leaderboard} />
          </div>

          {(() => {
            const sr = viewModel.leaderboard.find((r) => r.strategy_name === 'strong_recent_role_change_v1');
            if (!sr || sr.narrative_label !== 'broad') return null;
            return (
              <div className="glass-card rounded-xl p-4 border border-emerald-500/30 bg-emerald-950/20 text-xs text-emerald-50/95">
                <p className="font-medium text-emerald-100 mb-1">Research note: strong_recent_role_change_v1</p>
                <p>
                  Breakdown narrative is <strong>broad</strong> (not overly player-concentrated): top-10 volume share{' '}
                  {fmtRate(sr.top10_player_signal_share)}, {sr.unique_players.toLocaleString()} unique players with at
                  least one signal across loaded seasons.
                </p>
              </div>
            );
          })()}

          <p className="text-[11px] text-muted-foreground">
            Values are read-only from S3 JSON. Open a strategy tab for bucket splits and player concentration tables.
            Optional player display names merge from lookup keys under{' '}
            <span className="font-mono text-white/80">research/dimensions/league=nba/player_id_to_display_name.json</span>{' '}
            (and a seasons-scoped variant); missing lookups never block the page.
          </p>
        </TabsContent>

        {viewModel.strategies.map((s) => (
          <TabsContent key={s.strategy_name} value={s.strategy_name}>
            <StrategyDetail strategy={s} playerNameEnrichment={viewModel.player_display_name_enrichment} />
          </TabsContent>
        ))}
      </Tabs>

      {viewModel.strategies.length === 0 && (
        <p className="text-xs text-amber-200 mt-4">
          No strategy rows found. Generate comparison and breakdown artifacts (research scripts), then refresh.
        </p>
      )}
    </main>
  );
}
