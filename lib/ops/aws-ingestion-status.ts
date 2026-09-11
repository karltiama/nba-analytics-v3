/**
 * Bounded read-only AWS snapshot for Court Context ingestion resources.
 * Never invokes Lambda, never sends/purges SQS, never enables schedules.
 * Failures return UNKNOWN-shaped rows; callers must not treat this as site health.
 */

import { ingestionAwsResources } from './aws-ingestion-resources';
import { rollupScheduleObserved, type AwsScheduleObserved } from './ingestion-observability';

export type LambdaInvocationSuccess = 'UNKNOWN';

export type AwsLambdaLiveStatus = {
  id: string;
  familyId: string | null;
  functionName: string;
  optional: boolean;
  exists: boolean | null;
  state: string | null;
  lastInvocationAt: string | null;
  lastInvocationSuccess: LambdaInvocationSuccess;
  errors24h: number | null;
  throttles24h: number | null;
  durationMs: number | null;
  reservedConcurrencyApplied: boolean | null;
  scheduleObserved: AwsScheduleObserved;
  queried: boolean;
  deployState: 'DEPLOYED' | 'NOT_DEPLOYED' | 'UNKNOWN';
};

export type AwsQueueLiveStatus = {
  id: string;
  optional: boolean;
  deployed: boolean | null;
  visible: number | null;
  notVisible: number | null;
  oldestAgeSeconds: number | null;
  dlqDepth: number | null;
  deployState: 'DEPLOYED' | 'NOT_DEPLOYED' | 'UNKNOWN';
};

export type AwsIngestionSnapshot = {
  queried: boolean;
  available: boolean;
  reason: string;
  scheduleObserved: AwsScheduleObserved;
  lambdas: AwsLambdaLiveStatus[];
  queues: AwsQueueLiveStatus[];
  queueDepth: number | null;
  oldestAgeSeconds: number | null;
  dlqDepth: number | null;
  reservedConcurrencyApplied: boolean | null;
};

export type AwsIngestionPorts = {
  getFunction: (name: string) => Promise<{
    exists: boolean;
    state: string | null;
    reservedConcurrentExecutions: number | null;
  }>;
  getInvocationMetrics: (name: string) => Promise<{
    lastInvocationAt: Date | null;
    errors24h: number | null;
    throttles24h: number | null;
    durationMs: number | null;
  }>;
  describeRule: (name: string) => Promise<'ENABLED' | 'DISABLED' | 'NOT_FOUND' | 'UNKNOWN'>;
  getSchedule: (name: string) => Promise<'ENABLED' | 'DISABLED' | 'NOT_FOUND' | 'UNKNOWN'>;
  getQueue: (name: string) => Promise<{
    exists: boolean;
    visible: number | null;
    notVisible: number | null;
    oldestAgeSeconds: number | null;
  }>;
};

const AWS_QUERY_TIMEOUT_MS = 8_000;
let snapshotCache: { expiresAt: number; value: AwsIngestionSnapshot } | null = null;

export function clearAwsIngestionSnapshotCache(): void {
  snapshotCache = null;
}

function emptySnapshot(reason: string, queried: boolean): AwsIngestionSnapshot {
  return {
    queried,
    available: false,
    reason,
    scheduleObserved: 'UNKNOWN',
    lambdas: [],
    queues: [],
    queueDepth: null,
    oldestAgeSeconds: null,
    dlqDepth: null,
    reservedConcurrencyApplied: null,
  };
}

function isNotFound(err: unknown): boolean {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
  const http =
    err && typeof err === 'object' && '$metadata' in err
      ? Number((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode)
      : 0;
  return (
    name === 'ResourceNotFoundException' ||
    name === 'QueueDoesNotExist' ||
    name === 'ResourceNotFound' ||
    http === 404
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('aws_ops_timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function collectAwsIngestionSnapshot(
  ports: AwsIngestionPorts,
  env: Record<string, string | undefined> = process.env
): Promise<AwsIngestionSnapshot> {
  const catalog = ingestionAwsResources(env);
  const lambdas = await Promise.all(
    catalog.lambdas.map(async (resource): Promise<AwsLambdaLiveStatus> => {
      try {
        const [fn, metrics, ruleStates, scheduleStates] = await Promise.all([
          ports.getFunction(resource.functionName),
          ports.getInvocationMetrics(resource.functionName),
          Promise.all((resource.eventBridgeRules ?? []).map((name) => ports.describeRule(name))),
          Promise.all((resource.schedulerSchedules ?? []).map((name) => ports.getSchedule(name))),
        ]);
        const scheduleObserved = rollupScheduleObserved([...ruleStates, ...scheduleStates]);
        const exists = fn.exists;
        return {
          id: resource.id,
          familyId: resource.familyId,
          functionName: resource.functionName,
          optional: resource.optional,
          exists,
          state: fn.state,
          lastInvocationAt: metrics.lastInvocationAt ? metrics.lastInvocationAt.toISOString() : null,
          lastInvocationSuccess: 'UNKNOWN',
          errors24h: metrics.errors24h,
          throttles24h: metrics.throttles24h,
          durationMs: metrics.durationMs,
          reservedConcurrencyApplied:
            fn.reservedConcurrentExecutions == null ? false : fn.reservedConcurrentExecutions > 0,
          scheduleObserved,
          queried: true,
          deployState: exists ? 'DEPLOYED' : resource.optional ? 'NOT_DEPLOYED' : 'NOT_DEPLOYED',
        };
      } catch {
        return {
          id: resource.id,
          familyId: resource.familyId,
          functionName: resource.functionName,
          optional: resource.optional,
          exists: null,
          state: null,
          lastInvocationAt: null,
          lastInvocationSuccess: 'UNKNOWN',
          errors24h: null,
          throttles24h: null,
          durationMs: null,
          reservedConcurrencyApplied: null,
          scheduleObserved: 'UNKNOWN',
          queried: false,
          deployState: resource.optional ? 'UNKNOWN' : 'UNKNOWN',
        };
      }
    })
  );

  const queues = await Promise.all(
    catalog.queues.map(async (resource): Promise<AwsQueueLiveStatus> => {
      try {
        const [main, dlq] = await Promise.all([
          ports.getQueue(resource.queueName),
          ports.getQueue(resource.dlqName),
        ]);
        if (!main.exists && !dlq.exists) {
          return {
            id: resource.id,
            optional: resource.optional,
            deployed: false,
            visible: null,
            notVisible: null,
            oldestAgeSeconds: null,
            dlqDepth: null,
            deployState: 'NOT_DEPLOYED',
          };
        }
        return {
          id: resource.id,
          optional: resource.optional,
          deployed: main.exists,
          visible: main.visible,
          notVisible: main.notVisible,
          oldestAgeSeconds: main.oldestAgeSeconds,
          dlqDepth: dlq.exists ? dlq.visible : null,
          deployState: main.exists ? 'DEPLOYED' : 'NOT_DEPLOYED',
        };
      } catch {
        return {
          id: resource.id,
          optional: resource.optional,
          deployed: null,
          visible: null,
          notVisible: null,
          oldestAgeSeconds: null,
          dlqDepth: null,
          deployState: 'UNKNOWN',
        };
      }
    })
  );

  const scheduleObserved = rollupScheduleObserved(lambdas.map((row) => row.scheduleObserved));
  const props = queues.find((row) => row.id === 'player_props');
  const propsWorker = lambdas.find((row) => row.id === 'player_props_worker');
  const available = lambdas.some((row) => row.queried) || queues.some((row) => row.deployed !== null);
  return {
    queried: true,
    available,
    reason: available ? 'bounded Court Context AWS snapshot' : 'AWS resources unreadable',
    scheduleObserved,
    lambdas,
    queues,
    queueDepth: props?.visible ?? null,
    oldestAgeSeconds: props?.oldestAgeSeconds ?? null,
    dlqDepth: props?.dlqDepth ?? null,
    reservedConcurrencyApplied: propsWorker?.reservedConcurrencyApplied ?? false,
  };
}

async function createLivePorts(region: string): Promise<AwsIngestionPorts> {
  const [
    { CloudWatchClient, GetMetricStatisticsCommand },
    { LambdaClient, GetFunctionCommand },
    { EventBridgeClient, DescribeRuleCommand },
    { SchedulerClient, GetScheduleCommand },
    { SQSClient, GetQueueUrlCommand, GetQueueAttributesCommand },
  ] = await Promise.all([
    import('@aws-sdk/client-cloudwatch'),
    import('@aws-sdk/client-lambda'),
    import('@aws-sdk/client-eventbridge'),
    import('@aws-sdk/client-scheduler'),
    import('@aws-sdk/client-sqs'),
  ]);

  const cw = new CloudWatchClient({ region });
  const lambda = new LambdaClient({ region });
  const events = new EventBridgeClient({ region });
  const scheduler = new SchedulerClient({ region });
  const sqs = new SQSClient({ region });

  const metricSum = async (
    functionName: string,
    metricName: string,
    start: Date,
    end: Date,
    period: number
  ): Promise<{ timestamp: Date; value: number }[]> => {
    const out = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/Lambda',
        MetricName: metricName,
        Dimensions: [{ Name: 'FunctionName', Value: functionName }],
        StartTime: start,
        EndTime: end,
        Period: period,
        Statistics: ['Sum'],
      })
    );
    return (out.Datapoints ?? [])
      .filter((point) => point.Timestamp != null && point.Sum != null)
      .map((point) => ({ timestamp: point.Timestamp as Date, value: point.Sum as number }))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  };

  return {
    async getFunction(name) {
      try {
        const out = await lambda.send(new GetFunctionCommand({ FunctionName: name }));
        return {
          exists: true,
          state: out.Configuration?.State ?? null,
          reservedConcurrentExecutions: out.Concurrency?.ReservedConcurrentExecutions ?? null,
        };
      } catch (err) {
        if (isNotFound(err)) {
          return { exists: false, state: null, reservedConcurrentExecutions: null };
        }
        throw err;
      }
    },
    async getInvocationMetrics(name) {
      const end = new Date();
      const start7d = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      const start24h = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      const [invocations, errors, throttles, duration] = await Promise.all([
        metricSum(name, 'Invocations', start7d, end, 3600),
        metricSum(name, 'Errors', start24h, end, 3600),
        metricSum(name, 'Throttles', start24h, end, 3600),
        cw.send(
          new GetMetricStatisticsCommand({
            Namespace: 'AWS/Lambda',
            MetricName: 'Duration',
            Dimensions: [{ Name: 'FunctionName', Value: name }],
            StartTime: start24h,
            EndTime: end,
            Period: 3600,
            Statistics: ['Average'],
          })
        ),
      ]);
      const lastInv = invocations.find((point) => point.value > 0);
      const durationPoints = (duration.Datapoints ?? [])
        .filter((point) => point.Average != null)
        .sort((a, b) => (b.Timestamp?.getTime() ?? 0) - (a.Timestamp?.getTime() ?? 0));
      return {
        lastInvocationAt: lastInv?.timestamp ?? null,
        errors24h: errors.reduce((sum, point) => sum + point.value, 0),
        throttles24h: throttles.reduce((sum, point) => sum + point.value, 0),
        durationMs: durationPoints[0]?.Average ?? null,
      };
    },
    async describeRule(name) {
      try {
        const out = await events.send(new DescribeRuleCommand({ Name: name }));
        const state = (out.State ?? '').toUpperCase();
        if (state === 'ENABLED') return 'ENABLED';
        if (state === 'DISABLED') return 'DISABLED';
        return 'UNKNOWN';
      } catch (err) {
        if (isNotFound(err)) return 'NOT_FOUND';
        return 'UNKNOWN';
      }
    },
    async getSchedule(name) {
      try {
        const out = await scheduler.send(new GetScheduleCommand({ Name: name, GroupName: 'default' }));
        const state = (out.State ?? '').toUpperCase();
        if (state === 'ENABLED') return 'ENABLED';
        if (state === 'DISABLED') return 'DISABLED';
        return 'UNKNOWN';
      } catch (err) {
        if (isNotFound(err)) return 'NOT_FOUND';
        return 'UNKNOWN';
      }
    },
    async getQueue(name) {
      try {
        const url = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
        if (!url.QueueUrl) return { exists: false, visible: null, notVisible: null, oldestAgeSeconds: null };
        const attrs = await sqs.send(
          new GetQueueAttributesCommand({
            QueueUrl: url.QueueUrl,
            AttributeNames: [
              'ApproximateNumberOfMessages',
              'ApproximateNumberOfMessagesNotVisible',
              'ApproximateAgeOfOldestMessage',
            ],
          })
        );
        const a = attrs.Attributes ?? {};
        return {
          exists: true,
          visible: a.ApproximateNumberOfMessages != null ? Number(a.ApproximateNumberOfMessages) : null,
          notVisible:
            a.ApproximateNumberOfMessagesNotVisible != null
              ? Number(a.ApproximateNumberOfMessagesNotVisible)
              : null,
          oldestAgeSeconds:
            a.ApproximateAgeOfOldestMessage != null ? Number(a.ApproximateAgeOfOldestMessage) : null,
        };
      } catch (err) {
        if (isNotFound(err)) {
          return { exists: false, visible: null, notVisible: null, oldestAgeSeconds: null };
        }
        throw err;
      }
    },
  };
}

export async function fetchAwsIngestionSnapshot(opts?: {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  force?: boolean;
}): Promise<AwsIngestionSnapshot> {
  const env = opts?.env ?? process.env;
  if (env.OPS_SKIP_AWS === '1') {
    return emptySnapshot('OPS_SKIP_AWS=1', false);
  }
  const ttlMs = 60_000;
  if (!opts?.force && snapshotCache && Date.now() < snapshotCache.expiresAt) {
    return snapshotCache.value;
  }
  try {
    const region = env.AWS_REGION?.trim() || 'us-east-1';
    const ports = await createLivePorts(region);
    const snapshot = await withTimeout(
      collectAwsIngestionSnapshot(ports, env),
      opts?.timeoutMs ?? AWS_QUERY_TIMEOUT_MS
    );
    snapshotCache = { expiresAt: Date.now() + ttlMs, value: snapshot };
    return snapshot;
  } catch (err) {
    const reason =
      err instanceof Error && err.message === 'aws_ops_timeout'
        ? 'AWS ops query timed out'
        : 'AWS credentials or query unavailable';
    const snapshot = emptySnapshot(reason, true);
    snapshotCache = { expiresAt: Date.now() + ttlMs, value: snapshot };
    return snapshot;
  }
}

export function toOpsAwsSnapshot(snapshot: AwsIngestionSnapshot): {
  queried: boolean;
  scheduleObserved: AwsScheduleObserved;
  lambdas: AwsLambdaLiveStatus[];
  queues: AwsQueueLiveStatus[];
  queueDepth: number | null;
  oldestAgeSeconds: number | null;
  dlqDepth: number | null;
  reservedConcurrencyApplied: boolean | null;
} {
  return {
    queried: snapshot.queried,
    scheduleObserved: snapshot.scheduleObserved,
    lambdas: snapshot.lambdas,
    queues: snapshot.queues,
    queueDepth: snapshot.queueDepth,
    oldestAgeSeconds: snapshot.oldestAgeSeconds,
    dlqDepth: snapshot.dlqDepth,
    reservedConcurrencyApplied: snapshot.reservedConcurrencyApplied,
  };
}
