import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDbDocClient } from '@sentinel/aws';
import { Severity } from '@sentinel/domain';

export type NotificationTargetType = 'SNS';

export type NotificationTarget = {
  type: NotificationTargetType;
  topicArn: string;
  label?: string;
};

export type NotificationTargetsRecord = {
  tenantId: string;
  severity: Severity | 'ALL';
  targets: NotificationTarget[];
};

const buildKey = (tenantId: string, severity: Severity | 'ALL') => ({
  pk: `TENANT#${tenantId}`,
  sk: `SEVERITY#${severity}`
});

const readTargets = async (
  tableName: string,
  tenantId: string,
  severity: Severity | 'ALL'
): Promise<NotificationTarget[] | undefined> => {
  const client = getDynamoDbDocClient();
  const response = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: buildKey(tenantId, severity)
    })
  );
  const item = response.Item as NotificationTargetsRecord | undefined;
  if (!item || !Array.isArray(item.targets)) {
    return undefined;
  }
  return item.targets;
};

export const getNotificationTargets = async (
  tableName: string,
  tenantId: string,
  severity: Severity
): Promise<NotificationTarget[]> => {
  const direct = await readTargets(tableName, tenantId, severity);
  if (direct && direct.length > 0) {
    return direct;
  }

  const fallback = await readTargets(tableName, tenantId, 'ALL');
  if (fallback && fallback.length > 0) {
    return fallback;
  }

  return [];
};
