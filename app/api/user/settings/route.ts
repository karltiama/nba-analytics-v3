import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne } from '@/lib/db';
import { resolveSupabaseAuth } from '@/lib/auth/supabase-user';

const settingsSchema = z.object({
  preferredSportsbook: z.string().trim().min(1).max(60).nullable().optional(),
  oddsFormat: z.enum(['american', 'decimal', 'fractional']).nullable().optional(),
  paperDisplayMode: z.enum(['dollars', 'units', 'off']).nullable().optional(),
  primaryGoal: z.enum(['find_edges', 'track_picks', 'learn']).nullable().optional(),
  experienceLevel: z.enum(['novice', 'intermediate', 'advanced']).nullable().optional(),
  bankroll: z.number().nonnegative().max(1000000000).nullable().optional(),
  riskTolerance: z.enum(['low', 'medium', 'high']).nullable().optional(),
  minEdgePercent: z.number().min(-100).max(100).nullable().optional(),
  favoriteTeams: z.array(z.string().trim().min(1).max(20)).max(50).optional(),
  notificationEnabled: z.boolean().optional(),
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

function mapSettings(row: SettingsRow) {
  return {
    userId: row.user_id,
    preferredSportsbook: row.preferred_sportsbook,
    oddsFormat: row.odds_format,
    paperDisplayMode: row.paper_display_mode,
    primaryGoal: row.primary_goal,
    experienceLevel: row.experience_level,
    bankroll: row.bankroll != null ? Number(row.bankroll) : null,
    riskTolerance: row.risk_tolerance,
    minEdgePercent: row.min_edge_percent != null ? Number(row.min_edge_percent) : null,
    favoriteTeams: row.favorite_teams ?? [],
    notificationEnabled: row.notification_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureSettings(userId: string): Promise<void> {
  await queryOne(
    `INSERT INTO public.user_settings (user_id)
     VALUES ($1::uuid)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING user_id`,
    [userId]
  );
}

export async function GET(request: NextRequest) {
  const ar = await resolveSupabaseAuth(request);
  if (!ar.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { auth, withAuthCookies } = ar;

  try {
    await ensureSettings(auth.userId);
    const row = await queryOne<SettingsRow>(
      `SELECT user_id, preferred_sportsbook, odds_format, paper_display_mode, primary_goal, experience_level,
              bankroll, risk_tolerance, min_edge_percent, favorite_teams, notification_enabled, created_at, updated_at
       FROM public.user_settings
       WHERE user_id = $1::uuid`,
      [auth.userId]
    );

    if (!row) {
      return withAuthCookies(NextResponse.json({ error: 'Failed to load settings' }, { status: 500 }));
    }
    return withAuthCookies(NextResponse.json({ settings: mapSettings(row) }));
  } catch (error: unknown) {
    return withAuthCookies(
      NextResponse.json(
        {
          error: 'Failed to load settings',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      )
    );
  }
}

export async function PUT(request: NextRequest) {
  const ar = await resolveSupabaseAuth(request);
  if (!ar.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { auth, withAuthCookies } = ar;

  try {
    await ensureSettings(auth.userId);

    const body = await request.json();
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      return withAuthCookies(
        NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
      );
    }

    const d = parsed.data;
    const row = await queryOne<SettingsRow>(
      `INSERT INTO public.user_settings (
         user_id, preferred_sportsbook, odds_format, paper_display_mode, primary_goal, experience_level,
         bankroll, risk_tolerance, min_edge_percent, favorite_teams, notification_enabled
       ) VALUES (
         $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], COALESCE($11, false)
       )
       ON CONFLICT (user_id) DO UPDATE
       SET preferred_sportsbook = COALESCE(EXCLUDED.preferred_sportsbook, public.user_settings.preferred_sportsbook),
           odds_format = COALESCE(EXCLUDED.odds_format, public.user_settings.odds_format),
           paper_display_mode = COALESCE(EXCLUDED.paper_display_mode, public.user_settings.paper_display_mode),
           primary_goal = COALESCE(EXCLUDED.primary_goal, public.user_settings.primary_goal),
           experience_level = COALESCE(EXCLUDED.experience_level, public.user_settings.experience_level),
           bankroll = COALESCE(EXCLUDED.bankroll, public.user_settings.bankroll),
           risk_tolerance = COALESCE(EXCLUDED.risk_tolerance, public.user_settings.risk_tolerance),
           min_edge_percent = COALESCE(EXCLUDED.min_edge_percent, public.user_settings.min_edge_percent),
           favorite_teams = COALESCE(EXCLUDED.favorite_teams, public.user_settings.favorite_teams),
           notification_enabled = COALESCE(EXCLUDED.notification_enabled, public.user_settings.notification_enabled)
       RETURNING user_id, preferred_sportsbook, odds_format, paper_display_mode, primary_goal, experience_level,
                 bankroll, risk_tolerance, min_edge_percent, favorite_teams, notification_enabled, created_at, updated_at`,
      [
        auth.userId,
        d.preferredSportsbook ?? null,
        d.oddsFormat ?? null,
        d.paperDisplayMode ?? null,
        d.primaryGoal ?? null,
        d.experienceLevel ?? null,
        d.bankroll ?? null,
        d.riskTolerance ?? null,
        d.minEdgePercent ?? null,
        d.favoriteTeams ?? null,
        d.notificationEnabled ?? null,
      ]
    );

    if (!row) {
      return withAuthCookies(NextResponse.json({ error: 'Failed to save settings' }, { status: 500 }));
    }
    return withAuthCookies(NextResponse.json({ settings: mapSettings(row) }));
  } catch (error: unknown) {
    return withAuthCookies(
      NextResponse.json(
        {
          error: 'Failed to save settings',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      )
    );
  }
}
