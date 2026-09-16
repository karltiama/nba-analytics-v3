import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne } from '@/lib/db';
import { resolveSupabaseAuth } from '@/lib/auth/supabase-user';
import {
  mapGuidanceToExperience,
  mapIntentToLegacyGoal,
  PRIMARY_INTENTS,
  GUIDANCE_LEVELS,
} from '@/lib/onboarding/contract';

const onboardingBodySchema = z.object({
  skipped: z.boolean().optional(),
  primaryIntent: z.enum(PRIMARY_INTENTS).nullable().optional(),
  guidanceLevel: z.enum(GUIDANCE_LEVELS).nullable().optional(),
  preferredSportsbook: z.union([z.string().max(60), z.null()]).optional(),
  oddsFormat: z.enum(['american', 'decimal', 'fractional']).optional(),
  paperDisplayMode: z.enum(['dollars', 'units', 'off']).optional(),
  primaryGoal: z.enum(['find_edges', 'track_picks', 'learn']).nullable().optional(),
  experienceLevel: z.enum(['novice', 'intermediate', 'advanced']).nullable().optional(),
});

type SettingsRow = {
  user_id: string;
  preferred_sportsbook: string | null;
  odds_format: string | null;
  paper_display_mode: string | null;
  primary_goal: string | null;
  experience_level: string | null;
  bankroll: string | number | null;
  risk_tolerance: 'low' | 'medium' | 'high' | null;
  min_edge_percent: string | number | null;
  favorite_teams: string[] | null;
  notification_enabled: boolean;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  onboarding_completed_at: string | null;
};

export async function POST(request: NextRequest) {
  const ar = await resolveSupabaseAuth(request);
  if (!ar.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { auth, withAuthCookies } = ar;

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = onboardingBodySchema.safeParse(body);
    if (!parsed.success) {
      return withAuthCookies(
        NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
      );
    }

    const d = parsed.data;
    const skipped = d.skipped === true;
    const primaryGoal = skipped
      ? null
      : (d.primaryGoal ?? mapIntentToLegacyGoal(d.primaryIntent ?? null));
    const experienceLevel = skipped
      ? null
      : (d.experienceLevel ?? mapGuidanceToExperience(d.guidanceLevel ?? null));
    const oddsFormat = d.oddsFormat ?? 'american';
    const paperDisplayMode = d.paperDisplayMode ?? 'units';

    await queryOne(
      `INSERT INTO public.profiles (id)
       VALUES ($1::uuid)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [auth.userId]
    );

    const settingsRow = await queryOne<SettingsRow>(
      `INSERT INTO public.user_settings (
         user_id, preferred_sportsbook, odds_format, paper_display_mode, primary_goal, experience_level
       ) VALUES (
         $1::uuid, $2, $3, $4, $5, $6
       )
       ON CONFLICT (user_id) DO UPDATE SET
         preferred_sportsbook = COALESCE(EXCLUDED.preferred_sportsbook, public.user_settings.preferred_sportsbook),
         odds_format = EXCLUDED.odds_format,
         paper_display_mode = EXCLUDED.paper_display_mode,
         primary_goal = EXCLUDED.primary_goal,
         experience_level = EXCLUDED.experience_level,
         updated_at = now()
       RETURNING user_id, preferred_sportsbook, odds_format, paper_display_mode, primary_goal, experience_level,
                 bankroll, risk_tolerance, min_edge_percent, favorite_teams, notification_enabled, created_at, updated_at`,
      [auth.userId, null, oddsFormat, paperDisplayMode, primaryGoal, experienceLevel]
    );

    if (!settingsRow) {
      return withAuthCookies(NextResponse.json({ error: 'Failed to save onboarding settings' }, { status: 500 }));
    }

    const profileRow = await queryOne<ProfileRow>(
      `UPDATE public.profiles
       SET onboarding_completed_at = now()
       WHERE id = $1::uuid
       RETURNING id, onboarding_completed_at`,
      [auth.userId]
    );

    if (!profileRow) {
      return withAuthCookies(NextResponse.json({ error: 'Failed to complete onboarding' }, { status: 500 }));
    }

    return withAuthCookies(
      NextResponse.json({
        ok: true,
        skipped,
        onboardingCompletedAt: profileRow.onboarding_completed_at,
        settings: {
          preferredSportsbook: settingsRow.preferred_sportsbook,
          oddsFormat: settingsRow.odds_format,
          paperDisplayMode: settingsRow.paper_display_mode,
          primaryGoal: settingsRow.primary_goal,
          experienceLevel: settingsRow.experience_level,
        },
      })
    );
  } catch (error: unknown) {
    return withAuthCookies(
      NextResponse.json(
        {
          error: 'Failed to save onboarding',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      )
    );
  }
}
