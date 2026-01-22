import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDbDocClient } from '@sentinel/aws';

export type OutboxStatus = 'PENDING' | 'PUBLISHED' | 'FAILED';

export type OutboxEvent = {
  outboxId: string;
  status: OutboxStatus;
  eventType: string;
  source: string;
  detail: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
  expiresAt: number;
};

export const putOutboxEvent = async (tableName: string, event: OutboxEvent) => {
  const client = getDynamoDbDocClient();
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: event,
      ConditionExpression: 'attribute_not_exists(outboxId)'
    })
  );
};

export const listPendingOutbox = async (tableName: string, limit: number) => {
  const client = getDynamoDbDocClient();
  const response = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'status-index',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'PENDING'
      },
      Limit: limit
    })
  );
  return (response.Items || []) as OutboxEvent[];
};

export const markOutboxPublished = async (tableName: string, outboxId: string) => {
  const client = getDynamoDbDocClient();
  const updatedAt = new Date().toISOString();
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { outboxId },
      UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt'
      },
      ExpressionAttributeValues: {
        ':status': 'PUBLISHED',
        ':updatedAt': updatedAt,
        ':expected': 'PENDING'
      },
      ConditionExpression: '#status = :expected'
    })
  );
};
