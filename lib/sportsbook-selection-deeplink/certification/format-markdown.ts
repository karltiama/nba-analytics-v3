/**
 * Format a Level-3 certification report as Markdown (no secrets).
 */

import type { Level3CertificationReport } from './types';

export function formatCertificationMarkdown(report: Level3CertificationReport): string {
  const lines: string[] = [];
  lines.push('# Odds API Level-3 Deeplink Certification');
  lines.push('');
  lines.push(`- Run: \`${report.runTimestamp}\``);
  lines.push(`- Mode: \`${report.mode}\``);
  lines.push(`- Events inspected: ${report.eventsInspected}`);
  lines.push(`- Markets: ${report.marketsRequested.join(', ')}`);
  lines.push(
    `- Credits: sum≈${report.credits.observedCostSum}, requests=${report.credits.requestsRecorded}, remaining ${report.credits.startingRemaining ?? '?'} → ${report.credits.endingRemaining ?? '?'}`
  );
  lines.push('');
  lines.push('## Per-book summary');
  lines.push('');
  lines.push(
    '| Provider | Events | Book % | Prop % | SID % | Link % | Exact resolver % | Max L | Access | Ready |'
  );
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---|---|');
  for (const b of report.perBook) {
    lines.push(
      `| ${b.provider} | ${b.eventsObserved} | ${fmtPct(b.bookPresentPct)} (n=${b.bookPresentEvents}) | ${fmtPct(b.propMarketPresentPct)} (n=${b.propMarketPresentEvents}) | ${fmtPct(b.outcomeSidPct)} (n=${b.outcomeCount}) | ${fmtPct(b.outcomeLinkPct)} | ${fmtPct(b.exactResolverPct)} (${b.exactResolverSuccess}/${b.exactResolverProbes}) | ${b.maxVerifiedLevel} | ${b.accessLimitation} | ${b.level3ProviderReady} |`
    );
  }
  lines.push('');
  lines.push('## FanDuel');
  lines.push('');
  if (report.fanDuel) {
    const f = report.fanDuel;
    lines.push(`- Games with props: ${f.gamesSampled}`);
    lines.push(`- Markets with outcomes: ${f.marketsSampled}`);
    lines.push(`- Eligible selections: ${f.eligibleSelections}`);
    lines.push(`- With outcome SID: ${f.selectionsWithOutcomeSid}`);
    lines.push(`- With deeplink: ${f.selectionsWithDeeplink}`);
    lines.push(`- Allowlist pass rate: ${fmtPct(f.allowlistPassRate)}`);
    lines.push(`- Resolution pass rate: ${fmtPct(f.resolutionPassRate)}`);
  } else {
    lines.push('_No FanDuel summary._');
  }
  lines.push('');
  lines.push('## Time-to-tip (FanDuel / DraftKings link outcomes)');
  lines.push('');
  for (const provider of ['fanduel', 'draftkings'] as const) {
    const book = report.perBook.find((b) => b.provider === provider);
    if (!book) continue;
    lines.push(`### ${provider}`);
    lines.push('');
    for (const [bucket, c] of Object.entries(book.byBucket)) {
      if (!c) continue;
      lines.push(
        `- ${bucket}: events=${c.eventsChecked}, book=${c.eventsWithSportsbook}, props=${c.eventsWithRequestedMarket}, sid_outcomes=${c.outcomesWithSid}, link_outcomes=${c.outcomesWithLink}`
      );
    }
    lines.push('');
  }
  lines.push('## SID stability');
  lines.push('');
  if (report.sidStability.length === 0) {
    lines.push('_No paired samples in this run._');
  } else {
    for (const s of report.sidStability) {
      lines.push(
        `- ${s.sportsbook} ${s.marketKey} ${s.playerName} ${s.side}${s.line}: sameSID=${s.sameSelectionSid} oddsChanged=${s.oddsChanged} lineChanged=${s.lineChanged}`
      );
    }
  }
  lines.push('');
  lines.push('## Paid-tier notes');
  lines.push('');
  for (const n of report.paidTierNotes) lines.push(`- ${n}`);
  lines.push('');
  lines.push('## Architecture');
  lines.push('');
  for (const n of report.architectureNotes) lines.push(`- ${n}`);
  lines.push('');
  lines.push('## Masked link samples');
  lines.push('');
  for (const s of report.maskedLinkSamples.slice(0, 8)) {
    lines.push(`- ${s.sportsbook}: \`${s.urlShape}\``);
  }
  lines.push('');
  lines.push('_apiKeyPresentInArtifact: false_');
  lines.push('');
  return lines.join('\n');
}

function fmtPct(v: number | null): string {
  if (v == null) return 'n/a';
  return `${v}%`;
}
