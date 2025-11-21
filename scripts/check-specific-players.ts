import 'dotenv/config';
import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const playersToFind = [
  { scraped: 'David Jones García', db: 'David Jones Garcia' },
  { scraped: 'Ron Holland', db: 'Ronald Holland II' },
  { scraped: 'Egor Demin', db: 'Egor Dëmin' },
  { scraped: 'Pacome Dadiet', db: 'Pacôme Dadiet' },
  { scraped: 'Yanic Konan Niederhauser', db: 'Yanic Konan Niederhäuser' },
];

async function main() {
  console.log('Checking specific player matches...\n');
  
  for (const { scraped, db } of playersToFind) {
    console.log(`Scraped name: "${scraped}"`);
    console.log(`Expected DB name: "${db}"`);
    
    // Try to find the DB player
    const result = await pool.query(`
      SELECT player_id, full_name
      FROM players
      WHERE full_name ILIKE $1
      LIMIT 5
    `, [`%${db.split(' ')[0]}%`]);
    
    if (result.rows.length > 0) {
      console.log('  Found in DB:');
      result.rows.forEach(r => {
        console.log(`    - ${r.full_name} (${r.player_id})`);
      });
    } else {
      console.log('  ❌ Not found');
    }
    
    // Check if normalized versions match
    const scrapedNormalized = scraped
      .replace(/[áàâä]/g, 'a')
      .replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i')
      .replace(/[óòôö]/g, 'o')
      .replace(/[úùûü]/g, 'u')
      .replace(/[ç]/g, 'c')
      .replace(/[ñ]/g, 'n')
      .toLowerCase();
    
    const dbNormalized = db
      .replace(/[áàâä]/g, 'a')
      .replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i')
      .replace(/[óòôö]/g, 'o')
      .replace(/[úùûü]/g, 'u')
      .replace(/[ç]/g, 'c')
      .replace(/[ñ]/g, 'n')
      .toLowerCase();
    
    console.log(`  Normalized scraped: "${scrapedNormalized}"`);
    console.log(`  Normalized DB: "${dbNormalized}"`);
    console.log(`  Match: ${scrapedNormalized === dbNormalized ? '✅' : '❌'}`);
    console.log('');
  }
  
  await pool.end();
}

main().catch(console.error);

