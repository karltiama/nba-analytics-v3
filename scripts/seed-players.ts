import 'dotenv/config';
import { Pool } from 'pg';
import { z } from 'zod';

const API_BASE_URL = 'https://v1.basketball.api-sports.io';
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const APISPORTS_API_KEY = process.env.APISPORTS_API_KEY;
const TARGET_SEASON = process.env.APISPORTS_SEASON ?? '2025-2026';
const TARGET_TEAM_ID = process.env.APISPORTS_TEAM_ID ?? '1';
const REQUEST_DELAY_MS = Number(process.env.APISPORTS_REQUEST_DELAY_MS ?? '800');

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

if (!APISPORTS_API_KEY) {
  console.error('Missing APISPORTS_API_KEY. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const PlayerSchema = z.object({
  id: z.number(),
  firstname: z.string().nullable().optional(),
  lastname: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  birth: z
    .object({
      date: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
    })
    .partial()
    .optional(),
  nba: z
    .object({
      start: z.number().nullable().optional(),
      pro: z.number().nullable().optional(),
    })
    .partial()
    .optional(),
  height: z
    .object({
      feets: z.string().nullable().optional(),
      inches: z.string().nullable().optional(),
      meters: z.string().nullable().optional(),
    })
    .partial()
    .optional(),
  weight: z
    .object({
      pounds: z.string().nullable().optional(),
      kilograms: z.string().nullable().optional(),
    })
    .partial()
    .optional(),
  college: z.string().nullable().optional(),
  affiliation: z.string().nullable().optional(),
  leagues: z
    .object({
      standard: z
        .object({
          active: z.boolean().nullable().optional(),
          jersey: z.union([z.string(), z.number()]).nullable().optional(),
          pos: z.string().nullable().optional(),
          position: z.string().nullable().optional(),
        })
        .partial()
        .optional(),
    })
    .partial()
    .optional(),
});

const PlayersResponseSchema = z.object({
  results: z.number(),
  paging: z
    .object({
      current: z.number().optional(),
      total: z.number().optional(),
    })
    .partial()
    .optional(),
  response: z.array(PlayerSchema),
});

type PlayerRecord = z.infer<typeof PlayerSchema>;

const normalizePlayer = (player: PlayerRecord) => {
  const firstName = player.firstname?.trim() || null;
  const lastName = player.lastname?.trim() || null;
  const fallbackName = player.name?.trim() || null;
  const fullNameCandidate = [firstName, lastName].filter(Boolean).join(' ').trim();
  const fullName = fullNameCandidate || fallbackName || `Player ${player.id}`;

  const standardLeague = player.leagues?.standard;
  const position =
    standardLeague?.pos?.trim() ||
    (typeof standardLeague?.position === 'string' ? standardLeague?.position.trim() : null) ||
    null;

  const height =
    player.height?.meters?.trim() ||
    (player.height?.feets && player.height.inches
      ? `${player.height.feets.trim()}'${player.height.inches.trim()}"`
      : null);

  const weight =
    player.weight?.kilograms?.trim() ||
    player.weight?.pounds?.trim() ||
    null;

  const jerseyRaw = standardLeague?.jersey;
  const jersey =
    jerseyRaw === undefined || jerseyRaw === null ? null : String(jerseyRaw).trim();

  const active =
    typeof standardLeague?.active === 'boolean'
      ? standardLeague.active
      : null;

  return {
    playerId: String(player.id),
    fullName,
    firstName,
    lastName,
    position,
    height,
    weight,
    dob: player.birth?.date ?? null,
    active,
    jersey,
    raw: player,
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchTeamMapping = async (teamId: string) => {
  const query = `
    select internal_id
      from provider_id_map
     where entity_type = 'team'
       and provider = 'apisports'
       and provider_id = $1
     limit 1;
  `;

  const { rows } = await pool.query<{ internal_id: string }>(query, [teamId]);

  if (rows.length === 0) {
    throw new Error(
      `No provider_id_map entry found for team (provider='apisports', provider_id='${teamId}')`,
    );
  }

  return rows[0].internal_id;
};

const fetchPlayersForTeam = async (
  providerTeamId: string,
  season: string,
) => {
  const players: ReturnType<typeof normalizePlayer>[] = [];
  let page = 1;

  while (true) {
    const url = new URL(`${API_BASE_URL}/players`);
    url.searchParams.set('team', providerTeamId);
    url.searchParams.set('season', season);
    url.searchParams.set('page', String(page));

    const response = await fetch(url, {
      headers: {
        'x-rapidapi-host': 'v1.basketball.api-sports.io',
        'x-rapidapi-key': APISPORTS_API_KEY,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to fetch players (status ${response.status}) for team ${providerTeamId}: ${body}`,
      );
    }

    const parsed = PlayersResponseSchema.parse(await response.json());
    const normalized = parsed.response.map(normalizePlayer);

    normalized.forEach((player) => players.push(player));

    const totalPages = parsed.paging?.total ?? page;
    if (page >= totalPages) {
      break;
    }

    page += 1;
    await sleep(REQUEST_DELAY_MS);
  }

  return players;
};

const UPSERT_PLAYER = `
  insert into players (
    player_id, full_name, first_name, last_name, position, height, weight, dob, active, created_at, updated_at
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
  on conflict (player_id) do update set
    full_name = excluded.full_name,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    position = excluded.position,
    height = excluded.height,
    weight = excluded.weight,
    dob = excluded.dob,
    active = excluded.active,
    updated_at = now();
`;

const UPSERT_PROVIDER_MAP = `
  insert into provider_id_map (
    entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
  ) values ('player', $1, 'apisports', $2, $3, now(), now(), now())
  on conflict (entity_type, provider, provider_id) do update set
    internal_id = excluded.internal_id,
    metadata = excluded.metadata,
    fetched_at = excluded.fetched_at,
    updated_at = now();
`;

const seedPlayersForTeam = async () => {
  const client = await pool.connect();

  try {
    console.log(
      `Seeding players for provider team ${TARGET_TEAM_ID} (season ${TARGET_SEASON})`,
    );

    const internalTeamId = await fetchTeamMapping(TARGET_TEAM_ID);
    console.log(`Resolved provider team ${TARGET_TEAM_ID} -> internal id ${internalTeamId}`);

    const players = await fetchPlayersForTeam(TARGET_TEAM_ID, TARGET_SEASON);

    const activeCount = players.filter((player) => player.active === true).length;

    console.log(
      `Fetched ${players.length} players (of which ${activeCount} reported active).`,
    );

    await client.query('begin');

    for (const player of players) {
      await client.query(UPSERT_PLAYER, [
        player.playerId,
        player.fullName,
        player.firstName,
        player.lastName,
        player.position,
        player.height,
        player.weight,
        player.dob,
        player.active,
      ]);

      await client.query(UPSERT_PROVIDER_MAP, [
        player.playerId,
        player.playerId,
        JSON.stringify(player.raw),
      ]);
    }

    await client.query('commit');

    console.log('Player seed completed.');
  } catch (error) {
    await client.query('rollback');
    console.error('Failed to seed players:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

seedPlayersForTeam().catch((error) => {
  console.error('Unexpected error during player seed:', error);
  process.exit(1);
});

