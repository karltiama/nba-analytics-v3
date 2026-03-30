import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne } from '@/lib/db';
import { getAuthUserFromRequest } from '@/lib/auth/supabase-user';

const profileUpdateSchema = z.object({
  username: z.string().trim().min(2).max(30).nullable().optional(),
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  timezone: z.string().trim().min(1).max(80).nullable().optional(),
});

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
};

function mapProfile(row: ProfileRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureProfile(userId: string): Promise<ProfileRow | null> {
  return queryOne<ProfileRow>(
    `INSERT INTO public.profiles (id)
     VALUES ($1::uuid)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, username, display_name, avatar_url, timezone, created_at, updated_at`,
    [userId]
  );
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let row = await queryOne<ProfileRow>(
      `SELECT id, username, display_name, avatar_url, timezone, created_at, updated_at
       FROM public.profiles
       WHERE id = $1::uuid`,
      [auth.userId]
    );
    if (!row) {
      row = await ensureProfile(auth.userId);
      if (!row) {
        row = await queryOne<ProfileRow>(
          `SELECT id, username, display_name, avatar_url, timezone, created_at, updated_at
           FROM public.profiles
           WHERE id = $1::uuid`,
          [auth.userId]
        );
      }
    }
    if (!row) return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
    return NextResponse.json({ profile: mapProfile(row) });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to load profile',
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
    const parsed = profileUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 });
    }

    const d = parsed.data;
    const row = await queryOne<ProfileRow>(
      `INSERT INTO public.profiles (id, username, display_name, avatar_url, timezone)
       VALUES ($1::uuid, $2, $3, $4, COALESCE($5, 'America/New_York'))
       ON CONFLICT (id) DO UPDATE
       SET username = EXCLUDED.username,
           display_name = EXCLUDED.display_name,
           avatar_url = EXCLUDED.avatar_url,
           timezone = COALESCE(EXCLUDED.timezone, public.profiles.timezone)
       RETURNING id, username, display_name, avatar_url, timezone, created_at, updated_at`,
      [
        auth.userId,
        d.username ?? null,
        d.displayName ?? null,
        d.avatarUrl ?? null,
        d.timezone ?? null,
      ]
    );

    if (!row) return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
    return NextResponse.json({ profile: mapProfile(row) });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to save profile',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
