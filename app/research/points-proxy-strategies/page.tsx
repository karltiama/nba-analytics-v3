import type { Metadata } from 'next';
import Link from 'next/link';
import { loadPointsProxyResearchLab } from '@/lib/research/points-proxy-research-service';
import { PointsProxyStrategiesDashboard } from './PointsProxyStrategiesDashboard';

export const metadata: Metadata = {
  title: 'Points proxy strategy research | NBA Analytics',
  description:
    'Internal research lab: multi-season proxy strategy comparison and quality breakdowns (read-only S3 artifacts).',
};

export const runtime = 'nodejs';

export default async function PointsProxyStrategiesPage() {
  const result = await loadPointsProxyResearchLab();

  if (!result.ok) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
        <p className="text-xs text-muted-foreground mb-2">
          <Link href="/" className="text-[#00d4ff] hover:underline">
            Home
          </Link>
          <span className="mx-2">/</span>
          <span className="text-white">Research</span>
        </p>
        <h1 className="text-xl font-semibold text-white mb-2">Points Proxy Strategy Research</h1>
        <div className="glass-card rounded-xl p-4 border-l-4 border-l-amber-500 text-sm text-amber-100">
          {result.message}
        </div>
      </main>
    );
  }

  return <PointsProxyStrategiesDashboard viewModel={result.viewModel} bucket={result.bucket} />;
}
