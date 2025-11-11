import 'dotenv/config';
import { Pool } from 'pg';
import { z } from 'zod';

const BALDONTLIE_TEAMS_URL = 'https://api.balldontlie.io/v1/teams';
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BALDONTLIE_API_KEY = process.env.BALDONTLIE_API_KEY;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env.local file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const TeamSchema = z.object({
  id: z.number(),
  abbreviation: z.string().min(1),
  city: z.string().optional().nullable(),
  conference: z.string().optional().nullable(),
  division: z.string().optional().nullable(),
  full_name: z.string().min(1),
  name: z.string().min(1),
});

const TeamsResponseSchema = z.object({
  data: z.array(TeamSchema),
  meta: z
    .object({
      next_page: z.number().nullable().optional(),
      current_page: z.number().optional(),
      total_pages: z.number().optional(),
    })
    .optional()
    .default({ next_page: null }),
});

type TeamRecord = z.infer<typeof TeamSchema>;

const normalizeTeam = (team: TeamRecord) => ({
  teamId: String(team.id),
  abbreviation: team.abbreviation.trim(),
  fullName: team.full_name.trim(),
  name: team.name.trim(),
  city: (() => {
    const value = team.city?.trim();
    return value ? value : null;
  })(),
  conference: team.conference?.trim() || null,
  division: team.division?.trim() || null,
  providerId: String(team.id),
  raw: team,
});

const fetchTeams = async (): Promise<ReturnType<typeof normalizeTeam>[]> => {
  const teams: ReturnType<typeof normalizeTeam>[] = [];
  let page = 1;

  while (true) {
    const response = await fetch(`${BALDONTLIE_TEAMS_URL}?page=${page}`, {
      headers: BALDONTLIE_API_KEY
        ? {
            Authorization: `Bearer ${BALDONTLIE_API_KEY}`,
          }
        : undefined,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch teams (status ${response.status})`);
    }

    const parsed = TeamsResponseSchema.parse(await response.json());
    parsed.data.map(normalizeTeam).forEach((team) => teams.push(team));

    const nextPage = parsed.meta?.next_page;

    if (!nextPage) {
      break;
    }

    page = nextPage;
  }

  return teams;
};

const partitionUniqueByAbbreviation = (
  teams: ReturnType<typeof normalizeTeam>[],
) => {
  const uniqueMap = new Map<string, ReturnType<typeof normalizeTeam>>();
  const duplicates: ReturnType<typeof normalizeTeam>[] = [];

  for (const team of teams) {
    const key = team.abbreviation.toUpperCase();
    if (uniqueMap.has(key)) {
      duplicates.push(team);
      continue;
    }

    uniqueMap.set(key, team);
  }

  return {
    unique: Array.from(uniqueMap.values()),
    duplicates,
  };
};

const LEGACY_ABBREVIATION_BLACKLIST = new Set([
  'CHS',
  'DN',
  'BOM',
  'CLR',
  'DEF',
  'HUS',
  'PRO',
  'PIT',
  'BAL',
  'JET',
  'AND',
  'WAT',
  'INO',
  'SHE',
]);

const UPSERT_TEAM = `
  insert into teams (
    team_id, abbreviation, full_name, name, city, conference, division, created_at, updated_at
  ) values ($1, $2, $3, $4, $5, $6, $7, now(), now())
  on conflict (team_id) do update set
    abbreviation = excluded.abbreviation,
    full_name = excluded.full_name,
    name = excluded.name,
    city = excluded.city,
    conference = excluded.conference,
    division = excluded.division,
    updated_at = now();
`;

const UPSERT_PROVIDER_MAP = `
  insert into provider_id_map (
    entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
  ) values ('team', $1, 'balldontlie', $2, $3, now(), now(), now())
  on conflict (entity_type, provider, provider_id) do update set
    internal_id = excluded.internal_id,
    metadata = excluded.metadata,
    fetched_at = excluded.fetched_at,
    updated_at = now();
`;

const seedTeams = async () => {
  const client = await pool.connect();

  try {
    console.log('Fetching teams from BallDontLie...');
    const teams = await fetchTeams();
    console.log(`Fetched ${teams.length} teams.`);

    const filtered = teams.filter(
      (team) => !LEGACY_ABBREVIATION_BLACKLIST.has(team.abbreviation.toUpperCase()),
    );

    const { unique, duplicates } = partitionUniqueByAbbreviation(filtered);

    if (duplicates.length > 0) {
      console.warn(
        `Skipping ${duplicates.length} duplicate abbreviation entr${
          duplicates.length === 1 ? 'y' : 'ies'
        } (keeping first seen). Examples:`,
      );
      duplicates.slice(0, 5).forEach((team) => {
        console.warn(
          ` - ${team.abbreviation} (${team.fullName}) provider_id=${team.providerId}`,
        );
      });
    }

    console.log(`Writing ${unique.length} unique teams to database...`);

    await client.query('begin');

    for (const team of unique) {
      await client.query(UPSERT_TEAM, [
        team.teamId,
        team.abbreviation,
        team.fullName,
        team.name,
        team.city,
        team.conference,
        team.division,
      ]);

      await client.query(UPSERT_PROVIDER_MAP, [
        team.teamId,
        team.providerId,
        JSON.stringify(team.raw),
      ]);
    }

    await client.query('commit');

    console.log('Teams synced successfully.');
  } catch (error) {
    await client.query('rollback');
    console.error('Failed to seed teams:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

seedTeams().catch((error) => {
  console.error('Unexpected error during seed:', error);
  process.exit(1);
});

