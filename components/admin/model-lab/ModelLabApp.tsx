'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ExperimentRecord, ModelLabStatus } from '@/lib/model-lab/types';
import { ExperimentHistory } from '@/components/admin/model-lab/ExperimentHistory';
import { ExperimentCompare } from '@/components/admin/model-lab/ExperimentCompare';
import { PlayerGameExplorer } from '@/components/admin/model-lab/PlayerGameExplorer';
import { PerformanceSlices } from '@/components/admin/model-lab/PerformanceSlices';
import { LabStatus } from '@/components/admin/model-lab/LabStatus';

export function ModelLabApp({
  catalog,
  status,
}: {
  catalog: ExperimentRecord[];
  status: ModelLabStatus;
}) {
  return (
    <Tabs defaultValue="history" className="w-full">
      <TabsList variant="line" className="flex flex-wrap h-auto">
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="compare">Compare</TabsTrigger>
        <TabsTrigger value="explorer">Player / game</TabsTrigger>
        <TabsTrigger value="slices">Slices</TabsTrigger>
        <TabsTrigger value="status">Status</TabsTrigger>
      </TabsList>
      <TabsContent value="history" className="mt-4">
        <ExperimentHistory catalog={catalog} />
      </TabsContent>
      <TabsContent value="compare" className="mt-4">
        <ExperimentCompare catalog={catalog} />
      </TabsContent>
      <TabsContent value="explorer" className="mt-4">
        <PlayerGameExplorer catalog={catalog} />
      </TabsContent>
      <TabsContent value="slices" className="mt-4">
        <PerformanceSlices catalog={catalog} />
      </TabsContent>
      <TabsContent value="status" className="mt-4">
        <LabStatus status={status} />
      </TabsContent>
    </Tabs>
  );
}
