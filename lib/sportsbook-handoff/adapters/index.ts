import type { SportsbookHandoffProvider } from '../types';
import { betmgmHandoffAdapter } from './betmgm';
import { caesarsHandoffAdapter } from './caesars';
import { draftkingsHandoffAdapter } from './draftkings';
import { fanaticsHandoffAdapter } from './fanatics';
import { fanduelHandoffAdapter } from './fanduel';
import type { SportsbookHandoffAdapter } from './types';

const ADAPTERS: Record<SportsbookHandoffProvider, SportsbookHandoffAdapter> = {
  draftkings: draftkingsHandoffAdapter,
  fanduel: fanduelHandoffAdapter,
  caesars: caesarsHandoffAdapter,
  fanatics: fanaticsHandoffAdapter,
  betmgm: betmgmHandoffAdapter,
};

export function getSportsbookHandoffAdapter(
  sportsbook: SportsbookHandoffProvider
): SportsbookHandoffAdapter {
  return ADAPTERS[sportsbook];
}

export function listSportsbookHandoffAdapters(): SportsbookHandoffAdapter[] {
  return Object.values(ADAPTERS);
}

export type { SportsbookHandoffAdapter } from './types';
