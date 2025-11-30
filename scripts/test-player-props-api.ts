/**
 * Test Player Props API Call
 * 
 * Fetches NBA player props from Odds API to see what data we get.
 * This is a test script to inspect the API response before processing.
 * 
 * Requirements:
 * - ODDS_API_KEY in .env file
 * 
 * Usage:
 *   npx tsx scripts/test-player-props-api.ts
 * 
 * What it does:
 * 1. Fetches odds with player props for today's NBA games
 * 2. Inspects the response structure
 * 3. Shows what player prop markets are available
 * 4. Shows sample player prop data
 */

import 'dotenv/config';

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

if (!ODDS_API_KEY) {
  console.error('Missing ODDS_API_KEY. Set it in your environment or .env file.');
  process.exit(1);
}

// NBA Player Props from Odds API docs:
// https://the-odds-api.com/sports-odds-data/betting-markets.html#nba-ncaab-wnba-player-props-api
// Note: Some markets listed in docs may not be available via the /odds endpoint
// Valid markets (tested):
const NBA_PLAYER_PROP_MARKETS = [
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
  'player_steals',
  'player_blocks',
  'player_turnovers',
  'player_first_basket',
  'player_double_double',
  'player_triple_double',
];

// Invalid markets (not available via /odds endpoint, may require /events/{eventId}/odds):
// 'player_first_field_goal',
// 'player_last_basket',
// 'player_pts_asts',
// 'player_pts_rebs',
// 'player_pts_rebs_asts',
// 'player_rebs_asts',

async function fetchPlayerProps() {
  console.log('🔍 Step 1: Fetching team odds to get event IDs...\n');
  
  // Step 1: Get events (team odds only)
  const eventsUrl = new URL(`${ODDS_API_BASE}/sports/basketball_nba/odds`);
  eventsUrl.searchParams.set('apiKey', ODDS_API_KEY);
  eventsUrl.searchParams.set('regions', 'us');
  eventsUrl.searchParams.set('markets', 'h2h,spreads,totals');
  eventsUrl.searchParams.set('oddsFormat', 'american');
  eventsUrl.searchParams.set('dateFormat', 'iso');

  console.log(`URL: ${eventsUrl.toString().replace(ODDS_API_KEY, '***')}\n`);

  try {
    const eventsResponse = await fetch(eventsUrl.toString());

    if (!eventsResponse.ok) {
      const errorText = await eventsResponse.text();
      throw new Error(`Odds API error: ${eventsResponse.status} ${eventsResponse.statusText}\n${errorText}`);
    }

    const events = await eventsResponse.json();
    console.log(`✅ Fetched ${events.length} events\n`);
    
    if (events.length === 0) {
      console.log('⚠️  No events found. This might mean:');
      console.log('   - No games scheduled for today');
      console.log('   - Games are too far in the future');
      console.log('   - API returned empty response');
      return;
    }

    // Filter to today's games
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const todayEvents = events.filter((event: any) => {
      const eventDate = new Date(event.commence_time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      return eventDate === today;
    });

    console.log(`📅 Today's games: ${todayEvents.length} (out of ${events.length} total)\n`);

    if (todayEvents.length === 0) {
      console.log('⚠️  No games scheduled for today. Showing all events for testing...\n');
      analyzeResponse(events);
      return;
    }

    // Step 2: Fetch player props for first event (as test)
    console.log('🔍 Step 2: Testing player props for first event...\n');
    const firstEvent = todayEvents[0];
    console.log(`Testing event: ${firstEvent.away_team} @ ${firstEvent.home_team}`);
    console.log(`Event ID: ${firstEvent.id}\n`);

    const playerPropsUrl = new URL(`${ODDS_API_BASE}/sports/basketball_nba/events/${firstEvent.id}/odds`);
    playerPropsUrl.searchParams.set('apiKey', ODDS_API_KEY);
    playerPropsUrl.searchParams.set('regions', 'us');
    playerPropsUrl.searchParams.set('markets', NBA_PLAYER_PROP_MARKETS.join(','));
    playerPropsUrl.searchParams.set('oddsFormat', 'american');
    playerPropsUrl.searchParams.set('dateFormat', 'iso');

    console.log(`URL: ${playerPropsUrl.toString().replace(ODDS_API_KEY, '***')}\n`);

    const propsResponse = await fetch(playerPropsUrl.toString());

    if (!propsResponse.ok) {
      const errorText = await propsResponse.text();
      console.error(`❌ Error fetching player props: ${propsResponse.status} ${propsResponse.statusText}`);
      console.error(errorText);
      console.log('\n⚠️  Player props may not be available for this event, or endpoint may require different parameters.');
      console.log('\n📊 Analyzing team odds only...\n');
      analyzeResponse(events);
      return;
    }

    const playerPropsData = await propsResponse.json();
    console.log(`✅ Fetched player props data\n`);
    
    // Combine team odds with player props for analysis
    const combinedData = events.map((event: any) => {
      if (event.id === firstEvent.id) {
        // Merge player props into the event
        if (playerPropsData.bookmakers) {
          event.bookmakers = event.bookmakers || [];
          // Add player prop markets to existing bookmakers or create new ones
          for (const bookmaker of playerPropsData.bookmakers) {
            const existingBookmaker = event.bookmakers.find((b: any) => b.key === bookmaker.key);
            if (existingBookmaker) {
              existingBookmaker.markets = [...(existingBookmaker.markets || []), ...(bookmaker.markets || [])];
            } else {
              event.bookmakers.push(bookmaker);
            }
          }
        }
      }
      return event;
    });

    analyzeResponse(combinedData);
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

function analyzeResponse(events: any[]) {
  console.log('='.repeat(80));
  console.log('RESPONSE ANALYSIS');
  console.log('='.repeat(80));
  
  // Count events with player props
  let eventsWithPlayerProps = 0;
  const marketTypesFound = new Set<string>();
  const playerPropMarketsFound = new Set<string>();
  const bookmakersWithProps = new Set<string>();
  const samplePlayerProps: any[] = [];

  for (const event of events) {
    const eventDate = new Date(event.commence_time);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDateOnly = new Date(eventDate);
    eventDateOnly.setHours(0, 0, 0, 0);
    
    const isToday = eventDateOnly.getTime() === today.getTime();
    const dateStr = eventDate.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric',
      timeZone: 'America/New_York'
    });
    
    console.log(`\n📅 Event: ${event.away_team} @ ${event.home_team}`);
    console.log(`   Date: ${dateStr} ${isToday ? '✅ TODAY' : '⏭️  Future'}`);
    console.log(`   Event ID: ${event.id}`);
    
    if (!event.bookmakers || event.bookmakers.length === 0) {
      console.log('   ⚠️  No bookmakers available');
      continue;
    }

    console.log(`   Bookmakers: ${event.bookmakers.length}`);
    
    let hasPlayerProps = false;
    for (const bookmaker of event.bookmakers) {
      const markets = bookmaker.markets || [];
      const marketKeys = markets.map((m: any) => m.key);
      
      // Track all market types
      marketKeys.forEach((key: string) => marketTypesFound.add(key));
      
      // Check for player props
      const playerPropMarkets = markets.filter((m: any) => 
        m.key.startsWith('player_')
      );
      
      if (playerPropMarkets.length > 0) {
        hasPlayerProps = true;
        bookmakersWithProps.add(bookmaker.key);
        playerPropMarkets.forEach((m: any) => playerPropMarketsFound.add(m.key));
        
        // Collect sample player props
        for (const market of playerPropMarkets) {
          if (market.outcomes && market.outcomes.length > 0) {
            const firstOutcome = market.outcomes[0];
            samplePlayerProps.push({
              event: `${event.away_team} @ ${event.home_team}`,
              bookmaker: bookmaker.key,
              market: market.key,
              player: firstOutcome.name,
              description: firstOutcome.description,
              point: firstOutcome.point,
              price: firstOutcome.price,
            });
          }
        }
      }
    }
    
    if (hasPlayerProps) {
      eventsWithPlayerProps++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total events: ${events.length}`);
  console.log(`Events with player props: ${eventsWithPlayerProps}`);
  console.log(`Bookmakers offering player props: ${bookmakersWithProps.size}`);
  console.log(`  ${Array.from(bookmakersWithProps).join(', ')}`);
  
  console.log(`\n📊 Market Types Found (${marketTypesFound.size}):`);
  const sortedMarkets = Array.from(marketTypesFound).sort();
  for (const market of sortedMarkets) {
    const isPlayerProp = market.startsWith('player_');
    console.log(`   ${isPlayerProp ? '🎯' : '  '} ${market}`);
  }
  
  console.log(`\n🎯 Player Prop Markets Found (${playerPropMarketsFound.size}):`);
  const sortedPlayerProps = Array.from(playerPropMarketsFound).sort();
  for (const prop of sortedPlayerProps) {
    console.log(`   ✅ ${prop}`);
  }
  
  // Show which props we requested but didn't get
  const requestedButNotFound = NBA_PLAYER_PROP_MARKETS.filter(
    prop => !playerPropMarketsFound.has(prop)
  );
  if (requestedButNotFound.length > 0) {
    console.log(`\n⚠️  Requested but not found (${requestedButNotFound.length}):`);
    for (const prop of requestedButNotFound) {
      console.log(`   ❌ ${prop}`);
    }
  }
  
  // Show sample player props
  if (samplePlayerProps.length > 0) {
    console.log(`\n📋 Sample Player Props (first ${Math.min(10, samplePlayerProps.length)}):`);
    for (let i = 0; i < Math.min(10, samplePlayerProps.length); i++) {
      const prop = samplePlayerProps[i];
      console.log(`\n   ${i + 1}. ${prop.player} - ${prop.market}`);
      console.log(`      Bookmaker: ${prop.bookmaker}`);
      console.log(`      Game: ${prop.event}`);
      console.log(`      Description: ${prop.description || 'N/A'}`);
      console.log(`      Line: ${prop.point ?? 'N/A'}`);
      console.log(`      Odds: ${prop.price}`);
    }
  }
  
  // Schema compatibility check
  console.log(`\n` + '='.repeat(80));
  console.log('SCHEMA COMPATIBILITY CHECK');
  console.log('='.repeat(80));
  
  const statTypes = Array.from(playerPropMarketsFound)
    .map(key => key.replace('player_', ''))
    .filter(key => key !== 'first_basket' && key !== 'first_field_goal' && key !== 'last_basket' && key !== 'double_double' && key !== 'triple_double');
  
  console.log(`\n✅ Stat types that can be stored in stat_type field:`);
  for (const statType of statTypes.sort()) {
    console.log(`   - ${statType}`);
  }
  
  const specialProps = Array.from(playerPropMarketsFound)
    .filter(key => ['first_basket', 'first_field_goal', 'last_basket', 'double_double', 'triple_double'].some(special => key.includes(special)));
  
  if (specialProps.length > 0) {
    console.log(`\n⚠️  Special prop types (Yes/No bets, not Over/Under):`);
    for (const prop of specialProps) {
      console.log(`   - ${prop} (may need special handling)`);
    }
    console.log(`\n   Note: These are Yes/No bets, not Over/Under.`);
    console.log(`   They might not have a 'point' value, just odds.`);
    console.log(`   Schema should still work, but stat_line might be NULL.`);
  }
  
  console.log(`\n✅ Schema Status:`);
  console.log(`   - stat_type field: TEXT (can store any value) ✅`);
  console.log(`   - stat_line field: NUMERIC (can store NULL for Yes/No bets) ✅`);
  console.log(`   - side field: 'over' | 'under' (Yes/No bets might need 'yes' | 'no') ⚠️`);
  
  if (specialProps.length > 0) {
    console.log(`\n⚠️  RECOMMENDATION:`);
    console.log(`   Consider updating schema to support 'yes' | 'no' for side field`);
    console.log(`   Or handle Yes/No bets differently (e.g., side = NULL, use description)`);
  }
}

// Run the test
fetchPlayerProps().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

