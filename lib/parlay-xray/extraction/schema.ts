import { z } from 'zod';
import { XRAY_PROP_KINDS } from '@/lib/parlay-xray/types';

const confidence = z.enum(['high', 'medium', 'low']);
const documentType = z.enum(['BET_SLIP', 'NOT_BET_SLIP', 'UNCERTAIN']);
const shortEvidence = z.string().max(80).nullable().optional();

export const xrayVisionLegSchema = z.object({
  player_name: z.string().nullable(),
  player_name_confidence: confidence.nullable(),
  team_abbr: z.string().nullable(),
  opponent_abbr: z.string().nullable(),
  matchup_label: z.string().nullable(),
  prop_kind: z.enum(XRAY_PROP_KINDS).nullable(),
  side: z.enum(['over', 'under']).nullable(),
  line: z.number().nullable(),
  odds_american: z.number().nullable(),
  sportsbook: z.string().nullable(),
  game_date: z.string().nullable(),
  field_confidence: confidence.nullable(),
  raw_snippet: z.string().max(240).nullable(),
  player_evidence: shortEvidence,
  market_evidence: shortEvidence,
  side_evidence: z.string().max(40).nullable().optional(),
  line_evidence: z.string().max(40).nullable().optional(),
  odds_evidence: z.string().max(40).nullable().optional(),
});

export const xrayVisionOutputSchema = z.object({
  document_type: documentType,
  wager_evidence: z.string().max(160).nullable().optional(),
  image_quality: z.enum(['good', 'medium', 'poor', 'unreadable']),
  sportsbook: z.string().nullable(),
  legs: z.array(xrayVisionLegSchema).max(20),
});

export type XrayVisionOutput = z.infer<typeof xrayVisionOutputSchema>;
export type XrayVisionLeg = z.infer<typeof xrayVisionLegSchema>;
export type XrayDocumentType = z.infer<typeof documentType>;
