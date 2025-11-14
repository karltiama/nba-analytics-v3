#!/usr/bin/env node

/**
 * Fetches NBA games from the BallDontLie API for a given date and prints them.
 *
 * Usage:
 *   node scripts/fetch_balldontlie_games.js --date 2025-10-21 --season 2025-26
 *
 * If --season is omitted, the current season is used based on the year.
 */

import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "--date" || arg === "-d") && args[i + 1]) {
      options.date = args[i + 1];
      i += 1;
    } else if ((arg === "--season" || arg === "-s") && args[i + 1]) {
      options.season = args[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }
  return options;
}

function showHelp() {
  console.log(`
Usage: node scripts/fetch_balldontlie_games.js --date YYYY-MM-DD [--season 2025-26]

Options:
  --date, -d   Target date (Eastern) to query. Required.
  --season, -s BallDontLie season string. Defaults to current NBA season guess.
  --help, -h   Show this help text.
`);
}

function guessSeason(dateStr) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed (Oct = 9)
  if (month >= 9) {
    return `${year}-${(year + 1).toString().slice(-2)}`;
  }
  return `${year - 1}-${year.toString().slice(-2)}`;
}

function resolveApiKey() {
  const possibleKeys = [
    "BALLDONTLIE_API_KEY",
    "BALDONTLIE_API_KEY", // common typo; handle both
  ];

  for (const key of possibleKeys) {
    const value = process.env[key];
    if (value) {
      return value;
    }
  }
  return null;
}

async function fetchGames(date, season) {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error("BallDontLie API key missing. Define BALLDONTLIE_API_KEY (or BALDONTLIE_API_KEY) in your .env file.");
  }

  const params = {
    start_date: date,
    end_date: date,
    "seasons[]": season,
    per_page: 25,
  };

  const response = await axios.get("https://api.balldontlie.io/v1/games", {
    params,
    headers: {
      Authorization: apiKey,
    },
    timeout: 30_000,
  });

  return response.data;
}

function printGames(data, date, season) {
  const games = data?.data ?? [];
  console.log(`BallDontLie games for ${date} (season ${season}) — count: ${games.length}`);
  if (!games.length) {
    return;
  }

  for (const game of games) {
    const {
      id,
      date: tipoff,
      status,
      season: seasonYear,
      home_team: homeTeam,
      home_team_score: homeScore,
      visitor_team: awayTeam,
      visitor_team_score: awayScore,
    } = game;

    console.log(
      [
        `Game ${id}`,
        `tipoff=${tipoff}`,
        `status=${status}`,
        `season=${seasonYear}`,
        `home=${homeTeam.abbreviation} (${homeScore})`,
        `away=${awayTeam.abbreviation} (${awayScore})`,
      ].join(" | "),
    );
  }
}

function normalizeSeason(seasonInput, date) {
  if (!seasonInput) {
    return Number.parseInt(guessSeason(date).slice(0, 4), 10);
  }

  const dashIndex = seasonInput.indexOf("-");
  if (dashIndex > 0) {
    return Number.parseInt(seasonInput.slice(0, dashIndex), 10);
  }

  return Number.parseInt(seasonInput, 10);
}

async function main() {
  const options = parseArgs();
  if (options.help || !options.date) {
    showHelp();
    process.exit(options.help ? 0 : 1);
  }

  const { date } = options;
  const season = normalizeSeason(options.season, date);

  try {
    const payload = await fetchGames(date, season);
    printGames(payload, date, season);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Request failed:", error.response?.status, error.response?.data ?? error.message);
    } else {
      console.error("Error:", error.message);
    }
    process.exit(1);
  }
}

main();


