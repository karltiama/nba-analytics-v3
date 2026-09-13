export const NBA_TEAM_LOGOS = {
  ATL: '/nba/teams/atl.svg',
  BOS: '/nba/teams/bos.svg',
  BKN: '/nba/teams/bkn.svg',
  CHA: '/nba/teams/cha.svg',
  CHI: '/nba/teams/chi.svg',
  CLE: '/nba/teams/cle.svg',
  DAL: '/nba/teams/dal.svg',
  DEN: '/nba/teams/den.svg',
  DET: '/nba/teams/det.svg',
  GSW: '/nba/teams/gsw.svg',
  HOU: '/nba/teams/hou.svg',
  IND: '/nba/teams/ind.svg',
  LAC: '/nba/teams/lac.svg',
  LAL: '/nba/teams/lal.svg',
  MEM: '/nba/teams/mem.svg',
  MIA: '/nba/teams/mia.svg',
  MIL: '/nba/teams/mil.svg',
  MIN: '/nba/teams/min.svg',
  NOP: '/nba/teams/nop.svg',
  NYK: '/nba/teams/nyk.svg',
  OKC: '/nba/teams/okc.svg',
  ORL: '/nba/teams/orl.svg',
  PHI: '/nba/teams/phi.svg',
  PHX: '/nba/teams/phx.svg',
  POR: '/nba/teams/por.svg',
  SAC: '/nba/teams/sac.svg',
  SAS: '/nba/teams/sas.svg',
  TOR: '/nba/teams/tor.svg',
  UTA: '/nba/teams/uta.svg',
  WAS: '/nba/teams/was.svg',
} as const;

export type NbaTeamAbbreviation = keyof typeof NBA_TEAM_LOGOS;

export const NBA_TEAM_NAMES: Record<NbaTeamAbbreviation, string> = {
  ATL: 'Atlanta Hawks',
  BOS: 'Boston Celtics',
  BKN: 'Brooklyn Nets',
  CHA: 'Charlotte Hornets',
  CHI: 'Chicago Bulls',
  CLE: 'Cleveland Cavaliers',
  DAL: 'Dallas Mavericks',
  DEN: 'Denver Nuggets',
  DET: 'Detroit Pistons',
  GSW: 'Golden State Warriors',
  HOU: 'Houston Rockets',
  IND: 'Indiana Pacers',
  LAC: 'LA Clippers',
  LAL: 'Los Angeles Lakers',
  MEM: 'Memphis Grizzlies',
  MIA: 'Miami Heat',
  MIL: 'Milwaukee Bucks',
  MIN: 'Minnesota Timberwolves',
  NOP: 'New Orleans Pelicans',
  NYK: 'New York Knicks',
  OKC: 'Oklahoma City Thunder',
  ORL: 'Orlando Magic',
  PHI: 'Philadelphia 76ers',
  PHX: 'Phoenix Suns',
  POR: 'Portland Trail Blazers',
  SAC: 'Sacramento Kings',
  SAS: 'San Antonio Spurs',
  TOR: 'Toronto Raptors',
  UTA: 'Utah Jazz',
  WAS: 'Washington Wizards',
};

/** Common provider aliases → canonical abbreviations used by the asset map. */
const NBA_TEAM_ALIASES: Record<string, NbaTeamAbbreviation> = {
  BRK: 'BKN',
  CHO: 'CHA',
  CHH: 'CHA',
  PHO: 'PHX',
  GS: 'GSW',
  NO: 'NOP',
  NY: 'NYK',
  SA: 'SAS',
  UTAH: 'UTA',
  WSH: 'WAS',
};

/**
 * Relative visual scale inside the fixed TeamLogo box.
 * Only override teams that look too small/large vs the set.
 */
export const TEAM_LOGO_SCALE: Partial<Record<NbaTeamAbbreviation, number>> = {
  BOS: 0.96,
  LAL: 1.04,
  NYK: 0.98,
  SAS: 1.08,
  MIA: 1.02,
};

export function isNbaTeamAbbreviation(value: string): value is NbaTeamAbbreviation {
  return Object.prototype.hasOwnProperty.call(NBA_TEAM_LOGOS, value);
}

export function resolveNbaTeamAbbreviation(team: string): NbaTeamAbbreviation | null {
  const normalized = team.trim().toUpperCase();
  if (isNbaTeamAbbreviation(normalized)) return normalized;
  return NBA_TEAM_ALIASES[normalized] ?? null;
}

export function getNbaTeamLogoSrc(team: string): string | null {
  const abbr = resolveNbaTeamAbbreviation(team);
  return abbr ? NBA_TEAM_LOGOS[abbr] : null;
}

export function getNbaTeamName(team: string): string | null {
  const abbr = resolveNbaTeamAbbreviation(team);
  return abbr ? NBA_TEAM_NAMES[abbr] : null;
}
