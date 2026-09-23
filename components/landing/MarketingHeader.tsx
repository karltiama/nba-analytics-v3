import Link from 'next/link';
import { LandingTrackedLink } from '@/components/landing/LandingTrackedLink';
import { createSupabaseServerClient } from '@/lib/supabase/server';

async function isSignedIn(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return Boolean(data.user);
  } catch {
    return false;
  }
}

export async function MarketingHeader() {
  const signedIn = await isSignedIn();

  return (
    <header className="absolute top-0 w-full z-50">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 flex justify-between items-center gap-3">
        <Link href="/" className="flex items-center gap-2 sm:gap-3 min-w-0" aria-label="Court Context home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/court-context-logo.png"
            alt=""
            className="h-10 sm:h-12 lg:h-14 w-auto select-none"
          />
          <span className="font-bold text-xl sm:text-3xl lg:text-5xl tracking-tight text-[#063f46] truncate">
            Court Context
          </span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-6 shrink-0">
          {signedIn ? (
            <LandingTrackedLink
              href="/betting"
              location="header"
              action="open_dashboard"
              className="text-sm font-semibold bg-[#55ddb1] hover:bg-[#3dcc9f] text-[#063f46] rounded-lg px-3 sm:px-5 py-2 transition-colors"
            >
              Dashboard
            </LandingTrackedLink>
          ) : (
            <>
              <LandingTrackedLink
                href="/login"
                location="header"
                action="sign_in"
                className="text-sm font-medium text-[#4a6366] hover:text-[#063f46] transition-colors"
              >
                Sign In
              </LandingTrackedLink>
              <LandingTrackedLink
                href="/signup"
                location="header"
                action="sign_up"
                className="text-sm font-semibold bg-[#55ddb1] hover:bg-[#3dcc9f] text-[#063f46] rounded-lg px-3 sm:px-5 py-2 transition-colors"
              >
                Create account
              </LandingTrackedLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
