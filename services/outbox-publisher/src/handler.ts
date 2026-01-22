import { Context } from 'aws-lambda';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getConfig } from '@sentinel/config';
import { getEventBridgeClient } from '@sentinel/aws';
import { createLogger } from '@sentinel/logger';
import { listPendingOutbox, markOutboxPublished } from '@sentinel/dynamodb';

export const handler = async (_event: unknown, context: Context) => {
  const config = getConfig();
  const logger = createLogger({ requestId: context.awsRequestId, service: 'outbox-publisher' });
  const eventBridge = getEventBridgeClient();

  const pending = await listPendingOutbox(config.outboxTableName, 20);
  if (pending.length === 0) {
    logger.info('no outbox events pending');
    return { published: 0 };
  }

  let published = 0;
  for (const item of pending) {
    try {
      const response = await eventBridge.send(
        new PutEventsCommand({
          Entries: [
            {
              EventBusName: config.eventBusName,
              Source: item.source,
              DetailType: item.eventType,
              Detail: JSON.stringify(item.detail)
            }
          ]
        })
      );

      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        logger.error('failed to publish outbox event', { outboxId: item.outboxId, response });
        continue;
      }

      await markOutboxPublished(config.outboxTableName, item.outboxId);
      published += 1;
      logger.info('published outbox event', { outboxId: item.outboxId });
    } catch (error) {
      logger.error('outbox publish error', { outboxId: item.outboxId, error: String(error) });
    }
  }

  return { published };
};
