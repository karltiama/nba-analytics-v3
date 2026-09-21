import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TeamPreseasonPreviewView } from '@/components/teams/preseason-preview/TeamPreseasonPreviewView';
import { loadTeamPreseasonPreview } from '@/lib/teams/preseason-preview';
import {
  getTeamById,
  resolveAnalyticsTeamId,
} from '@/lib/teams/analytics-queries';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ teamId: string }>;
}): Promise<Metadata> {
  const { teamId } = await params;
  const model = await loadTeamPreseasonPreview(teamId);
  if (model) {
    return {
      title: `${model.team.full_name} Preseason Preview | Court Context`,
      description: model.content.dek,
    };
  }
  const analyticsTeamId = await resolveAnalyticsTeamId(teamId);
  const team = analyticsTeamId ? await getTeamById(analyticsTeamId) : null;
  if (team) {
    return {
      title: `${team.full_name} Preseason Preview | Court Context`,
      description: `Preseason preview for the ${team.full_name}.`,
    };
  }
  return { title: 'Team Preseason Preview | Court Context' };
}

export default async function TeamPreseasonPreviewPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const model = await loadTeamPreseasonPreview(teamId);

  if (model) {
    return (
      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-14">
        <p className="mb-4 text-xs text-[#4a6366]">
          <Link
            href={`/teams/${teamId}`}
            className="text-[#075B5C] hover:underline"
          >
            ← Back to team page
          </Link>
          <span className="mx-1.5 text-[#DCE9EA]">·</span>
          {model.contentSource === 'research_draft'
            ? 'Research draft scaffold — edit before publishing'
            : 'Research briefing — editorial context, not predictions'}
        </p>
        <TeamPreseasonPreviewView model={model} routeTeamId={teamId} />
      </main>
    );
  }

  const analyticsTeamId = await resolveAnalyticsTeamId(teamId);
  if (!analyticsTeamId) notFound();
  const team = await getTeamById(analyticsTeamId);
  if (!team) notFound();

  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-14">
      <p className="mb-4 text-xs text-[#4a6366]">
        <Link
          href={`/teams/${teamId}`}
          className="text-[#075B5C] hover:underline"
        >
          ← Back to team page
        </Link>
      </p>
      <section className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-8 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#4a6366] mb-2">
          Preseason Preview
        </p>
        <h1 className="text-2xl font-bold text-[#063f46] mb-3">
          {team.full_name}
        </h1>
        <p className="text-sm text-[#4a6366] leading-relaxed mb-3">
          No curated preview and no research draft scaffold yet for this team.
        </p>
        <p className="text-sm text-[#4a6366] leading-relaxed font-mono text-xs">
          npm run preseason:draft-preview -- --team={team.abbreviation} --season=2026
        </p>
      </section>
    </main>
  );
}
