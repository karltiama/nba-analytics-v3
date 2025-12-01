/**
 * Inspect Player Props API Response
 * 
 * Quick script to see the actual structure of player props API response
 */

import 'dotenv/config';

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

if (!ODDS_API_KEY) {
  console.error('Missing ODDS_API_KEY');
  process.exit(1);
}

async function main() {
  // First, get a game event ID
  const url = new URL(`${ODDS_API_BASE}/sports/basketball_nba/odds`);
  url.searchParams.set('apiKey', ODDS_API_KEY);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', 'h2h');
  url.searchParams.set('oddsFormat', 'american');
  
  const response = await fetch(url.toString());
  const events = await response.json();
  
  if (events.length === 0) {
    console.log('No events found');
    return;
  }
  
  const firstEvent = events[0];
  console.log('First Event:', firstEvent.id);
  console.log('Teams:', firstEvent.away_team, 'vs', firstEvent.home_team);
  console.log('\n');
  
  // Now fetch player props for this event
  const playerPropsUrl = new URL(`${ODDS_API_BASE}/sports/basketball_nba/events/${firstEvent.id}/odds`);
  playerPropsUrl.searchParams.set('apiKey', ODDS_API_KEY);
  playerPropsUrl.searchParams.set('regions', 'us');
  playerPropsUrl.searchParams.set('markets', 'player_points,player_rebounds');
  playerPropsUrl.searchParams.set('oddsFormat', 'american');
  
  const playerPropsResponse = await fetch(playerPropsUrl.toString());
  
  if (!playerPropsResponse.ok) {
    console.error('Error:', playerPropsResponse.status, playerPropsResponse.statusText);
    return;
  }
  
  const playerPropsData = await playerPropsResponse.json();
  
  console.log('='.repeat(80));
  console.log('PLAYER PROPS API RESPONSE STRUCTURE');
  console.log('='.repeat(80));
  console.log('\nFull Response (first 2000 chars):');
  console.log(JSON.stringify(playerPropsData, null, 2).substring(0, 2000));
  console.log('\n...\n');
  
  // Show first few outcomes
  if (playerPropsData.bookmakers && playerPropsData.bookmakers.length > 0) {
    const firstBookmaker = playerPropsData.bookmakers[0];
    console.log('First Bookmaker:', firstBookmaker.key);
    
    if (firstBookmaker.markets && firstBookmaker.markets.length > 0) {
      const firstMarket = firstBookmaker.markets.find((m: any) => m.key.startsWith('player_'));
      if (firstMarket) {
        console.log('\nFirst Player Prop Market:', firstMarket.key);
        console.log('\nFirst 3 Outcomes:');
        firstMarket.outcomes.slice(0, 3).forEach((outcome: any, idx: number) => {
          console.log(`\nOutcome ${idx + 1}:`);
          console.log('  name:', outcome.name);
          console.log('  description:', outcome.description);
          console.log('  point:', outcome.point);
          console.log('  price:', outcome.price);
          console.log('  Full object:', JSON.stringify(outcome, null, 2));
        });
      }
    }
  }
}

main().catch(console.error);





