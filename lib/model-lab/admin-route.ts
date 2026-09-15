import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/auth/require-admin';

export async function withAdminJson(
  request: NextRequest,
  handler: () => Promise<NextResponse> | NextResponse
): Promise<NextResponse> {
  const admin = await requireAdminAuth(request);
  if (!admin.ok) return admin.response;
  const response = await handler();
  return admin.withAuthCookies(response);
}
