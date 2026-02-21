import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDbDocClient } from '@sentinel/aws';

export type IdempotencyStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type IdempotencyRecord = {
  eventId: string;
  tenantId?: string;
  sourceEventId?: string;
  status: IdempotencyStatus;
  response?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
  expiresAt: number;
};

export type IdempotencyStartResult = {
  started: boolean;
  record?: IdempotencyRecord;
};

export const buildIdempotencyKey = (tenantId: string, eventId: string) => {
  return `TENANT#${tenantId}#EVENT#${eventId}`;
};

export const createIdempotencyStore = (tableName: string, ttlSeconds: number) => {
  const client = getDynamoDbDocClient();

  const getRecord = async (eventId: string): Promise<IdempotencyRecord | undefined> => {
    const response = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { eventId }
      })
    );
    return response.Item as IdempotencyRecord | undefined;
  };

  const start = async (
    eventId: string,
    attributes?: { tenantId?: string; sourceEventId?: string }
  ): Promise<IdempotencyStartResult> => {
    const now = new Date();
    const expiresAt = Math.floor((now.getTime() + ttlSeconds * 1000) / 1000);

    try {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            eventId,
            tenantId: attributes?.tenantId,
            sourceEventId: attributes?.sourceEventId,
            status: 'PROCESSING',
            createdAt: now.toISOString(),
            expiresAt
          },
          ConditionExpression: 'attribute_not_exists(eventId)'
        })
      );

      return { started: true };
    } catch {
      const existing = await getRecord(eventId);
      return { started: false, record: existing };
    }
  };

  const complete = async (eventId: string, response: Record<string, unknown>) => {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { eventId },
        UpdateExpression: 'SET #status = :status, #response = :response, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#response': 'response',
          '#updatedAt': 'updatedAt'
        },
        ExpressionAttributeValues: {
          ':status': 'COMPLETED',
          ':response': response,
          ':updatedAt': new Date().toISOString()
        }
      })
    );
  };

  const fail = async (eventId: string, reason: string) => {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { eventId },
        UpdateExpression: 'SET #status = :status, #response = :response, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#response': 'response',
          '#updatedAt': 'updatedAt'
        },
        ExpressionAttributeValues: {
          ':status': 'FAILED',
          ':response': { reason },
          ':updatedAt': new Date().toISOString()
        }
      })
    );
  };

  return {
    getRecord,
    start,
    complete,
    fail
  };
};
