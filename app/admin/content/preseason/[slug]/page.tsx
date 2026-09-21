import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  draftPath,
  packetPath,
  readPreseasonDraft,
} from '@/lib/teams/preseason-preview/automation/storage';
import { promises as fs } from 'fs';
import type { PreseasonTeamPacket } from '@/lib/teams/preseason-preview/automation/types';

export const metadata: Metadata = {
  title: 'Preseason Preview Draft Detail',
  robots: { index: false, follow: false },
};

const SEASON = '2026';

async function readPacket(
  slug: string
): Promise<PreseasonTeamPacket | null> {
  try {
    const raw = await fs.readFile(packetPath(SEASON, slug), 'utf8');
    return JSON.parse(raw) as PreseasonTeamPacket;
  } catch {
    return null;
  }
}

export default async function PreseasonDraftDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = rawSlug.toUpperCase();
  const draft = await readPreseasonDraft(SEASON, slug);
  if (!draft) notFound();
  const packet = await readPacket(slug);

  return (
    <main className="min-h-screen bg-background gradient-mesh">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="space-y-2">
          <Link
            href="/admin/content/preseason"
            className="text-xs text-sky-300 hover:underline"
          >
            ← All teams
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            {draft.team.name} ({slug})
          </h1>
          <p className="text-sm text-muted-foreground">
            Review {draft.review.status} · {draft.review.warnings.length}{' '}
            warnings · draft file {draftPath(SEASON, slug)}
          </p>
        </header>

        <Section title="Warnings">
          {draft.review.warnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">None</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm text-amber-200/90">
              {draft.review.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Facts">
          {packet ? (
            <pre className="max-h-[28rem] overflow-auto rounded-md bg-black/40 p-3 text-xs text-white/80">
              {JSON.stringify(
                {
                  team: packet.team,
                  previousSeasonSnapshot: packet.previousSeasonSnapshot,
                  additions: packet.additions,
                  departures: packet.departures,
                  returningCount: packet.returningPlayers.length,
                  playerSeasonStats: packet.playerSeasonStats,
                  schedule: packet.schedule,
                  availableWowySummaries: packet.availableWowySummaries,
                  warnings: packet.warnings,
                },
                null,
                2
              )}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              Packet file missing. Run preseason:packet for this team.
            </p>
          )}
        </Section>

        <Section title="Signals">
          <pre className="max-h-[28rem] overflow-auto rounded-md bg-black/40 p-3 text-xs text-white/80">
            {JSON.stringify(draft.contextSignals, null, 2)}
          </pre>
        </Section>

        <Section title="Generated">
          <pre className="max-h-[28rem] overflow-auto rounded-md bg-black/40 p-3 text-xs text-white/80">
            {JSON.stringify(
              {
                headline: draft.headline,
                dek: draft.dek,
                bigPicture: draft.bigPicture,
                playersToWatch: draft.playersToWatch,
                roleWatch: draft.roleWatch,
                keyQuestions: draft.keyQuestions,
                outlook: draft.outlook,
                snapshot: draft.snapshot,
                rosterChanges: draft.rosterChanges,
                projectedRotation: draft.projectedRotation,
                sourceSummary: draft.sourceSummary,
              },
              null,
              2
            )}
          </pre>
        </Section>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}
