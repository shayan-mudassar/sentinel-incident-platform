import { BatchGetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDbDocClient } from '@sentinel/aws';

export type TenantMetricName = 'ingested_total' | 'deduped_total';

export type TenantMetricRecord = {
  tenantId: string;
  metricName: TenantMetricName;
  count: number;
  updatedAt: string;
};

const buildKey = (tenantId: string, metricName: TenantMetricName) => ({
  pk: `TENANT#${tenantId}`,
  sk: `METRIC#${metricName}`
});

export const incrementTenantMetric = async (
  tableName: string,
  tenantId: string,
  metricName: TenantMetricName,
  incrementBy = 1
): Promise<void> => {
  const client = getDynamoDbDocClient();
  const updatedAt = new Date().toISOString();
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: buildKey(tenantId, metricName),
      UpdateExpression:
        'ADD #count :inc SET updatedAt = :updatedAt, tenantId = :tenantId, metricName = :metricName',
      ExpressionAttributeNames: {
        '#count': 'count'
      },
      ExpressionAttributeValues: {
        ':inc': incrementBy,
        ':updatedAt': updatedAt,
        ':tenantId': tenantId,
        ':metricName': metricName
      }
    })
  );
};

export const getTenantMetrics = async (
  tableName: string,
  tenantId: string,
  metricNames: TenantMetricName[]
): Promise<Record<TenantMetricName, TenantMetricRecord>> => {
  const client = getDynamoDbDocClient();
  const keys = metricNames.map((metricName) => buildKey(tenantId, metricName));

  const response = await client.send(
    new BatchGetCommand({
      RequestItems: {
        [tableName]: {
          Keys: keys
        }
      }
    })
  );

  const items = ((response.Responses || {})[tableName] || []) as TenantMetricRecord[];
  const record: Record<TenantMetricName, TenantMetricRecord> = {} as Record<
    TenantMetricName,
    TenantMetricRecord
  >;

  for (const metricName of metricNames) {
    const match = items.find((item) => item.metricName === metricName);
    record[metricName] =
      match ||
      ({
        tenantId,
        metricName,
        count: 0,
        updatedAt: new Date(0).toISOString()
      } as TenantMetricRecord);
  }

  return record;
};
