import { z } from 'zod';

/** Vision extraction — parlay-first, leg-based (matches product spec). */
export const betSlipLegExtractionSchema = z.object({
  player_name: z.string(),
  prop_type: z.string(),
  side: z.enum(['over', 'under']),
  line: z.number(),
  odds_american: z.number().nullable(),
});

export const betSlipExtractionSchema = z.object({
  bet_type: z.enum(['single', 'parlay']),
  sportsbook: z.string().nullable(),
  total_odds_american: z.number().nullable(),
  total_odds_decimal: z.number().nullable(),
  legs: z.array(betSlipLegExtractionSchema),
  image_quality: z.enum(['good', 'medium', 'poor']).nullable(),
  needs_review: z.boolean(),
});

export type BetSlipExtraction = z.infer<typeof betSlipExtractionSchema>;
export type BetSlipLegExtraction = z.infer<typeof betSlipLegExtractionSchema>;

/** User-confirmed slip sent to /analyze (after edits). */
export const betSlipAnalyzeLegSchema = z.object({
  player_name: z.string().min(1),
  /** When set (e.g. after disambiguation), skips fuzzy name resolution. */
  resolved_player_id: z.string().min(1).optional(),
  prop_type: z.string().min(1),
  side: z.enum(['over', 'under']),
  line: z.number(),
  odds_american: z.number().nullable(),
});

export const betSlipAnalyzeBodySchema = z.object({
  /** Slate date (ET) for display/context; model uses season/L10 stats. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sportsbook: z.string().nullable().optional(),
  bet_type: z.enum(['single', 'parlay']),
  total_odds_american: z.number().nullable().optional(),
  total_odds_decimal: z.number().nullable().optional(),
  legs: z.array(betSlipAnalyzeLegSchema).min(1),
});

export type BetSlipAnalyzeBody = z.infer<typeof betSlipAnalyzeBodySchema>;
