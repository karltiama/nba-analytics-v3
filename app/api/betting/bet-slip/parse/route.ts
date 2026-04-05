import { NextRequest, NextResponse } from 'next/server';
import { fetchBetSlipExtractionFromOpenAi } from '@/lib/betting/bet-slip/openai-extract';

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * POST /api/betting/bet-slip/parse
 * multipart/form-data: field "image" — JPEG/PNG/WebP, max 6MB.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    return NextResponse.json(
      { error: 'OpenAI is not configured', code: 'NO_OPENAI_KEY' as const },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data', code: 'BAD_FORM' as const }, { status: 400 });
  }

  const file = form.get('image');
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: 'Missing image file (field name: image)', code: 'MISSING_IMAGE' as const },
      { status: 400 }
    );
  }

  const type = file.type || 'application/octet-stream';
  if (!ALLOWED.has(type)) {
    return NextResponse.json(
      { error: 'Unsupported image type; use JPEG, PNG, or WebP', code: 'BAD_TYPE' as const },
      { status: 400 }
    );
  }

  const size = file.size;
  if (size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Image too large (max ${MAX_BYTES} bytes)`, code: 'TOO_LARGE' as const },
      { status: 413 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString('base64');
  const dataUrl = `data:${type};base64,${base64}`;

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';

  try {
    const extraction = await fetchBetSlipExtractionFromOpenAi(apiKey, model, dataUrl);
    return NextResponse.json({ extraction });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json(
      { error: `OpenAI request failed: ${message}`, code: 'OPENAI_ERROR' as const },
      { status: 502 }
    );
  }
}
