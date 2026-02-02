import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDbDocClient } from '@sentinel/aws';

export type DedupState = {
  count: number;
  windowStart: number;
  lastSeen: string;
  suppressed: boolean;
};

export type EventProcessingStatus = 'PROCESSING' | 'PROCESSED' | 'FAILED';

export type EventProcessingResult = {
  status: 'new' | 'duplicate' | 'in_progress' | 'retry';
};

export type SeverityState = {
  count: number;
  windowStart: number;
  lastSeen: string;
};

const toDedupKey = (env: string, source: string, fingerprint: string) => ({
  pk: `DEDUP#${env}#${source}#${fingerprint}`,
  sk: 'WINDOW'
});

const toEventKey = (eventId: string) => ({
  pk: `EVENT#${eventId}`,
  sk: 'STATE'
});

const toSeverityKey = (env: string, source: string, fingerprint: string, windowMs: number) => ({
  pk: `SEVERITY#${env}#${source}#${fingerprint}`,
  sk: `WINDOW#${windowMs}`
});

const isConditionalCheckFailed = (error: unknown) => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'ConditionalCheckFailedException'
  );
};

export const markEventProcessed = async (
  tableName: string,
  eventId: string,
  ttlSeconds: number
): Promise<boolean> => {
  const client = getDynamoDbDocClient();
  const now = new Date();
  const expiresAt = Math.floor((now.getTime() + ttlSeconds * 1000) / 1000);
  const key = toEventKey(eventId);

  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...key,
          status: 'PROCESSED',
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

const readEventState = async (tableName: string, eventId: string) => {
  const client = getDynamoDbDocClient();
  const response = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: toEventKey(eventId)
    })
  );
  return response.Item as { status?: EventProcessingStatus; updatedAt?: string } | undefined;
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

export const startEventProcessing = async (
  tableName: string,
  eventId: string,
  ttlSeconds: number,
  processingTimeoutSeconds: number
): Promise<EventProcessingResult> => {
  const client = getDynamoDbDocClient();
  const now = new Date();
  const updatedAt = now.toISOString();
  const expiresAt = Math.floor((now.getTime() + ttlSeconds * 1000) / 1000);
  const key = toEventKey(eventId);

  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...key,
          status: 'PROCESSING',
          updatedAt,
          expiresAt
        },
        ConditionExpression: 'attribute_not_exists(pk)'
      })
    );
    return { status: 'new' };
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
  }

  const existing = await readEventState(tableName, eventId);
  if (!existing) {
    return { status: 'retry' };
  }

  if (existing.status === 'PROCESSED') {
    return { status: 'duplicate' };
  }

  const staleBefore = new Date(Date.now() - processingTimeoutSeconds * 1000).toISOString();
  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, expiresAt = :expiresAt',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'PROCESSING',
          ':updatedAt': updatedAt,
          ':expiresAt': expiresAt,
          ':failed': 'FAILED',
          ':staleBefore': staleBefore
        },
        ConditionExpression:
          '#status = :failed OR attribute_not_exists(updatedAt) OR updatedAt <= :staleBefore'
      })
    );
    return { status: 'retry' };
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return { status: 'in_progress' };
    }
    throw error;
  }
};

export const completeEventProcessing = async (
  tableName: string,
  eventId: string,
  ttlSeconds: number
) => {
  const client = getDynamoDbDocClient();
  const updatedAt = new Date().toISOString();
  const expiresAt = Math.floor((Date.now() + ttlSeconds * 1000) / 1000);
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: toEventKey(eventId),
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, expiresAt = :expiresAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'PROCESSED',
        ':updatedAt': updatedAt,
        ':expiresAt': expiresAt
      }
    })
  );
};

export const failEventProcessing = async (
  tableName: string,
  eventId: string,
  ttlSeconds: number,
  reason?: string
) => {
  const client = getDynamoDbDocClient();
  const updatedAt = new Date().toISOString();
  const expiresAt = Math.floor((Date.now() + ttlSeconds * 1000) / 1000);
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: toEventKey(eventId),
      UpdateExpression:
        'SET #status = :status, updatedAt = :updatedAt, expiresAt = :expiresAt, lastError = :lastError',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'FAILED',
        ':updatedAt': updatedAt,
        ':expiresAt': expiresAt,
        ':lastError': reason || 'unknown'
      }
    })
  );
};

export const updateSeverityState = async (
  tableName: string,
  env: string,
  source: string,
  fingerprint: string,
  windowMs: number,
  ttlSeconds: number
): Promise<SeverityState> => {
  const client = getDynamoDbDocClient();
  const key = toSeverityKey(env, source, fingerprint, windowMs);
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

      return { count: 1, windowStart: now, lastSeen: nowIso };
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
          lastSeen: nowIso
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
    lastSeen: nowIso
  };
};
