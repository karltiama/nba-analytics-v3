/**
 * Read-only capture of display.scoreboard_games / scoreboard_player_lines for three live preseason
 * games at 2026-10-11T00:06:37Z. Test-only replay data; not imported by app code.
 * Line tuple: playerId, teamId, name, min, pts, reb, ast, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb.
 */

import type { ScoreboardGame } from '@/lib/scoreboard/contract';
import { scoreboardGame } from '@/lib/scoreboard/fixtures';

type Tuple = [string, string, string, string, number, number, number, number, number, number, number, number, number, number, number];

function lines(rows: Tuple[]): ScoreboardGame['box_score']['players'] {
  return rows.map(([playerId, teamId, name, min, pts, reb, ast, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb]) => ({
    playerId, teamId, name, min, pts, reb, ast, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb,
  }));
}

const OBSERVED = '2026-10-11T00:06:37.639Z';

/** Q2 4:24, ATL 53 at IND 46. Totals reconcile; no gap reaches a threshold. */
export function capturedIndAtl(): ScoreboardGame {
  return scoreboardGame({
    game_id: '21717905', lifecycle: 'live', period: 2, clock: 'Q2 4:24', et_date: '2026-10-10',
    acquired_at: '2026-10-11T00:06:36.450Z',
    home: { provider_team_id: '12', abbreviation: 'IND', name: 'Indiana Pacers', score: 46 },
    visitor: { provider_team_id: '1', abbreviation: 'ATL', name: 'Atlanta Hawks', score: 53 },
    box_score: { completeness: 'live_partial', acquired_at: OBSERVED, players: lines([
      ['1028274126', '1', 'RayJ Dennis', '2', 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      ['1057279093', '1', 'Asa Newell', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1057846878', '1', 'Kobe Johnson', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1091340263', '1', 'Kingston Flemings', '8', 6, 0, 0, 3, 4, 0, 1, 0, 0, 0, 0],
      ['1091350401', '1', 'Zuby Ejiofor', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1098740515', '1', 'Cameron Corhen', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['17896040', '1', 'Jalen Johnson', '12', 10, 4, 2, 5, 7, 0, 0, 0, 0, 0, 4],
      ['17896045', '1', 'Corey Kispert', '10', 3, 2, 3, 1, 3, 1, 2, 0, 0, 1, 1],
      ['17896078', '1', 'Aaron Wiggins', '11', 13, 1, 0, 4, 8, 3, 6, 2, 2, 0, 1],
      ['19465326', '1', 'Jock Landale', '9', 2, 3, 1, 0, 3, 0, 1, 2, 2, 1, 2],
      ['303', '1', 'CJ McCollum', '8', 10, 3, 0, 1, 2, 1, 2, 7, 7, 0, 3],
      ['3547244', '1', 'Onyeka Okongwu', '10', 4, 1, 1, 1, 4, 0, 3, 2, 2, 0, 1],
      ['38017677', '1', 'Dyson Daniels', '11', 3, 2, 2, 1, 2, 1, 1, 0, 0, 0, 2],
      ['56677722', '1', 'Jalen Wilson', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['666541', '1', 'Luguentz Dort', '12', 2, 2, 0, 1, 4, 0, 2, 0, 0, 1, 1],
      ['1091466792', '12', 'Braden Smith', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1097595232', '12', 'Keba Keita', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1097595694', '12', 'Rienk Mast', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['17896103', '12', 'Jay Huff', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['242', '12', 'James Johnson', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['340', '12', 'Larry Nance Jr.', '6', 3, 5, 1, 1, 2, 0, 1, 1, 2, 0, 5],
      ['3547243', '12', 'Obi Toppin', '7', 4, 1, 0, 2, 4, 0, 1, 0, 0, 0, 1],
      ['3547250', '12', 'Aaron Nesmith', '11', 4, 1, 3, 1, 2, 0, 1, 2, 2, 0, 1],
      ['360', '12', 'Kelly Oubre Jr.', '11', 5, 0, 0, 2, 4, 1, 2, 0, 0, 0, 0],
      ['38017507', '12', 'Andrew Nembhard', '12', 7, 0, 1, 2, 3, 1, 2, 2, 2, 0, 0],
      ['416', '12', 'Pascal Siakam', '12', 7, 2, 2, 2, 5, 1, 2, 2, 2, 0, 2],
      ['44477085', '12', 'Quenton Jackson', '7', 4, 0, 1, 1, 2, 0, 1, 2, 2, 0, 0],
      ['493', '12', 'Ivica Zubac', '13', 7, 4, 1, 2, 3, 0, 0, 3, 6, 0, 4],
      ['56677832', '12', 'Jarace Walker', '8', 5, 0, 2, 1, 3, 1, 2, 2, 2, 0, 0],
      ['56677849', '12', 'Kobe Brown', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['56677861', '12', 'Ben Sheppard', '8', 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1],
      ['56677862', '12', 'Jalen Slawson', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ]) },
  });
}

/** Q3 11:43, LAC 45 at TOR 59. Toronto's player points sum to 57: the box lags the score. */
export function capturedTorLac(): ScoreboardGame {
  return scoreboardGame({
    game_id: '21717908', lifecycle: 'live', period: 3, clock: 'Q3 11:43', et_date: '2026-10-10',
    acquired_at: '2026-10-11T00:06:36.450Z',
    home: { provider_team_id: '28', abbreviation: 'TOR', name: 'Toronto Raptors', score: 59 },
    visitor: { provider_team_id: '13', abbreviation: 'LAC', name: 'LA Clippers', score: 45 },
    box_score: { completeness: 'live_partial', acquired_at: OBSERVED, players: lines([
      ['1028035215', '13', 'Cam Christie', '4', 2, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0],
      ['1028265377', '13', 'Yuki Kawamura', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1057849029', '13', 'Jahmyl Telfort', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1091343544', '13', 'Keaton Wagler', '8', 2, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0],
      ['1091465658', '13', 'Baba Miller', '5', 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
      ['1091475805', '13', 'Nick Martinelli', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['139', '13', 'Kris Dunn', '15', 1, 1, 6, 0, 1, 0, 1, 1, 2, 0, 1],
      ['17896035', '13', 'Isaiah Jackson', '8', 4, 2, 0, 2, 3, 0, 0, 0, 0, 1, 1],
      ['247', '13', 'Derrick Jones Jr.', '17', 5, 2, 0, 2, 3, 1, 1, 0, 2, 1, 1],
      ['283', '13', 'Brook Lopez', '15', 6, 7, 1, 3, 6, 0, 1, 0, 0, 1, 6],
      ['38017693', '13', 'Blake Wesley', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['56677582', '13', 'Jalen Pickett', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['56677828', '13', 'Gradey Dick', '6', 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1],
      ['56677856', '13', 'Jordan Miller', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['666581', '13', 'Darius Garland', '19', 11, 0, 4, 4, 11, 1, 4, 2, 2, 0, 0],
      ['666609', '13', 'Rui Hachimura', '18', 14, 3, 1, 3, 8, 1, 3, 7, 7, 1, 2],
      ['1028029111', '28', "Ja'Kobe Walter", '13', 3, 0, 1, 1, 4, 1, 4, 0, 0, 0, 0],
      ['1028038426', '28', 'Jamal Shead', '9', 0, 0, 2, 0, 3, 0, 2, 0, 0, 0, 0],
      ['1028243201', '28', 'Jamison Battle', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1057268940', '28', 'Collin Murray-Boyles', '10', 9, 5, 2, 3, 5, 0, 0, 3, 5, 1, 4],
      ['1057846535', '28', 'Chucky Hepburn', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1059753274', '28', 'Malachi Smith', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1080636470', '28', 'Tyreke Key', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1091463018', '28', 'Jaden Bradley', '7', 2, 1, 0, 1, 1, 0, 0, 0, 0, 0, 1],
      ['1098242991', '28', 'Nimari Burnett', '4', 3, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
      ['1099677195', '28', 'Tyson Degenhart', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['12', '28', 'Kyle Anderson', '10', 0, 1, 1, 0, 2, 0, 0, 0, 0, 1, 0],
      ['17896055', '28', 'Scottie Barnes', '15', 7, 7, 2, 3, 8, 1, 2, 0, 0, 4, 3],
      ['3547269', '28', 'Immanuel Quickley', '14', 9, 3, 2, 3, 4, 2, 3, 1, 2, 0, 3],
      ['373', '28', 'Jakob Poeltl', '16', 9, 4, 1, 3, 4, 0, 0, 3, 6, 2, 2],
      ['56677852', '28', 'Andre Jackson Jr.', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['64269023', '28', 'Trey Jemison', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['666423', '28', 'RJ Barrett', '16', 15, 4, 4, 5, 8, 2, 3, 3, 5, 1, 3],
    ]) },
  });
}

/** Q2 4:55, DET 40 at WAS 52. Totals reconcile; 3P%, eFG%, and FTA gaps all qualify. */
export function capturedWasDet(): ScoreboardGame {
  return scoreboardGame({
    game_id: '21826162', lifecycle: 'live', period: 2, clock: 'Q2 4:55', et_date: '2026-10-10',
    acquired_at: '2026-10-11T00:06:36.450Z',
    home: { provider_team_id: '30', abbreviation: 'WAS', name: 'Washington Wizards', score: 52 },
    visitor: { provider_team_id: '9', abbreviation: 'DET', name: 'Detroit Pistons', score: 40 },
    box_score: { completeness: 'live_partial', acquired_at: OBSERVED, players: lines([
      ['1016384149', '30', 'Tristan Vukcevic', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1028025235', '30', 'Carlton Carrington', '4', 5, 0, 0, 2, 2, 1, 1, 0, 0, 0, 0],
      ['1028026060', '30', 'KyShawn George', '11', 8, 2, 0, 2, 3, 0, 1, 4, 4, 0, 2],
      ['1028028405', '30', 'Alexandre Sarr', '10', 4, 1, 0, 2, 3, 0, 1, 0, 0, 1, 0],
      ['1028203324', '30', 'Reece Beekman', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1057262985', '30', 'Tre Johnson', '10', 12, 1, 1, 4, 6, 4, 5, 0, 0, 0, 1],
      ['1057279594', '30', 'Will Riley', '1', 2, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0],
      ['1057391756', '30', 'Jamir Watkins', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1091340077', '30', 'AJ Dybantsa', '14', 12, 6, 2, 3, 7, 0, 1, 6, 10, 0, 6],
      ['1091465991', '30', 'Felix Okpara', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['117', '30', 'Anthony Davis', '10', 8, 6, 2, 3, 7, 0, 0, 2, 2, 2, 4],
      ['17896036', '30', 'Tre Mann', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['17896039', '30', 'Justin Champagnie', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['22', '30', 'Deandre Ayton', '7', 1, 3, 1, 0, 0, 0, 0, 1, 2, 0, 3],
      ['266', '30', 'Skal Labissiere', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['315', '30', 'Khris Middleton', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['3547302', '30', 'Anthony Gill', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['38017720', '30', 'Trevor Keels', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['490', '30', 'Trae Young', '14', 0, 1, 8, 0, 2, 0, 2, 0, 0, 1, 0],
      ['56677844', '30', 'Bilal Coulibaly', '9', 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      ['56677854', '30', 'Chris Livingston', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['101', '9', 'John Collins', '9', 2, 2, 0, 1, 5, 0, 3, 0, 0, 0, 2],
      ['1028026508', '9', 'Ronald Holland II', '6', 5, 1, 0, 2, 2, 0, 0, 1, 2, 1, 0],
      ['1028205331', '9', 'Isaac Jones', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1028240128', '9', 'Daniss Jenkins', '13', 9, 0, 4, 3, 4, 2, 3, 1, 2, 0, 0],
      ['1028264794', '9', 'Elijah Harkless', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1028267166', '9', 'Tolu Smith', '4', 2, 3, 0, 0, 0, 0, 0, 2, 2, 2, 1],
      ['1057389625', '9', 'Chaz Lanier', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1057849497', '9', 'Brice Williams', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1091352549', '9', 'Ebuka Okorie', '0', 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
      ['1091476372', '9', 'Ugonna Onyenso', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['1098712849', '9', 'John Ukomadu', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['17896075', '9', 'Cade Cunningham', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['221', '9', 'Kevin Huerter', '10', 3, 2, 3, 1, 5, 1, 4, 0, 0, 0, 2],
      ['3547270', '9', 'Paul Reed', '13', 8, 4, 2, 4, 5, 0, 0, 0, 0, 1, 3],
      ['3547272', '9', 'Isaiah Joe', '6', 0, 0, 1, 0, 3, 0, 3, 0, 0, 0, 0],
      ['38017694', '9', 'Jalen Duren', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['383', '9', 'Taurean Prince', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['397', '9', 'Duncan Robinson', '12', 7, 2, 2, 3, 6, 1, 3, 0, 0, 2, 0],
      ['56677826', '9', 'Ausar Thompson', '11', 2, 0, 2, 1, 7, 0, 1, 0, 0, 0, 0],
      ['666604', '9', 'Javonte Green', '5', 2, 1, 0, 1, 2, 0, 1, 0, 0, 0, 1],
    ]) },
  });
}
