export type MetricUnit = 'Count' | 'Milliseconds' | 'Seconds' | 'Bytes';

export type MetricEntry = {
  name: string;
  unit: MetricUnit;
  value: number;
};

export type MetricDimensions = Record<string, string>;
export type MetricProperties = Record<string, unknown>;

export const emitMetrics = (
  namespace: string,
  metrics: MetricEntry[],
  dimensions: MetricDimensions,
  properties?: MetricProperties
) => {
  const metricDefinitions = metrics.map((metric) => ({
    Name: metric.name,
    Unit: metric.unit
  }));

  const values: Record<string, number> = {};
  for (const metric of metrics) {
    values[metric.name] = metric.value;
  }

  const payload = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: namespace,
          Dimensions: [Object.keys(dimensions)],
          Metrics: metricDefinitions
        }
      ]
    },
    ...dimensions,
    ...values,
    ...(properties || {})
  };

  console.log(JSON.stringify(payload));
};
