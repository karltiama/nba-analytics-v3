import { query } from './lib/db';

async function main() {
  try {
    const tables = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'analytics'
    `);
    console.log('Tables:', tables.map(t => t.table_name));

    for (const t of tables) {
      const cols = await query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'analytics' AND table_name = $1
      `, [t.table_name]);
      console.log(`\nTable ${t.table_name} columns:`);
      console.log(cols.map(c => `${c.column_name} (${c.data_type})`).join(', '));
    }
  } catch(e) {
    console.error(e);
  }
}
main();
