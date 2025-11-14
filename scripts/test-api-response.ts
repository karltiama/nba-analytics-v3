import 'dotenv/config';
import axios from 'axios';

const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY;

async function testApiResponse() {
  const date = '2025-10-21';
  const season = 2025;

  const params = {
    start_date: date,
    end_date: date,
    'seasons[]': season,
    per_page: 10,
  };

  const response = await axios.get('https://api.balldontlie.io/v1/games', {
    params,
    headers: {
      Authorization: BALLDONTLIE_API_KEY,
    },
  });

  console.log('API Response for', date, ':');
  console.log('Total games:', response.data.data?.length || 0);
  
  if (response.data.data && response.data.data.length > 0) {
    const game = response.data.data[0];
    console.log('\nFirst game raw response:');
    console.log(JSON.stringify(game, null, 2));
    
    console.log('\nScore fields:');
    console.log('home_team_score:', game.home_team_score, typeof game.home_team_score);
    console.log('visitor_team_score:', game.visitor_team_score, typeof game.visitor_team_score);
    console.log('status:', game.status);
  }
}

testApiResponse().catch(console.error);



