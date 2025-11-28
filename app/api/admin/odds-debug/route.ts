import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/admin/odds-debug
 * 
 * Returns raw staging event payload for debugging
 * Query params:
 *   - staging_id: ID of staging event to view
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const stagingId = searchParams.get('staging_id');

    if (!stagingId) {
      return NextResponse.json(
        { error: 'Missing staging_id parameter' },
        { status: 400 }
      );
    }

    const result = await query(
      `SELECT id, source, kind, cursor, payload, fetched_at, processed, processed_at, error_message
       FROM staging_events
       WHERE id = $1`,
      [stagingId]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Staging event not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      staging_event: result[0],
    });
  } catch (error: any) {
    console.error('Error fetching staging event:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch staging event' },
      { status: 500 }
    );
  }
}

