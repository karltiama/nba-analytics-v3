import { FileCheckpointStore } from '../../lib/providers/owls-insight/checkpoint';
import { classifyGamePhase } from '../../lib/providers/owls-insight/universe';

async function main() {
  const store = new FileCheckpointStore('data/owls-insight/runs');
  for (const [season, runId] of [
    ['2024', 'owls-2026-09-14-season-2024'],
    ['2025', 'owls-2026-09-14-season-2025'],
  ] as const) {
    const state = await store.load(runId);
    if (!state) throw new Error(runId);
    const units = Object.values(state.units);
    const rows = [];
    for (const [cc, acq] of Object.entries(state.game_acquisition ?? {})) {
      if (acq.state !== 'POPULATED' || !acq.event_id) continue;
      const gameDate = units.find((u) => u.court_context_game_id === cc)?.game_date;
      if (!gameDate) continue;
      if (classifyGamePhase(season, `${gameDate}T17:00:00.000Z`) !== 'regular') continue;
      rows.push({ cc, date: gameDate, eventId: acq.event_id, rows: acq.rows });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const xmas = rows.filter((r) => r.date.endsWith('-12-25'));
    console.log(
      JSON.stringify({ season, populatedRegular: rows.length, xmas, sample: rows.slice(0, 6) }, null, 2)
    );
  }
}

main();
