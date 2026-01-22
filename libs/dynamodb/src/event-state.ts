import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDbDocClient } from '@sentinel/aws';

export type DedupState = {
  count: number;
  windowStart: number;
  lastSeen: string;
  suppressed: boolean;
};

const toDedupKey = (env: string, source: string, fingerprint: string) => ({
  pk: `DEDUP#${env}#${source}#${fingerprint}`,
  sk: 'WINDOW'
});

export const markEventProcessed = async (
  tableName: string,
  eventId: string,
  ttlSeconds: number
): Promise<boolean> => {
  const client = getDynamoDbDocClient();
  const now = new Date();
  const expiresAt = Math.floor((now.getTime() + ttlSeconds * 1000) / 1000);
  const key = { pk: `EVENT#${eventId}`, sk: 'PROCESSED' };

  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...key,
          processedAt: now.toISOString(),
          expiresAt
        },
        ConditionExpression: 'attribute_not_exists(pk)'
      })
    );
    return true;
  } catch {
    return false;
  }
};

const readState = async (tableName: string, key: { pk: string; sk: string }) => {
  const client = getDynamoDbDocClient();
  const response = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: key
    })
  );
  return response.Item as { windowStart?: number; count?: number } | undefined;
};

export const updateDedupState = async (
  tableName: string,
  env: string,
  source: string,
  fingerprint: string,
  windowMs: number,
  ttlSeconds: number
): Promise<DedupState> => {
  const client = getDynamoDbDocClient();
  const key = toDedupKey(env, source, fingerprint);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAt = Math.floor((now + ttlSeconds * 1000) / 1000);

  const existing = await readState(tableName, key);
  const isStale = !existing || !existing.windowStart || now - existing.windowStart > windowMs;

  if (isStale) {
    try {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: key,
          UpdateExpression:
            'SET windowStart = :windowStart, #count = :count, lastSeen = :lastSeen, expiresAt = :expiresAt',
          ExpressionAttributeNames: {
            '#count': 'count'
          },
          ExpressionAttributeValues: {
            ':windowStart': now,
            ':count': 1,
            ':lastSeen': nowIso,
            ':expiresAt': expiresAt,
            ':expected': existing?.windowStart || 0
          },
          ConditionExpression: 'attribute_not_exists(pk) OR windowStart = :expected'
        })
      );

      return { count: 1, windowStart: now, lastSeen: nowIso, suppressed: false };
    } catch {
      const retry = await readState(tableName, key);
      if (retry && retry.windowStart && retry.count) {
        const count = retry.count + 1;
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key,
            UpdateExpression: 'SET #count = :count, lastSeen = :lastSeen, expiresAt = :expiresAt',
            ExpressionAttributeNames: { '#count': 'count' },
            ExpressionAttributeValues: {
              ':count': count,
              ':lastSeen': nowIso,
              ':expiresAt': expiresAt
            }
          })
        );
        return {
          count,
          windowStart: retry.windowStart,
          lastSeen: nowIso,
          suppressed: count > 1
        };
      }
    }
  }

  const current = existing || { windowStart: now, count: 0 };
  const count = (current.count || 0) + 1;

  await client
    .send(
      new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: 'SET #count = :count, lastSeen = :lastSeen, expiresAt = :expiresAt',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: {
          ':count': count,
          ':lastSeen': nowIso,
          ':expiresAt': expiresAt,
          ':expected': current.windowStart
        },
        ConditionExpression: 'windowStart = :expected'
      })
    )
    .catch(async () => {
      const retry = await readState(tableName, key);
      if (!retry || !retry.windowStart) {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key,
            UpdateExpression:
              'SET windowStart = :windowStart, #count = :count, lastSeen = :lastSeen, expiresAt = :expiresAt',
            ExpressionAttributeNames: { '#count': 'count' },
            ExpressionAttributeValues: {
              ':windowStart': now,
              ':count': 1,
              ':lastSeen': nowIso,
              ':expiresAt': expiresAt
            }
          })
        );
        return;
      }

      const retryCount = (retry.count || 0) + 1;
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: key,
          UpdateExpression: 'SET #count = :count, lastSeen = :lastSeen, expiresAt = :expiresAt',
          ExpressionAttributeNames: { '#count': 'count' },
          ExpressionAttributeValues: {
            ':count': retryCount,
            ':lastSeen': nowIso,
            ':expiresAt': expiresAt
          }
        })
      );
    });

  return {
    count,
    windowStart: current.windowStart || now,
    lastSeen: nowIso,
    suppressed: count > 1
  };
};
