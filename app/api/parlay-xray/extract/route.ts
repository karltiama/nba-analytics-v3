import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { getUserEntitlements } from '@/lib/entitlements/queries';
import { XRAY_EXTRACT_HTTP_STATUS, XRAY_EXTRACT_MESSAGE } from '@/lib/parlay-xray/extraction';
import { runXrayExtraction } from '@/lib/parlay-xray/extraction/pipeline';
import { getXrayRuntime } from '@/lib/parlay-xray/extraction/runtime';

export const runtime = 'nodejs';

function json(
  withAuthCookies: (response: NextResponse) => NextResponse,
  body: unknown,
  status: number
): NextResponse {
  return withAuthCookies(NextResponse.json(body, { status }));
}

/**
 * POST /api/parlay-xray/extract
 * Canonical XRay screenshot extraction. Auth required. Kill switch default off.
 * multipart field: image
 */
export async function POST(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) {
    return NextResponse.json(
      {
        result: 'AUTH_REQUIRED',
        message: XRAY_EXTRACT_MESSAGE.AUTH_REQUIRED,
        legs: [],
        cacheHit: false,
        providerAttempted: false,
        quota: null,
        extractionVersion: null,
      },
      { status: XRAY_EXTRACT_HTTP_STATUS.AUTH_REQUIRED }
    );
  }

  const { config, store, provider } = await getXrayRuntime();
  const entitlement = await getUserEntitlements(gate.auth.userId);
  // Plan cannot bypass the extraction kill switch. isPro is only a safety-quota input.

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(gate.withAuthCookies, {
      result: 'UNREADABLE_IMAGE',
      message: 'That file type isn’t supported. Use a PNG, JPG, or WebP screenshot.',
      legs: [],
      cacheHit: false,
      providerAttempted: false,
      quota: null,
      extractionVersion: config.extractionVersion,
      validationCode: 'unsupported_file',
    }, 400);
  }

  const file = form.get('image');
  if (!(file instanceof Blob)) {
    return json(gate.withAuthCookies, {
      result: 'UNREADABLE_IMAGE',
      message: 'That file type isn’t supported. Use a PNG, JPG, or WebP screenshot.',
      legs: [],
      cacheHit: false,
      providerAttempted: false,
      quota: null,
      extractionVersion: config.extractionVersion,
      validationCode: 'unsupported_file',
    }, 400);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const declaredMime = file.type || 'application/octet-stream';

  try {
    const extracted = await runXrayExtraction(
      {
        userId: gate.auth.userId,
        isPro: entitlement.isPro,
        bytes,
        declaredMime,
      },
      {
        config,
        store,
        provider,
        log: (event, meta) => {
          console.info(`[parlay-xray] ${event}`, meta);
        },
      }
    );
    const status =
      extracted.validationCode === 'file_too_large'
        ? 413
        : extracted.validationCode === 'unsupported_file'
          ? 400
          : XRAY_EXTRACT_HTTP_STATUS[extracted.result];
    return json(gate.withAuthCookies, extracted, status);
  } catch (error) {
    console.error('[parlay-xray] extract internal error', error instanceof Error ? error.message : 'unknown');
    return json(
      gate.withAuthCookies,
      {
        result: 'INTERNAL_ERROR',
        message: XRAY_EXTRACT_MESSAGE.INTERNAL_ERROR,
        legs: [],
        cacheHit: false,
        providerAttempted: false,
        quota: null,
        extractionVersion: config.extractionVersion,
      },
      XRAY_EXTRACT_HTTP_STATUS.INTERNAL_ERROR
    );
  }
}
