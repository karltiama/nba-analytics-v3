import type { Metadata } from 'next';
import { BacktestsDashboard } from './BacktestsDashboard';

export const metadata: Metadata = {
  title: 'Backtest results | NBA Analytics',
  description:
    'Inspect points_l5_vs_season_v1 backtest reports (summary, season comparison, threshold sweep) from S3.',
};

export default function ResearchBacktestsPage() {
  return <BacktestsDashboard />;
}
