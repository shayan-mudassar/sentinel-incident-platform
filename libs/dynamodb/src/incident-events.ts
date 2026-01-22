import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDbDocClient } from '@sentinel/aws';
import { IngestEvent } from '@sentinel/domain';

export const recordIncidentEvent = async (
  tableName: string,
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
        pk: `INCIDENT#${incidentId}`,
        sk: `EVENT#${eventTime}#${event.eventId}`,
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
