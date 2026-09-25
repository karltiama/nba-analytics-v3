import { NextResponse } from 'next/server';
import { finishAuthCallback, planAuthCallback } from '@/lib/auth/auth-callback';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const plan = planAuthCallback({
    origin,
    code: searchParams.get('code'),
    next: searchParams.get('next'),
    providerError: searchParams.get('error'),
  });

  if (plan.action === 'redirect') {
    return NextResponse.redirect(plan.location);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(plan.code);
  return NextResponse.redirect(
    finishAuthCallback({
      origin,
      next: plan.next,
      exchangeOk: !error,
    })
  );
}
