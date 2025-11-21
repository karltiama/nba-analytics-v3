import 'dotenv/config';
import { Pool } from 'pg';
import { processCSVBoxScore } from './scrape-bbref-csv-boxscores';

/**
 * Retry Failed Games
 * 
 * Retries scraping for specific game IDs that failed previously
 * 
 * Usage:
 *   tsx scripts/retry-failed-games.ts 1842025102203 1842025102405
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: tsx scripts/retry-failed-games.ts <game-id-1> <game-id-2> ...');
    console.log('\nExample:');
    console.log('  tsx scripts/retry-failed-games.ts 1842025102203 1842025102405');
    process.exit(1);
  }
  
  const gameIds = args;
  console.log(`\n🔄 Retrying ${gameIds.length} failed game(s)...\n`);
  
  let successCount = 0;
  let errorCount = 0;
  const errors: Array<{ game_id: string; error: string }> = [];
  
  for (let i = 0; i < gameIds.length; i++) {
    const gameId = gameIds[i];
    const progress = `[${i + 1}/${gameIds.length}]`;
    
    console.log(`\n${progress} Retrying game: ${gameId}`);
    
    try {
      const success = await processCSVBoxScore(gameId, false);
      
      if (success) {
        console.log(`   ✅ Successfully scraped`);
        successCount++;
      } else {
        console.log(`   ⚠️  Scraping returned false`);
        errorCount++;
        errors.push({ game_id: gameId, error: 'Scraping returned false' });
      }
      
      // Rate limiting between games
      if (i < gameIds.length - 1) {
        const delay = 4000 + Math.random() * 800;
        console.log(`   ⏳ Waiting ${Math.ceil(delay / 1000)}s before next game...`);
        await sleep(delay);
      }
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
      errorCount++;
      errors.push({ game_id: gameId, error: error.message });
      
      if (i < gameIds.length - 1) {
        await sleep(2000);
      }
    }
  }
  
  // Summary
  console.log(`\n\n${'='.repeat(60)}`);
  console.log(`📊 RETRY SUMMARY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Total games: ${gameIds.length}`);
  console.log(`✅ Successfully scraped: ${successCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  
  if (errors.length > 0) {
    console.log(`\n❌ Failed games:`);
    errors.forEach((e, idx) => {
      console.log(`   ${idx + 1}. ${e.game_id}: ${e.error}`);
    });
  }
  
  await pool.end();
}

if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

