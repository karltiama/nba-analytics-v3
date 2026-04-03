import { config } from 'dotenv';
import pg from 'pg';

config({ path: '.env' });

const sql = `
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'profiles' AND column_name = 'onboarding_completed_at')
    OR (
      table_name = 'user_settings'
      AND column_name IN ('odds_format', 'paper_display_mode', 'primary_goal', 'experience_level')
    )
  )
ORDER BY table_name, column_name;
`;

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error('SUPABASE_DB_URL missing');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url });
  try {
    const r = await pool.query(sql);
    console.log(JSON.stringify(r.rows, null, 2));
    const expected = [
      ['profiles', 'onboarding_completed_at'],
      ['user_settings', 'experience_level'],
      ['user_settings', 'odds_format'],
      ['user_settings', 'paper_display_mode'],
      ['user_settings', 'primary_goal'],
    ];
    const got = r.rows.map((row) => [row.table_name, row.column_name] as const);
    const ok =
      expected.length === got.length &&
      expected.every(([t, c], i) => got[i]?.[0] === t && got[i]?.[1] === c);
    if (!ok) {
      console.error('Schema mismatch: expected 5 onboarding-related columns listed above.');
      process.exit(1);
    }
    console.log('OK: all onboarding columns present.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
