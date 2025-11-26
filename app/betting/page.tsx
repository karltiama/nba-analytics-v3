'use client';

import { useState, useEffect } from 'react';
import {
  Header,
  GameCard,
  PlayerCard,
  AIInsightPanel,
  BettingInsights,
  FilterBar,
  GameDetailsModal,
  type Game,
  type PlayerData,
  type Insight,
  type SortOption,
} from '@/components/betting';

// ================================
// DUMMY DATA
// ================================

const dummyGames: Game[] = [
  {
    id: '1',
    homeTeam: { name: 'Los Angeles Lakers', abbreviation: 'LAL', record: '12-8' },
    awayTeam: { name: 'Golden State Warriors', abbreviation: 'GSW', record: '11-9' },
    startTime: '7:30 PM ET',
    homeOdds: { moneyline: -145, spread: -3.5, spreadOdds: -110 },
    awayOdds: { moneyline: +125, spread: +3.5, spreadOdds: -110 },
    overUnder: 234.5,
    overOdds: -110,
    underOdds: -110,
    homeImpliedProb: 59,
    awayImpliedProb: 41,
    isFavorite: 'home',
    isClose: false,
  },
  {
    id: '2',
    homeTeam: { name: 'Boston Celtics', abbreviation: 'BOS', record: '16-4' },
    awayTeam: { name: 'Milwaukee Bucks', abbreviation: 'MIL', record: '13-7' },
    startTime: '7:00 PM ET',
    homeOdds: { moneyline: -180, spread: -4.5, spreadOdds: -110 },
    awayOdds: { moneyline: +155, spread: +4.5, spreadOdds: -110 },
    overUnder: 228.5,
    overOdds: -108,
    underOdds: -112,
    homeImpliedProb: 64,
    awayImpliedProb: 36,
    isFavorite: 'home',
    isClose: false,
  },
  {
    id: '3',
    homeTeam: { name: 'Phoenix Suns', abbreviation: 'PHX', record: '14-6' },
    awayTeam: { name: 'Denver Nuggets', abbreviation: 'DEN', record: '13-7' },
    startTime: '9:00 PM ET',
    homeOdds: { moneyline: +105, spread: +1.5, spreadOdds: -110 },
    awayOdds: { moneyline: -125, spread: -1.5, spreadOdds: -110 },
    overUnder: 230.0,
    overOdds: -105,
    underOdds: -115,
    homeImpliedProb: 48,
    awayImpliedProb: 52,
    isFavorite: 'away',
    isClose: true,
  },
  {
    id: '4',
    homeTeam: { name: 'Miami Heat', abbreviation: 'MIA', record: '10-10' },
    awayTeam: { name: 'New York Knicks', abbreviation: 'NYK', record: '12-8' },
    startTime: '7:30 PM ET',
    homeOdds: { moneyline: +110, spread: +2.0, spreadOdds: -110 },
    awayOdds: { moneyline: -130, spread: -2.0, spreadOdds: -110 },
    overUnder: 215.5,
    overOdds: -110,
    underOdds: -110,
    homeImpliedProb: 47,
    awayImpliedProb: 53,
    isFavorite: 'away',
    isClose: true,
  },
  {
    id: '5',
    homeTeam: { name: 'Dallas Mavericks', abbreviation: 'DAL', record: '13-7' },
    awayTeam: { name: 'Oklahoma City Thunder', abbreviation: 'OKC', record: '15-5' },
    startTime: '8:00 PM ET',
    homeOdds: { moneyline: +140, spread: +4.0, spreadOdds: -110 },
    awayOdds: { moneyline: -165, spread: -4.0, spreadOdds: -110 },
    overUnder: 225.0,
    overOdds: -112,
    underOdds: -108,
    homeImpliedProb: 42,
    awayImpliedProb: 58,
    isFavorite: 'away',
    isClose: false,
  },
  {
    id: '6',
    homeTeam: { name: 'Sacramento Kings', abbreviation: 'SAC', record: '11-9' },
    awayTeam: { name: 'Minnesota Timberwolves', abbreviation: 'MIN', record: '12-8' },
    startTime: '10:00 PM ET',
    homeOdds: { moneyline: -115, spread: -1.5, spreadOdds: -110 },
    awayOdds: { moneyline: -105, spread: +1.5, spreadOdds: -110 },
    overUnder: 222.5,
    overOdds: -110,
    underOdds: -110,
    homeImpliedProb: 51,
    awayImpliedProb: 49,
    isFavorite: 'home',
    isClose: true,
  },
];

const dummyPlayers: PlayerData[] = [
  {
    id: '1',
    name: 'Shai Gilgeous-Alexander',
    team: 'Oklahoma City Thunder',
    teamAbbreviation: 'OKC',
    position: 'PG',
    opponent: 'Dallas Mavericks',
    opponentAbbreviation: 'DAL',
    props: [
      { type: 'points', line: 30.5, trend: 'over', confidence: 78, recentAvg: 33.2, seasonAvg: 31.1 },
      { type: 'assists', line: 5.5, trend: 'over', confidence: 65, recentAvg: 6.4, seasonAvg: 5.8 },
    ],
    recentPoints: [28, 35, 31, 38, 32],
    recentRebounds: [4, 6, 5, 7, 5],
    recentAssists: [5, 7, 6, 8, 6],
    whyText: 'SGA is trending +12% above his projected scoring in the last 5 games. Dallas ranks 25th in perimeter defense and SGA has averaged 35.2 PPG against bottom-10 defensive teams this season.',
    trendPercentage: 12,
    trendDirection: 'up',
  },
  {
    id: '2',
    name: 'Jaylen Brown',
    team: 'Boston Celtics',
    teamAbbreviation: 'BOS',
    position: 'SG',
    opponent: 'Milwaukee Bucks',
    opponentAbbreviation: 'MIL',
    props: [
      { type: 'points', line: 25.5, trend: 'over', confidence: 82, recentAvg: 28.4, seasonAvg: 25.8 },
      { type: 'rebounds', line: 5.5, trend: 'under', confidence: 58, recentAvg: 4.8, seasonAvg: 5.3 },
    ],
    recentPoints: [26, 29, 31, 27, 29],
    recentRebounds: [5, 4, 6, 4, 5],
    recentAssists: [3, 4, 5, 3, 4],
    whyText: 'Jaylen Brown has exceeded 25.5 points in 6 of his last 7 games. With Tatum drawing defensive attention, Brown has been efficient from mid-range.',
    trendPercentage: 8,
    trendDirection: 'up',
  },
  {
    id: '3',
    name: 'Anthony Davis',
    team: 'Los Angeles Lakers',
    teamAbbreviation: 'LAL',
    position: 'PF',
    opponent: 'Golden State Warriors',
    opponentAbbreviation: 'GSW',
    props: [
      { type: 'rebounds', line: 12.5, trend: 'over', confidence: 71, recentAvg: 13.8, seasonAvg: 12.4 },
      { type: 'points', line: 26.5, trend: 'over', confidence: 68, recentAvg: 28.2, seasonAvg: 26.1 },
    ],
    recentPoints: [30, 26, 28, 32, 25],
    recentRebounds: [14, 12, 15, 13, 15],
    recentAssists: [3, 2, 4, 3, 2],
    whyText: 'AD dominates on the glass against small-ball lineups. GSW ranks 28th in defensive rebounding, and AD has grabbed 13+ rebounds in 4 of his last 5.',
    trendPercentage: 6,
    trendDirection: 'up',
  },
  {
    id: '4',
    name: 'Nikola Jokic',
    team: 'Denver Nuggets',
    teamAbbreviation: 'DEN',
    position: 'C',
    opponent: 'Phoenix Suns',
    opponentAbbreviation: 'PHX',
    props: [
      { type: 'assists', line: 9.5, trend: 'over', confidence: 74, recentAvg: 10.8, seasonAvg: 9.2 },
      { type: 'rebounds', line: 12.5, trend: 'under', confidence: 55, recentAvg: 11.4, seasonAvg: 12.8 },
    ],
    recentPoints: [28, 25, 31, 22, 27],
    recentRebounds: [10, 12, 11, 13, 10],
    recentAssists: [12, 9, 11, 10, 12],
    whyText: 'Jokic facilitating at an elite level with Murray back. Phoenix allows 27.3 assists per game (4th worst in NBA), creating passing lanes for Jokic.',
    trendPercentage: 4,
    trendDirection: 'up',
  },
];

const dummyInsights: Insight[] = [
  {
    id: '1',
    type: 'pace',
    title: 'Highest-Pace Game Alert',
    description: 'The Suns–Nuggets matchup is projected to be the highest-pace game today with a combined pace rating of 104.2.',
    timestamp: '2 minutes ago',
    importance: 'high',
  },
  {
    id: '2',
    type: 'trend',
    title: 'Points Prop Trending',
    description: 'Jaylen Brown has exceeded 25.5 points in 6 of his last 7 games. Current line: 25.5 points.',
    timestamp: '5 minutes ago',
    importance: 'high',
  },
  {
    id: '3',
    type: 'sharp',
    title: 'Sharp Money Movement',
    description: 'Sharp money is moving toward the Celtics -4.5. Line has moved from -3.5 to -4.5 since open.',
    timestamp: '8 minutes ago',
    importance: 'medium',
  },
  {
    id: '4',
    type: 'injury',
    title: 'Key Injury Update',
    description: 'Devin Booker (hamstring) upgraded to probable for tonight\'s game vs Denver.',
    timestamp: '12 minutes ago',
    importance: 'high',
  },
  {
    id: '5',
    type: 'value',
    title: 'Value Bet Detected',
    description: 'Our model shows 58% win probability for SAC, but books imply only 51%. Potential value on Kings ML.',
    timestamp: '15 minutes ago',
    importance: 'medium',
  },
  {
    id: '6',
    type: 'general',
    title: 'Total Movement',
    description: 'Lakers-Warriors total dropped from 237 to 234.5. Under tickets coming in at 68%.',
    timestamp: '20 minutes ago',
    importance: 'low',
  },
];

const dummyWidgets = [
  {
    id: '1',
    title: 'Upset Probability',
    value: '3',
    description: 'Games with >25% upset probability today',
    type: 'upset' as const,
    change: '+1',
    changeDirection: 'up' as const,
  },
  {
    id: '2',
    title: 'Pace Mismatch',
    value: 'PHX-DEN',
    description: 'Highest pace differential matchup',
    type: 'pace' as const,
  },
  {
    id: '3',
    title: 'Defense Alert',
    value: 'BOS',
    description: 'Top defensive team hosting tonight',
    type: 'defense' as const,
  },
  {
    id: '4',
    title: 'Props Hitting',
    value: '67%',
    description: 'Over props hitting rate (L7 days)',
    type: 'props' as const,
    change: '+5%',
    changeDirection: 'up' as const,
  },
  {
    id: '5',
    title: 'Model Disagreement',
    value: '2',
    description: 'Games where AI differs from books by >5%',
    type: 'disagreement' as const,
  },
];

const dummyGameDetails = {
  homeTeamStats: {
    offensiveRating: 116.2,
    defensiveRating: 112.8,
    pace: 100.4,
    recentForm: [
      { opponent: 'BKN', result: 'W' as const, score: '118-105', spread: -6.5, covered: true },
      { opponent: 'CHA', result: 'W' as const, score: '124-112', spread: -8.0, covered: true },
      { opponent: 'POR', result: 'L' as const, score: '108-115', spread: -5.5, covered: false },
      { opponent: 'HOU', result: 'W' as const, score: '121-110', spread: -3.5, covered: true },
      { opponent: 'DAL', result: 'W' as const, score: '117-112', spread: +1.5, covered: true },
    ],
  },
  awayTeamStats: {
    offensiveRating: 114.8,
    defensiveRating: 110.2,
    pace: 101.2,
    recentForm: [
      { opponent: 'SAC', result: 'W' as const, score: '122-115', spread: -2.5, covered: true },
      { opponent: 'LAC', result: 'L' as const, score: '105-112', spread: -4.0, covered: false },
      { opponent: 'PHX', result: 'W' as const, score: '118-109', spread: +1.5, covered: true },
      { opponent: 'UTA', result: 'W' as const, score: '130-118', spread: -7.5, covered: true },
      { opponent: 'MIN', result: 'L' as const, score: '108-115', spread: +2.5, covered: false },
    ],
  },
  spreadMovement: [
    { time: 'Open', value: -2.5 },
    { time: '10am', value: -3.0 },
    { time: '12pm', value: -3.0 },
    { time: '2pm', value: -3.5 },
    { time: '4pm', value: -3.5 },
    { time: 'Now', value: -3.5 },
  ],
  totalMovement: [
    { time: 'Open', value: 237.0 },
    { time: '10am', value: 236.5 },
    { time: '12pm', value: 235.5 },
    { time: '2pm', value: 235.0 },
    { time: '4pm', value: 234.5 },
    { time: 'Now', value: 234.5 },
  ],
  historicalMatchups: [
    { date: 'Mar 15, 2024', homeTeam: 'LAL', awayTeam: 'GSW', homeScore: 128, awayScore: 121, totalPoints: 249 },
    { date: 'Feb 22, 2024', homeTeam: 'GSW', awayTeam: 'LAL', homeScore: 115, awayScore: 109, totalPoints: 224 },
    { date: 'Jan 27, 2024', homeTeam: 'LAL', awayTeam: 'GSW', homeScore: 145, awayScore: 144, totalPoints: 289 },
    { date: 'Dec 25, 2023', homeTeam: 'GSW', awayTeam: 'LAL', homeScore: 118, awayScore: 112, totalPoints: 230 },
  ],
  injuries: {
    home: [
      { player: 'Jarred Vanderbilt', status: 'Out' as const, injury: 'Foot' },
      { player: 'Christian Wood', status: 'Questionable' as const, injury: 'Knee' },
    ],
    away: [
      { player: 'Andrew Wiggins', status: 'Probable' as const, injury: 'Ankle' },
    ],
  },
  aiSuggestions: [
    {
      type: 'Spread' as const,
      pick: 'Lakers -3.5',
      confidence: 72,
      explanation: 'Lakers are 8-3 ATS at home this season. Warriors struggle on the road against elite defenses, going 3-6 ATS.',
    },
    {
      type: 'O/U' as const,
      pick: 'Under 234.5',
      confidence: 68,
      explanation: 'Under has hit in 4 of last 5 LAL-GSW matchups. Both teams playing at slower pace in recent games.',
    },
    {
      type: 'ML' as const,
      pick: 'Lakers ML',
      confidence: 65,
      explanation: 'Home court advantage significant for Lakers (9-3 at home). AD dominates small-ball lineups.',
    },
  ],
  aiConfidenceScores: {
    moneyline: 72,
    spread: 68,
    total: 65,
  },
};

// ================================
// MAIN COMPONENT
// ================================

export default function BettingDashboard() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [searchValue, setSearchValue] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('time');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showCloseMatchups, setShowCloseMatchups] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  // Apply dark mode class to html element
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Filter games
  const filteredGames = dummyGames.filter(game => {
    const matchesSearch = searchValue === '' || 
      game.homeTeam.name.toLowerCase().includes(searchValue.toLowerCase()) ||
      game.awayTeam.name.toLowerCase().includes(searchValue.toLowerCase()) ||
      game.homeTeam.abbreviation.toLowerCase().includes(searchValue.toLowerCase()) ||
      game.awayTeam.abbreviation.toLowerCase().includes(searchValue.toLowerCase());
    
    const matchesClose = !showCloseMatchups || game.isClose;
    
    return matchesSearch && matchesClose;
  });

  // Sort games
  const sortedGames = [...filteredGames].sort((a, b) => {
    switch (sortBy) {
      case 'spread':
        return Math.abs(a.homeOdds.spread) - Math.abs(b.homeOdds.spread);
      case 'total':
        return b.overUnder - a.overUnder;
      case 'probability':
        return Math.max(b.homeImpliedProb, b.awayImpliedProb) - Math.max(a.homeImpliedProb, a.awayImpliedProb);
      default:
        return 0;
    }
  });

  const selectedGame = selectedGameId ? dummyGames.find(g => g.id === selectedGameId) : null;

  return (
    <div className="min-h-screen bg-background gradient-mesh">
      <Header
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        isDarkMode={isDarkMode}
        onThemeToggle={() => setIsDarkMode(!isDarkMode)}
      />

      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-6">
        <div className="flex flex-col xl:flex-row gap-6">
          {/* Main Content */}
          <div className="flex-1 space-y-6">
            {/* Filter Bar */}
            <FilterBar
              searchValue={searchValue}
              onSearchChange={setSearchValue}
              sortBy={sortBy}
              onSortChange={setSortBy}
              showFavoritesOnly={showFavoritesOnly}
              onFavoritesToggle={() => setShowFavoritesOnly(!showFavoritesOnly)}
              showCloseMatchups={showCloseMatchups}
              onCloseMatchupsToggle={() => setShowCloseMatchups(!showCloseMatchups)}
            />

            {/* Today's Games */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Today&apos;s Games</h2>
                <span className="text-xs text-muted-foreground">
                  {sortedGames.length} games • Data as of {new Date().toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit',
                    timeZoneName: 'short'
                  })}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sortedGames.map((game, index) => (
                  <div key={game.id} className="slide-up" style={{ animationDelay: `${index * 50}ms` }}>
                    <GameCard
                      game={game}
                      onViewDetails={setSelectedGameId}
                    />
                  </div>
                ))}
              </div>
            </section>

            {/* Betting Insights */}
            <section>
              <BettingInsights widgets={dummyWidgets} />
            </section>

            {/* Players to Watch */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Players to Watch</h2>
                  <p className="text-xs text-muted-foreground">AI-derived standout players for betting props</p>
                </div>
                <span className="text-[10px] px-2 py-1 bg-[#bf5af2]/20 text-[#bf5af2] rounded-full font-medium">
                  AI POWERED
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {dummyPlayers.map((player, index) => (
                  <div key={player.id} className="slide-up" style={{ animationDelay: `${index * 50}ms` }}>
                    <PlayerCard player={player} />
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* AI Insights Sidebar */}
          <aside className="w-full xl:w-80 shrink-0">
            <div className="sticky top-20">
              <AIInsightPanel insights={dummyInsights} />
            </div>
          </aside>
        </div>
      </main>

      {/* Game Details Modal */}
      {selectedGame && (
        <GameDetailsModal
          data={{
            game: selectedGame,
            ...dummyGameDetails,
          }}
          onClose={() => setSelectedGameId(null)}
        />
      )}
    </div>
  );
}

