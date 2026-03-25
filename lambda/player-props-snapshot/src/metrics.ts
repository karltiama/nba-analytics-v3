export function emitCoverageMetric(namespace: string, dims: Record<string, string>, values: Record<string, number>): void {
  const metricDefs = Object.keys(values).map((name) => ({ Name: name, Unit: 'Count' }));
  const payload = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: namespace,
          Dimensions: [Object.keys(dims)],
          Metrics: metricDefs,
        },
      ],
    },
    ...dims,
    ...values,
  };
  console.log(JSON.stringify(payload));
}
