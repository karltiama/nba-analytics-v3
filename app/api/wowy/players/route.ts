import { NextRequest, NextResponse } from 'next/server';
import { searchWowyPlayers } from '@/lib/wowy/queries';

/** GET /api/wowy/players?q= */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ players: [] });
  }
  try {
    const players = await searchWowyPlayers(q);
    return NextResponse.json({ players });
  } catch (error) {
    console.error('[api/wowy/players]', error);
    return NextResponse.json({ error: 'Failed to search players.' }, { status: 500 });
  }
}
