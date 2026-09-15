# Player projection v1 — experiment roadmap

Research-only. Do not change production until a family earns a chronological out-of-sample promote.

Ordered experiments:

1. **Minutes / role** — done. Frozen candidate: **conditional** EWM minutes / L10 (α=0.25, clip 0.85–1.15) when `|L5−L10|/L10 ≥ 0.25`. Not universal. Not applied to 3PM.
2. **Usage / rate change** — done. Decision: **KEEP MINUTES CANDIDATE ONLY**. Pregame FGA/FTA/usage scaling did not beat Benchmark B on 2025–26 test (CI-backed). Stable-minutes + changing-usage also failed. See `player-projection-v1-usage-rate-results.md`.
3. **Teammate availability** — blocked until a historically valid pregame injury/inactive tape exists.
4. **Opponent** — **next recommended**. Not started. As-of opponent defensive rating / points allowed from `analytics.team_game_stats` prior games.
5. **Pace** — as-of team and opponent pace from prior games.
6. **Rest** — days rest and back-to-back from `games.start_time`.
7. **Home / away** — scheduled location vs `team_id`.
8. **WOWY** — requires lineup/stint data we do not have as a pregame historical tape.

Rules: chronological 2023 → 2024 → 2025; played-game semantics; no `"00"` zeros; market evaluation-only; no probability/sigma/EV in the mean ladder.
