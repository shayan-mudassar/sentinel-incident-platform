import { SQSEvent, SQSBatchResponse, Context } from 'aws-lambda';
import { createLogger } from '@sentinel/logger';

export const handler = async (
  event: SQSEvent,
  context: Context
): Promise<SQSBatchResponse> => {
  const logger = createLogger({ requestId: context.awsRequestId, service: 'notification-worker' });
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      const detail = body.detail || {};

      logger.info('incident notification', {
        incidentId: detail.incidentId,
        changeType: detail.changeType,
        severity: detail.severity,
        status: detail.status,
        source: detail.source,
        fingerprint: detail.fingerprint,
        correlationId: detail.correlationId
      });
    } catch (error) {
      failures.push({ itemIdentifier: record.messageId });
      logger.error('failed to process notification', { error: String(error) });
    }
  }

  return { batchItemFailures: failures };
};
