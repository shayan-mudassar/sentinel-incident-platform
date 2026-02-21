import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDbDocClient } from '@sentinel/aws';
import { IngestEvent, IncidentEvent } from '@sentinel/domain';

export const recordIncidentEvent = async (
  tableName: string,
  tenantId: string,
  incidentId: string,
  event: IngestEvent,
  ttlSeconds: number
) => {
  const client = getDynamoDbDocClient();
  const eventTime = new Date(event.timestamp).toISOString();
  const expiresAt = Math.floor((Date.now() + ttlSeconds * 1000) / 1000);

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        pk: `TENANT#${tenantId}#INCIDENT#${incidentId}`,
        sk: `EVENT#${eventTime}#${event.eventId}`,
        tenantId,
        incidentId,
        eventId: event.eventId,
        source: event.source,
        type: event.type,
        severityHint: event.severityHint,
        timestamp: eventTime,
        fingerprint: event.fingerprint,
        attributes: event.attributes,
        expiresAt
      }
    })
  );
};

export type ListIncidentEventsOptions = {
  tenantId: string;
  incidentId: string;
  limit?: number;
  nextToken?: Record<string, unknown>;
};

export type ListIncidentEventsResult = {
  items: IncidentEvent[];
  nextToken?: Record<string, unknown>;
};

export const listIncidentEvents = async (
  tableName: string,
  options: ListIncidentEventsOptions
): Promise<ListIncidentEventsResult> => {
  const client = getDynamoDbDocClient();
  const response = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
      ExpressionAttributeNames: {
        '#pk': 'pk',
        '#sk': 'sk'
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${options.tenantId}#INCIDENT#${options.incidentId}`,
        ':sk': 'EVENT#'
      },
      ExclusiveStartKey: options.nextToken,
      Limit: options.limit || 50,
      ScanIndexForward: false
    })
  );

  return {
    items: (response.Items || []) as IncidentEvent[],
    nextToken: response.LastEvaluatedKey
  };
};
