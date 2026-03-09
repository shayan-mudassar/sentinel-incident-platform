import { SQSEvent, SQSBatchResponse, Context } from 'aws-lambda';
import { PublishCommand } from '@aws-sdk/client-sns';
import { getConfig } from '@sentinel/config';
import { getIncidentById, getNotificationTargets } from '@sentinel/dynamodb';
import { getSnsClient } from '@sentinel/aws';
import { createLogger } from '@sentinel/logger';
import { Severity } from '@sentinel/domain';

export const handler = async (
  event: SQSEvent,
  context: Context
): Promise<SQSBatchResponse> => {
  const config = getConfig();
  const logger = createLogger({ requestId: context.awsRequestId, service: 'notification-worker' });
  const failures: { itemIdentifier: string }[] = [];
  const sns = getSnsClient();

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      const detail = body.detail || {};
      const recordLogger = detail.requestId ? logger.withContext({ requestId: detail.requestId }) : logger;
      const tenantId = detail.tenantId as string | undefined;
      const severity = detail.severity as Severity | undefined;

      if (!tenantId) {
        throw new Error('missing_tenant_id');
      }

      if (!severity) {
        throw new Error('missing_severity');
      }

      if (!config.notificationTargetsTableName) {
        recordLogger.warn('notification targets table not configured', { tenantId });
      }

      const incidentId = detail.incidentId as string | undefined;
      const incident = incidentId
        ? await getIncidentById(config.incidentsTableName, tenantId, incidentId)
        : undefined;

      const targets = config.notificationTargetsTableName
        ? await getNotificationTargets(config.notificationTargetsTableName, tenantId, severity)
        : [];

      const defaultTopic = process.env.DEFAULT_NOTIFICATION_TOPIC_ARN;
      const effectiveTargets =
        targets.length > 0
          ? targets
          : defaultTopic
            ? [{ type: 'SNS' as const, topicArn: defaultTopic, label: 'default' }]
            : [];

      if (effectiveTargets.length === 0) {
        recordLogger.info('no notification targets for incident', { tenantId, severity });
        continue;
      }

      const subject = `[Sentinel] ${detail.changeType} ${detail.severity?.toUpperCase?.() || detail.severity} ${detail.source}`;
      const messageLines = [
        `Incident ${detail.changeType || 'UPDATED'} (${detail.status || 'UNKNOWN'})`,
        `Tenant: ${tenantId}`,
        `Severity: ${detail.severity || 'unknown'}`,
        `Source: ${detail.source || 'unknown'}`,
        `Env: ${detail.env || 'unknown'}`,
        `Fingerprint: ${detail.fingerprint || 'unknown'}`,
        `Incident ID: ${detail.incidentId || 'unknown'}`,
        `Updated: ${detail.updatedAt || new Date().toISOString()}`,
        `Correlation: ${detail.correlationId || 'n/a'}`
      ];

      if (incident?.aiSummary) {
        messageLines.push(`AI Summary: ${incident.aiSummary}`);
      } else if (incident?.aiStatus === 'failed') {
        messageLines.push(`AI Summary: unavailable (${incident.aiError || 'failed'})`);
      } else if (incident?.aiStatus === 'pending') {
        messageLines.push('AI Summary: pending analysis');
      }

      if (incident?.aiSeverityRecommendation) {
        messageLines.push(`AI Severity: ${incident.aiSeverityRecommendation}`);
      }

      if (incident?.aiSuggestedActions && incident.aiSuggestedActions.length > 0) {
        messageLines.push(`AI Actions: ${incident.aiSuggestedActions.join('; ')}`);
      }

      const message = messageLines.join('\n');

      for (const target of effectiveTargets) {
        await sns.send(
          new PublishCommand({
            TopicArn: target.topicArn,
            Subject: subject,
            Message: message,
            MessageAttributes: {
              tenantId: { DataType: 'String', StringValue: tenantId },
              severity: { DataType: 'String', StringValue: severity },
              status: { DataType: 'String', StringValue: detail.status || 'UNKNOWN' }
            }
          })
        );
      }

      recordLogger.info('incident notification', {
        incidentId: detail.incidentId,
        changeType: detail.changeType,
        severity: detail.severity,
        status: detail.status,
        source: detail.source,
        fingerprint: detail.fingerprint,
        correlationId: detail.correlationId,
        requestId: detail.requestId,
        tenantId
      });
    } catch (error) {
      failures.push({ itemIdentifier: record.messageId });
      logger.error('failed to process notification', { error: String(error) });
    }
  }

  return { batchItemFailures: failures };
};
