import { NextRequest, NextResponse } from 'next/server';
import { loadWowyTeamStints, loadWowyTeammates, resolveWowyPlayerIdentity } from '@/lib/wowy/queries';

/** GET /api/wowy/context?playerId=&season=&teamId=&seasonType= */
export async function GET(request: NextRequest) {
  const playerId = request.nextUrl.searchParams.get('playerId')?.trim() ?? '';
  const season = request.nextUrl.searchParams.get('season')?.trim() ?? '';
  const teamId = request.nextUrl.searchParams.get('teamId')?.trim() ?? '';
  const seasonTypeRaw = request.nextUrl.searchParams.get('seasonType')?.trim() || 'regular';
  if (!playerId || !/^\d{4}$/.test(season)) {
    return NextResponse.json({ error: 'playerId and season (YYYY) are required.' }, { status: 400 });
  }
  if (seasonTypeRaw !== 'regular' && seasonTypeRaw !== 'playoffs' && seasonTypeRaw !== 'all') {
    return NextResponse.json({ error: 'seasonType must be regular, playoffs, or all.' }, { status: 400 });
  }

  try {
    const player = await resolveWowyPlayerIdentity(playerId);
    if (!player) {
      return NextResponse.json({ error: 'Player not found.' }, { status: 404 });
    }
    if (!player.identityOk) {
      return NextResponse.json(
        { error: 'Ambiguous player identity.', code: 'ambiguous_identity', reason: player.identityReason },
        { status: 422 }
      );
    }

    const teams = await loadWowyTeamStints(playerId, season);
    const teammates = teamId
      ? await loadWowyTeammates({
          subjectPlayerId: playerId,
          season,
          teamId,
          seasonType: seasonTypeRaw,
        })
      : [];

    return NextResponse.json({
      player,
      teams,
      teammates,
      stintNote:
        'Team options come from game-log team_id on Final games. Date bounds are coverage, not verified trade dates.',
    });
  } catch (error) {
    console.error('[api/wowy/context]', error);
    return NextResponse.json({ error: 'Failed to load WOWY context.' }, { status: 500 });
  }
}
