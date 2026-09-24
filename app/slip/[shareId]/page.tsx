import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingHeader } from '@/components/landing/MarketingHeader';
import { SharedSlipView } from '@/components/betting/SharedSlipView';
import {
  buildSharedSlipMetaDescription,
  buildSharedSlipMetaTitle,
} from '@/lib/bet-slip/shared-slip-present';
import { getSharedBetSlipByShareId } from '@/lib/bet-slip/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type PageProps = {
  params: Promise<{ shareId: string }>;
};

async function isSignedIn(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return Boolean(data.user);
  } catch {
    return false;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { shareId } = await params;
  const result = await getSharedBetSlipByShareId(shareId);
  if (!result.ok) {
    return {
      title: 'Shared slip unavailable | Court Context',
      description: 'This shared Court Context slip could not be found.',
      robots: { index: false, follow: false },
    };
  }
  const { share } = result;
  const title = buildSharedSlipMetaTitle(share);
  const description = buildSharedSlipMetaDescription(share);
  const path = share.path;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: 'Court Context',
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

function UnavailableState({ message }: { message: string }) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16 text-center sm:px-6">
      <p className="type-metadata uppercase tracking-wide text-[#4a6366]">Court Context</p>
      <h1 className="type-page-title mt-3 text-[#063f46]">Shared slip unavailable</h1>
      <p className="type-body mt-3 text-cc-secondary">{message}</p>
      <Link
        href="/"
        className="type-interactive mt-8 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-4 text-white hover:opacity-90"
      >
        Back to Court Context
      </Link>
    </div>
  );
}

export default async function SharedSlipPage({ params }: PageProps) {
  const { shareId } = await params;
  const [result, signedIn] = await Promise.all([
    getSharedBetSlipByShareId(shareId),
    isSignedIn(),
  ]);

  return (
    <div className="min-h-screen bg-[#F8FBFA] text-[#063f46]">
      <div className="relative">
        <MarketingHeader />
        <div className="h-20 sm:h-24" aria-hidden />
      </div>
      {!result.ok ? (
        <UnavailableState
          message={
            result.code === 'INVALID_SNAPSHOT'
              ? 'This shared slip is unavailable.'
              : 'This shared slip could not be found.'
          }
        />
      ) : result.share.legs.length === 0 ? (
        <UnavailableState message="This shared slip is unavailable." />
      ) : (
        <SharedSlipView share={result.share} signedIn={signedIn} />
      )}
    </div>
  );
}
