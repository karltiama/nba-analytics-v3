import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne } from '@/lib/db';
import { getAuthUserFromRequest } from '@/lib/auth/supabase-user';

const settingsSchema = z.object({
  preferredSportsbook: z.string().trim().min(1).max(60).nullable().optional(),
  bankroll: z.number().nonnegative().max(1000000000).nullable().optional(),
  riskTolerance: z.enum(['low', 'medium', 'high']).nullable().optional(),
  minEdgePercent: z.number().min(-100).max(100).nullable().optional(),
  favoriteTeams: z.array(z.string().trim().min(1).max(20)).max(50).optional(),
  notificationEnabled: z.boolean().optional(),
});

type SettingsRow = {
  user_id: string;
  preferred_sportsbook: string | null;
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
  try {
    const auth = await getAuthUserFromRequest(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await ensureSettings(auth.userId);
    const row = await queryOne<SettingsRow>(
      `SELECT user_id, preferred_sportsbook, bankroll, risk_tolerance, min_edge_percent,
              favorite_teams, notification_enabled, created_at, updated_at
       FROM public.user_settings
       WHERE user_id = $1::uuid`,
      [auth.userId]
    );

    if (!row) return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
    return NextResponse.json({ settings: mapSettings(row) });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to load settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 });
    }

    const d = parsed.data;
    const row = await queryOne<SettingsRow>(
      `INSERT INTO public.user_settings (
         user_id, preferred_sportsbook, bankroll, risk_tolerance, min_edge_percent, favorite_teams, notification_enabled
       ) VALUES (
         $1::uuid, $2, $3, $4, $5, $6::text[], COALESCE($7, false)
       )
       ON CONFLICT (user_id) DO UPDATE
       SET preferred_sportsbook = COALESCE(EXCLUDED.preferred_sportsbook, public.user_settings.preferred_sportsbook),
           bankroll = COALESCE(EXCLUDED.bankroll, public.user_settings.bankroll),
           risk_tolerance = COALESCE(EXCLUDED.risk_tolerance, public.user_settings.risk_tolerance),
           min_edge_percent = COALESCE(EXCLUDED.min_edge_percent, public.user_settings.min_edge_percent),
           favorite_teams = COALESCE(EXCLUDED.favorite_teams, public.user_settings.favorite_teams),
           notification_enabled = COALESCE(EXCLUDED.notification_enabled, public.user_settings.notification_enabled)
       RETURNING user_id, preferred_sportsbook, bankroll, risk_tolerance, min_edge_percent,
                 favorite_teams, notification_enabled, created_at, updated_at`,
      [
        auth.userId,
        d.preferredSportsbook ?? null,
        d.bankroll ?? null,
        d.riskTolerance ?? null,
        d.minEdgePercent ?? null,
        d.favoriteTeams ?? null,
        d.notificationEnabled ?? null,
      ]
    );

    if (!row) return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
    return NextResponse.json({ settings: mapSettings(row) });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to save settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
