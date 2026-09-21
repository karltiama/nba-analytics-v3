/**
 * Editorial generation contract (V1.1).
 *
 * The model may interpret supplied facts. It may not invent players, stats,
 * injuries, roles, lineups, or claims absent from the packet/signals.
 *
 * Prefer qualitative prose. Exact numbers only if present in the packet.
 * Public snapshot is regular-season-only — never cite all-games TSA as Record.
 */

import type { EditorialSections } from './assemble';
import { EMPTY_EDITORIAL } from './assemble';
import type {
  EditorialTraceSection,
  PlayerWatchCandidate,
  PreseasonContextSignal,
  PreseasonTeamPacket,
  RoleWatchCandidate,
} from './types';

export type GenerateInput = {
  packet: PreseasonTeamPacket;
  signals: PreseasonContextSignal[];
  candidates: PlayerWatchCandidate[];
  roleWatch: RoleWatchCandidate[];
};

export type GenerateTeamPreseasonPreview = (
  input: GenerateInput
) => Promise<EditorialSections>;

/** Dry / no-LLM path — returns empty editorial so facts-only drafts validate. */
export const generateEditorialDry: GenerateTeamPreseasonPreview = async () =>
  EMPTY_EDITORIAL;

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Optional OpenAI adapter. Requires OPENAI_API_KEY.
 * On failure or missing key, returns EMPTY_EDITORIAL (facts draft still valid).
 */
export function createOpenAiEditorialGenerator(args?: {
  apiKey?: string | null;
  model?: string;
  /** When true, throw instead of returning empty editorial on API/parse failure. */
  strict?: boolean;
}): GenerateTeamPreseasonPreview {
  const apiKey = args?.apiKey ?? process.env.OPENAI_API_KEY ?? null;
  const model =
    args?.model ?? process.env.OPENAI_MODEL?.trim() ?? 'gpt-4o-mini';
  const strict = args?.strict ?? false;

  return async (input) => {
    if (!apiKey) {
      if (strict) throw new Error('OPENAI_API_KEY missing');
      return EMPTY_EDITORIAL;
    }

    const system = [
      'You write Court Context preseason preview editorial.',
      'Voice: analytical, concise, approachable, context-first, neutral.',
      'No hype. No sportsbook voice. No fake certainty.',
      'You may interpret and summarize supplied facts.',
      'You may not introduce a player, transaction, statistic, injury, role, lineup, starting five, or claim absent from the supplied data.',
      'Do not invent injuries, draft picks, projected rotations, causal WOWY effects, or model/projection claims.',
      'If regularSeason snapshot fields are null, do not invent a prior record or ratings.',
      'RECENT_COMPETITIVE_MINUTES_INCREASE may include postseason games — do not call it regular-season late-season form.',
      'If evidence is missing, omit that section (null or empty array). DO NOT FILL GAPS.',
      'Prefer qualitative prose. Avoid embedding exact statistics unless they appear in the supplied JSON.',
      'Also return editorialTrace: array of {section, claimSummary, supportingFactPaths[], supportingSignalTypes[]} mapping each generated section to packet facts/signals.',
      'Return strict JSON matching the schema described by the user.',
    ].join(' ');

    const rs = input.packet.previousSeasonRegular;
    const userPayload = {
      schema: {
        headline: 'string|null',
        dek: 'string|null',
        bigPicture: 'string[]',
        playersToWatchCopy: 'Record<playerEntityId, string|null>',
        roleWatchCopy: 'Record<playerEntityId, string|null>',
        keyQuestions: 'Array<{headline, detail}>',
        outlook: 'string|null',
        editorialTrace:
          'Array<{section, claimSummary, supportingFactPaths, supportingSignalTypes}>',
      },
      team: input.packet.team,
      regularSeasonSnapshot: rs.available
        ? {
            record: rs.record,
            offensiveRating: rs.offensiveRating,
            defensiveRating: rs.defensiveRating,
            pace: rs.pace,
            gamesPlayed: rs.gamesPlayed,
            metricsScope: rs.metricsScope,
          }
        : null,
      regularSeasonUnavailableReason: rs.available
        ? null
        : rs.unavailableReason,
      additions: input.packet.additions,
      departures: input.packet.departures,
      returningCount: input.packet.returningPlayers.length,
      signals: input.signals,
      candidates: input.candidates,
      roleWatch: input.roleWatch,
      scheduleUnavailable: input.packet.schedule.unavailableReason,
      wowyAvailable: input.packet.availableWowySummaries.length > 0,
      note: 'previousSeasonAllGames is intentionally omitted from this payload',
    };

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
            {
              role: 'user',
              content: [
                'Return a single JSON object with ONLY these top-level keys:',
                'headline, dek, bigPicture, playersToWatchCopy, roleWatchCopy, keyQuestions, outlook, editorialTrace.',
                'Do NOT wrap them under "schema". Do NOT echo the input team/snapshot payload.',
                'playersToWatchCopy and roleWatchCopy values must be short watching/explanation prose, not player names.',
                'Factual payload follows:',
                JSON.stringify(userPayload),
              ].join('\n'),
            },
        ],
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text();
      const msg = `OpenAI editorial failed: HTTP ${res.status} ${bodyText.slice(0, 500)}`;
      if (strict) throw new Error(msg);
      console.error(msg);
      return EMPTY_EDITORIAL;
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = body.choices?.[0]?.message?.content;
    if (!raw) {
      const msg = 'OpenAI editorial returned empty content';
      if (strict) throw new Error(msg);
      console.error(msg);
      return EMPTY_EDITORIAL;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<EditorialSections> & {
        schema?: Partial<EditorialSections>;
      };
      if (process.env.PRESEASON_DEBUG === '1') {
        console.error(
          '[preseason-editorial] raw keys',
          Object.keys(parsed as object),
          'preview',
          raw.slice(0, 400)
        );
      }
      const normalized = normalizeEditorial(parsed, input);
      if (
        strict &&
        !normalized.headline &&
        !normalized.bigPicture.length &&
        !normalized.outlook
      ) {
        throw new Error(
          'OpenAI editorial returned no usable prose after normalization'
        );
      }
      return normalized;
    } catch (err) {
      const msg = `OpenAI editorial JSON parse failed: ${err instanceof Error ? err.message : String(err)}`;
      if (strict) throw new Error(msg);
      console.error(msg);
      return EMPTY_EDITORIAL;
    }
  };
}

function normalizeEditorial(
  parsed: Partial<EditorialSections> & { schema?: Partial<EditorialSections> },
  input: GenerateInput
): EditorialSections {
  // Models sometimes nest fields under "schema" — unwrap if present.
  const src: Partial<EditorialSections> =
    parsed.schema && typeof parsed.schema === 'object'
      ? { ...parsed.schema, editorialTrace: parsed.editorialTrace ?? parsed.schema.editorialTrace }
      : parsed;

  const allowedWatch = new Set(input.candidates.map((c) => c.playerEntityId));
  const allowedRole = new Set(input.roleWatch.map((r) => r.playerEntityId));

  const playersToWatchCopy: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(src.playersToWatchCopy ?? {})) {
    if (allowedWatch.has(k) && typeof v === 'string' && v.trim()) {
      // Reject accidental name-only echoes
      const candidate = input.candidates.find((c) => c.playerEntityId === k);
      if (candidate && v.trim() === candidate.displayName) continue;
      playersToWatchCopy[k] = v;
    }
  }

  const roleWatchCopy: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(src.roleWatchCopy ?? {})) {
    if (allowedRole.has(k) && typeof v === 'string' && v.trim()) {
      const row = input.roleWatch.find((r) => r.playerEntityId === k);
      if (row && v.trim() === row.displayName) continue;
      roleWatchCopy[k] = v;
    }
  }

  const keyQuestions = Array.isArray(src.keyQuestions)
    ? src.keyQuestions
        .filter(
          (q) =>
            q &&
            typeof q.headline === 'string' &&
            typeof q.detail === 'string'
        )
        .map((q) => ({ headline: q.headline, detail: q.detail }))
    : [];

  const editorialTrace: EditorialTraceSection[] = Array.isArray(
    src.editorialTrace
  )
    ? src.editorialTrace
        .filter(
          (t) =>
            t &&
            typeof t.section === 'string' &&
            typeof t.claimSummary === 'string'
        )
        .map((t) => ({
          section: t.section,
          claimSummary: t.claimSummary,
          supportingFactPaths: Array.isArray(t.supportingFactPaths)
            ? t.supportingFactPaths.filter((x): x is string => typeof x === 'string')
            : [],
          supportingSignalTypes: Array.isArray(t.supportingSignalTypes)
            ? t.supportingSignalTypes.filter(
                (x): x is string => typeof x === 'string'
              )
            : [],
        }))
    : [];

  return {
    headline: typeof src.headline === 'string' ? src.headline : null,
    dek: typeof src.dek === 'string' ? src.dek : null,
    bigPicture: Array.isArray(src.bigPicture)
      ? src.bigPicture.filter((s): s is string => typeof s === 'string')
      : [],
    playersToWatchCopy,
    roleWatchCopy,
    keyQuestions,
    outlook: typeof src.outlook === 'string' ? src.outlook : null,
    editorialTrace,
  };
}
