'use client';

import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { MetricKey } from '@/lib/players/types';

interface PlayerAnalysisState {
  activeMetric: MetricKey;
  bettingLine: number | null;
  setActiveMetric: (metric: MetricKey) => void;
  setBettingLine: (line: number | null) => void;
}

const PlayerAnalysisContext = createContext<PlayerAnalysisState | null>(null);

export function PlayerAnalysisProvider({ children }: { children: ReactNode }) {
  const [activeMetric, setActiveMetricRaw] = useState<MetricKey>('pts');
  const [bettingLine, setBettingLineRaw] = useState<number | null>(null);

  const setActiveMetric = useCallback((m: MetricKey) => setActiveMetricRaw(m), []);
  const setBettingLine = useCallback((l: number | null) => setBettingLineRaw(l), []);

  return (
    <PlayerAnalysisContext.Provider
      value={{ activeMetric, bettingLine, setActiveMetric, setBettingLine }}
    >
      {children}
    </PlayerAnalysisContext.Provider>
  );
}

export function usePlayerAnalysis(): PlayerAnalysisState | null {
  return useContext(PlayerAnalysisContext);
}
