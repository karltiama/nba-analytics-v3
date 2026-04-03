import type { InjuryMatchupContext } from '@/lib/betting/injury-matchup-context';

/** Prose summary from injury teammate splits (deterministic; reads like an assistant note, not an LLM call). */
export function buildInjuryContextNarrative(
  ctx: InjuryMatchupContext,
  homeTeamId: string,
  homeName: string,
  awayName: string
): { intro: string; paragraphs: string[] } {
  const intro = `This note is assembled from ${ctx.season} NBA box scores. It describes how rotation teammates have scored when players who are currently listed Out or Doubtful played (logged minutes) versus when they did not (no minutes recorded). It is descriptive context only, not a projection—and when the “without minutes” sample is tiny, the pattern can easily mislead.`;

  const paragraphs = ctx.entries.map((entry) => {
    const teamName = entry.team_id === homeTeamId ? homeName : awayName;
    const firstName = entry.full_name.split(/\s+/)[0] ?? entry.full_name;

    let s = `For ${teamName}, the snapshot focuses on ${entry.full_name} (${entry.games_played_sample} games with minutes and ${entry.games_missed_sample} team games with no minutes in the sample).`;

    if (entry.teammates.length === 0) {
      s += ` I did not find a stable teammate scoring split to highlight here.`;
      return s;
    }

    const sortedTm = [...entry.teammates].sort(
      (a, b) => Math.abs(b.pts_delta ?? 0) - Math.abs(a.pts_delta ?? 0)
    );
    const t = sortedTm[0];
    if (t.pts_delta != null && t.avg_pts_with != null && t.avg_pts_without != null) {
      const direction =
        t.pts_delta > 0.5 ? 'higher' : t.pts_delta < -0.5 ? 'lower' : 'roughly unchanged';
      s += ` The clearest signal in the data is ${t.full_name}: about ${t.avg_pts_without.toFixed(1)} PPG when ${firstName} was out versus ${t.avg_pts_with.toFixed(1)} when ${firstName} played — a ${direction} gap of roughly ${Math.abs(t.pts_delta).toFixed(1)} points, using ${t.n_games_missed} without games and ${t.n_games_played_with} with games.`;
    } else {
      s += ` ${t.full_name} shows mixed reads across the available games.`;
    }

    if (sortedTm.length > 1) {
      const t2 = sortedTm[1];
      if (t2.pts_delta != null && t2.avg_pts_with != null && t2.avg_pts_without != null) {
        s += ` ${t2.full_name} also shifts (${t2.avg_pts_without.toFixed(1)} vs ${t2.avg_pts_with.toFixed(1)} PPG when ${firstName} is out vs in), with a smaller swing than the top line.`;
      }
    }

    if (entry.low_sample) {
      s += ` I would flag this as a low-sample read: treat it as directional, not definitive.`;
    }
    return s;
  });

  return { intro, paragraphs };
}
