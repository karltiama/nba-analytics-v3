import type { XrayPlayerRecord, PlayerFieldResolution, PlayerResolutionCandidate } from './types';
import { levenshtein, nameTokens, normalizePersonName } from './names';

const FUZZY_LAST_MIN_LEN = 5;
const FUZZY_MAX_DISTANCE = 1;

function candidateOf(player: XrayPlayerRecord): PlayerResolutionCandidate {
  return {
    playerId: player.playerId,
    entityId: player.entityId,
    displayName: player.displayName,
  };
}

function uniquePlayers(rows: XrayPlayerRecord[]): XrayPlayerRecord[] {
  const seen = new Set<string>();
  const out: XrayPlayerRecord[] = [];
  for (const row of rows) {
    if (seen.has(row.playerId)) continue;
    seen.add(row.playerId);
    out.push(row);
  }
  return out;
}

function packResolved(player: XrayPlayerRecord, extracted: string): PlayerFieldResolution {
  return {
    status: 'RESOLVED',
    value: {
      playerId: player.playerId,
      entityId: player.entityId,
      displayName: player.displayName,
      nbaPlayerId: player.nbaPlayerId ?? null,
    },
    extracted,
    reason: null,
    candidates: [candidateOf(player)],
  };
}

function packNeeds(extracted: string, players: XrayPlayerRecord[], reason: string): PlayerFieldResolution {
  const unique = uniquePlayers(players);
  return {
    status: 'NEEDS_CONFIRMATION',
    value: null,
    extracted,
    reason,
    candidates: unique.map(candidateOf),
  };
}

function packUnresolved(extracted: string | null, reason: string): PlayerFieldResolution {
  return {
    status: 'UNRESOLVED',
    value: null,
    extracted,
    reason,
    candidates: [],
  };
}

export function resolvePlayerIdentityFromName(
  rawName: string | null | undefined,
  players: XrayPlayerRecord[]
): PlayerFieldResolution {
  const extracted = (rawName ?? '').trim();
  if (!extracted) return packUnresolved(null, 'EMPTY_NAME');

  const needle = normalizePersonName(extracted);
  if (!needle) return packUnresolved(extracted, 'EMPTY_NAME');
  const tokens = nameTokens(needle);
  const lastToken = tokens[tokens.length - 1] ?? '';
  const firstToken = tokens.length > 1 ? tokens[0] ?? '' : '';

  const exactFull = players.filter((p) => normalizePersonName(p.displayName) === needle);
  if (exactFull.length === 1) return packResolved(exactFull[0]!, extracted);
  if (exactFull.length > 1) return packNeeds(extracted, exactFull, 'AMBIGUOUS_FULL_NAME');

  if (firstToken.length >= 2 && lastToken.length >= 2) {
    const firstLast = players.filter((p) => {
      return normalizePersonName(p.firstName) === firstToken && normalizePersonName(p.lastName) === lastToken;
    });
    if (firstLast.length === 1) return packResolved(firstLast[0]!, extracted);
    if (firstLast.length > 1) return packNeeds(extracted, firstLast, 'AMBIGUOUS_FIRST_LAST');
  }

  if (tokens.length === 1 && lastToken.length >= 2) {
    const lastOnly = players.filter((p) => normalizePersonName(p.lastName) === lastToken);
    if (lastOnly.length === 1) return packResolved(lastOnly[0]!, extracted);
    if (lastOnly.length > 1) return packNeeds(extracted, lastOnly, 'AMBIGUOUS_LAST_NAME');
  }

  if (firstToken.length === 1 && lastToken.length >= 2) {
    const initial = players.filter((p) => {
      const first = normalizePersonName(p.firstName);
      return first.startsWith(firstToken) && normalizePersonName(p.lastName) === lastToken;
    });
    if (initial.length === 0) return packUnresolved(extracted, 'NO_PLAYER');
    return packNeeds(extracted, initial, 'INITIALS_AMBIGUOUS');
  }

  const fuzzyLast =
    lastToken.length >= FUZZY_LAST_MIN_LEN
      ? uniquePlayers(
          players.filter((p) => levenshtein(normalizePersonName(p.lastName), lastToken) <= FUZZY_MAX_DISTANCE)
        )
      : [];

  if (tokens.length === 1 && fuzzyLast.length === 1) {
    return packNeeds(extracted, fuzzyLast, 'FUZZY_LAST_NAME');
  }
  if (tokens.length === 1 && fuzzyLast.length > 1) {
    return packNeeds(extracted, fuzzyLast, 'AMBIGUOUS_FUZZY_LAST_NAME');
  }

  if (firstToken.length >= 2 && lastToken.length >= FUZZY_LAST_MIN_LEN) {
    const fuzzyFull = uniquePlayers(
      players.filter((p) => {
        const lastOk = levenshtein(normalizePersonName(p.lastName), lastToken) <= FUZZY_MAX_DISTANCE;
        const firstOk =
          normalizePersonName(p.firstName) === firstToken ||
          levenshtein(normalizePersonName(p.firstName), firstToken) <= FUZZY_MAX_DISTANCE;
        return lastOk && firstOk;
      })
    );
    if (fuzzyFull.length === 1) return packNeeds(extracted, fuzzyFull, 'FUZZY_FULL_NAME');
    if (fuzzyFull.length > 1) return packNeeds(extracted, fuzzyFull, 'AMBIGUOUS_FUZZY_FULL_NAME');
  }

  return packUnresolved(extracted, 'NO_PLAYER');
}
