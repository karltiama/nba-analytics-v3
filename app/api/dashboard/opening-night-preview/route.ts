import { NextResponse } from 'next/server';
import { loadOpeningNightPreview } from '@/lib/dashboard/opening-night-preview-db';
import {
  OPENING_NIGHT_DATE_LABEL,
  OPENING_NIGHT_HEADING,
} from '@/lib/dashboard/opening-night-preview';

export const dynamic = 'force-dynamic';

/** Schedule facts for the dashboard preview. Does not write and does not call a provider. */
export async function GET() {
  try {
    const games = await loadOpeningNightPreview(new Date());
    return NextResponse.json(
      {
        heading: OPENING_NIGHT_HEADING,
        dateLabel: OPENING_NIGHT_DATE_LABEL,
        games,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      { error: 'opening_night_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
