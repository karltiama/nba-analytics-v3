import type { InjuryMatchupContext } from '@/lib/betting/injury-matchup-context';

type InjuryReportLine = { player: string; status: string; injury: string };

export type AiSummaryTeamStats = {
  offensiveRating: number;
  defensiveRating: number;
  pace: number;
};

export type AiSummarySpreadPoint = { time: string; value: number };

export type AiSummaryMatchupAnalysis = {
  pace_analysis?: { projected_pace?: number | null; pace_impact?: string | null } | null;
  starting_lineups?: {
    home?: { players?: { full_name: string }[] };
    away?: { players?: { full_name: string }[] };
  } | null;
} | null;

export type AiSummaryGameRef = {
  homeTeam: { id: string; abbreviation: string };
  awayTeam: { id: string; abbreviation: string };
};

export type AiSummaryCurrentOdds = {
  spread: number | null;
  overUnder: number | null;
} | null;

export type AiSummaryBulletsInput = {
  matchupAnalysis?: AiSummaryMatchupAnalysis;
  homeTeamStats: AiSummaryTeamStats;
  awayTeamStats: AiSummaryTeamStats;
  spreadMovement: AiSummarySpreadPoint[];
  injuries?: { home: InjuryReportLine[]; away: InjuryReportLine[] };
};

/** 2–4 high-signal summary bullets from game details (same logic as matchup AI card). */
export function getGameSummaryBulletsForAi(input: AiSummaryBulletsInput): string[] {
  const bullets: string[] = [];
  const { matchupAnalysis, homeTeamStats, awayTeamStats, spreadMovement, injuries } = input;

  if (matchupAnalysis?.pace_analysis) {
    const { projected_pace, pace_impact } = matchupAnalysis.pace_analysis;
    const impact = (pace_impact ?? '').trim();
    bullets.push(
      `${impact ? impact.charAt(0).toUpperCase() + impact.slice(1) : 'Mixed'} pace (projected ${projected_pace?.toFixed(0) ?? '—'})`
    );
  } else if (homeTeamStats?.pace != null && awayTeamStats?.pace != null) {
    const avg = (homeTeamStats.pace + awayTeamStats.pace) / 2;
    bullets.push(`Avg pace ${avg.toFixed(0)}`);
  }

  if (
    homeTeamStats?.offensiveRating != null &&
    awayTeamStats?.defensiveRating != null &&
    awayTeamStats?.offensiveRating != null &&
    homeTeamStats?.defensiveRating != null
  ) {
    const homeO = homeTeamStats.offensiveRating;
    const awayD = awayTeamStats.defensiveRating;
    const awayO = awayTeamStats.offensiveRating;
    const homeD = homeTeamStats.defensiveRating;
    if (homeO > awayD && awayO <= homeD) bullets.push('Home offense vs Away defense: advantage Home');
    else if (awayO > homeD && homeO <= awayD) bullets.push('Away offense vs Home defense: advantage Away');
    else bullets.push('Offense vs defense: mixed');
  }

  if (spreadMovement?.length >= 2) {
    const open = spreadMovement[0].value;
    const now = spreadMovement[spreadMovement.length - 1].value;
    const move = now - open;
    if (Math.abs(move) >= 0.5) {
      bullets.push(`Line moved ${move > 0 ? 'toward Home' : 'toward Away'} (${move > 0 ? '+' : ''}${move.toFixed(1)})`);
    }
  }

  const totalInjuries = (injuries?.home?.length ?? 0) + (injuries?.away?.length ?? 0);
  if (totalInjuries === 0) bullets.push('No major injuries reported');
  else bullets.push(`Key injury context: ${totalInjuries} listed`);

  let out = bullets.slice(0, 4);
  if (out.length === 0) out = ['Matchup loaded; limited structured signals for this slate.'];
  return out;
}

export function formatOddsHintForAiSummary(
  currentOdds: AiSummaryCurrentOdds | undefined,
  game: AiSummaryGameRef
): string | null {
  if (!currentOdds) return null;
  const bits: string[] = [];
  if (currentOdds.spread != null) {
    bits.push(`${game.homeTeam.abbreviation} ${currentOdds.spread > 0 ? '+' : ''}${currentOdds.spread}`);
  }
  if (currentOdds.overUnder != null) {
    bits.push(`O/U ${currentOdds.overUnder}`);
  }
  return bits.length ? bits.join(' · ') : null;
}

/** Structured strings for POST /ai-projection-summary (injuries, splits, starters). */
export function buildAiSupplementalLines(
  injuries: { home: InjuryReportLine[]; away: InjuryReportLine[] } | undefined,
  injuryMatchupContext: InjuryMatchupContext | null | undefined,
  game: AiSummaryGameRef,
  matchupAnalysis?: AiSummaryMatchupAnalysis
): {
  injuryReportLines: string[];
  usageShiftLines: string[];
  expectedStarterLines: string[];
} {
  const injuryReportLines: string[] = [];
  for (const inj of injuries?.home ?? []) {
    const detail = inj.injury?.trim() ? ` — ${inj.injury}` : '';
    injuryReportLines.push(`${game.homeTeam.abbreviation}: ${inj.player} (${inj.status})${detail}`);
  }
  for (const inj of injuries?.away ?? []) {
    const detail = inj.injury?.trim() ? ` — ${inj.injury}` : '';
    injuryReportLines.push(`${game.awayTeam.abbreviation}: ${inj.player} (${inj.status})${detail}`);
  }

  const usageShiftLines: string[] = [];
  const ctx = injuryMatchupContext;
  if (ctx?.entries?.length) {
    const homeId = game.homeTeam.id;
    for (const entry of ctx.entries) {
      const abbr = entry.team_id === homeId ? game.homeTeam.abbreviation : game.awayTeam.abbreviation;
      const injured = entry.full_name;
      const statusBit = entry.status?.trim() ? entry.status : 'Out/Doubtful';

      const withMin = entry.teammates.filter(
        (t) =>
          t.avg_min_with != null &&
          t.avg_min_without != null &&
          t.n_games_missed >= 1 &&
          t.n_games_played_with >= 1
      );
      const sorted = [...withMin].sort((a, b) => {
        const da = (a.avg_min_without ?? 0) - (a.avg_min_with ?? 0);
        const db = (b.avg_min_without ?? 0) - (b.avg_min_with ?? 0);
        return db - da;
      });
      const top = sorted[0];
      if (top) {
        const delta = (top.avg_min_without ?? 0) - (top.avg_min_with ?? 0);
        usageShiftLines.push(
          `${abbr}: If ${injured} (${statusBit}) does not play, ${top.full_name} averaged ${top.avg_min_without} MPG in ${top.n_games_missed} games where ${injured} had no minutes vs ${top.avg_min_with} MPG in ${top.n_games_played_with} games with ${injured} playing (~${delta >= 0 ? '+' : ''}${delta.toFixed(1)} MPG).`
        );
      } else {
        const t = [...entry.teammates].sort(
          (a, b) => Math.abs(b.pts_delta ?? 0) - Math.abs(a.pts_delta ?? 0)
        )[0];
        if (
          t &&
          t.pts_delta != null &&
          t.avg_pts_with != null &&
          t.avg_pts_without != null &&
          (t.n_games_missed >= 1 || t.n_games_played_with >= 1)
        ) {
          usageShiftLines.push(
            `${abbr}: If ${injured} (${statusBit}) does not play, ${t.full_name} averaged ${t.avg_pts_without} PPG in games without ${injured} vs ${t.avg_pts_with} PPG with ${injured} (scoring split; minutes split not available).`
          );
        }
      }
    }
  }

  const expectedStarterLines: string[] = [];
  const sl = matchupAnalysis?.starting_lineups;
  if (sl?.away?.players?.length) {
    const names = sl.away.players.slice(0, 5).map((p) => p.full_name).join(', ');
    expectedStarterLines.push(`${game.awayTeam.abbreviation} usual starters (recent): ${names}`);
  }
  if (sl?.home?.players?.length) {
    const names = sl.home.players.slice(0, 5).map((p) => p.full_name).join(', ');
    expectedStarterLines.push(`${game.homeTeam.abbreviation} usual starters (recent): ${names}`);
  }

  return { injuryReportLines, usageShiftLines, expectedStarterLines };
}
