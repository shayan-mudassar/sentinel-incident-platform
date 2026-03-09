import { Context, SQSEvent, SQSBatchResponse, SQSRecord } from 'aws-lambda';
import { getConfig } from '@sentinel/config';
import { createLogger } from '@sentinel/logger';
import { emitMetrics } from '@sentinel/metrics';
import {
  getIncidentById,
  listIncidentEvents,
  updateIncidentAiResult,
  updateIncidentAiStatus
} from '@sentinel/dynamodb';
import { analyzeWithProvider, createAiProvider } from '@sentinel/ai';
import { IncidentChangedDetail } from '@sentinel/events';
import { IncidentEvent, Severity } from '@sentinel/domain';

const parseRecord = (record: SQSRecord): IncidentChangedDetail => {
  const body = JSON.parse(record.body);
  return (body.detail || body) as IncidentChangedDetail;
};

const shouldAnalyze = (changeType: string | undefined, reanalyzeOnUpdate: boolean) => {
  if (!changeType) {
    return true;
  }
  if (changeType === 'OPENED' || changeType === 'ESCALATED') {
    return true;
  }
  if (changeType === 'UPDATED') {
    return reanalyzeOnUpdate;
  }
  return false;
};

const sanitizeError = (error: unknown) => {
  if (typeof error === 'string') {
    return error.slice(0, 240);
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 240);
  }
  return String(error).slice(0, 240);
};

const isConditionalCheckFailed = (error: unknown) => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'ConditionalCheckFailedException'
  );
};

const resolveSeverityHint = (events: IncidentEvent[]) => {
  for (const event of events) {
    if (event.severityHint) {
      return event.severityHint;
    }
  }
  return undefined;
};

export const handler = async (event: SQSEvent, context: Context): Promise<SQSBatchResponse> => {
  const config = getConfig();
  const baseLogger = createLogger({ requestId: context.awsRequestId, service: 'ai-analysis' });
  const failures: { itemIdentifier: string }[] = [];

  const provider = config.aiEnabled
    ? createAiProvider({
        aiProvider: config.aiProvider,
        aiModel: config.aiModel,
        aiTimeoutMs: config.aiTimeoutMs,
        aiMaxRetries: config.aiMaxRetries,
        openaiApiKey: config.openaiApiKey
      })
    : undefined;

  for (const record of event.Records) {
    let incidentVersion: number | undefined;
    let tenantId: string | undefined;
    let incidentId: string | undefined;
    try {
      const detail = parseRecord(record);
      tenantId = detail.tenantId;
      incidentId = detail.incidentId;
      if (!tenantId || !incidentId) {
        throw new Error('missing_incident_context');
      }

      const logger = baseLogger.withContext({
        tenantId,
        incidentId,
        changeType: detail.changeType,
        requestId: detail.requestId,
        correlationId: detail.correlationId
      });

      const incident = await getIncidentById(config.incidentsTableName, tenantId, incidentId);
      if (!incident) {
        logger.warn('incident missing for ai analysis', { incidentId });
        continue;
      }
      incidentVersion = incident.version;

      const canAnalyze = shouldAnalyze(detail.changeType, config.aiReanalyzeOnIncidentUpdate);
      if (!canAnalyze) {
        emitMetrics(
          'Sentinel',
          [{ name: 'ai_analysis_skipped', unit: 'Count', value: 1 }],
          { service: 'ai-analysis', tenantId, provider: config.aiProvider }
        );
        continue;
      }

      const tryUpdateStatus = async (
        status: 'pending' | 'failed' | 'skipped',
        errorMessage?: string
      ) => {
        if (!incidentVersion || !tenantId || !incidentId) {
          return;
        }
        try {
          await updateIncidentAiStatus(config.incidentsTableName, tenantId, incidentId, incidentVersion, status, {
            aiProvider: provider?.name,
            aiModel: config.aiModel,
            aiError: errorMessage
          });
        } catch (error) {
          if (isConditionalCheckFailed(error)) {
            return;
          }
          throw error;
        }
      };

      if (incident.aiStatus === 'pending' && incident.aiIncidentVersion === incident.version) {
        logger.info('ai analysis already pending', { incidentId });
        continue;
      }

      if (
        incident.aiStatus === 'completed' &&
        incident.aiIncidentVersion === incident.version &&
        !config.aiReanalyzeOnIncidentUpdate
      ) {
        logger.info('ai analysis already completed', { incidentId });
        continue;
      }

      if (!config.aiEnabled || !provider) {
        if (incident.aiStatus !== 'completed') {
          await tryUpdateStatus('skipped', 'ai_disabled');
        }
        emitMetrics(
          'Sentinel',
          [{ name: 'ai_analysis_skipped', unit: 'Count', value: 1 }],
          { service: 'ai-analysis', tenantId, provider: config.aiProvider }
        );
        continue;
      }

      if (incident.eventCount < config.aiMinEventCountForAnalysis) {
        await tryUpdateStatus('skipped', 'insufficient_events');
        emitMetrics(
          'Sentinel',
          [{ name: 'ai_analysis_skipped', unit: 'Count', value: 1 }],
          { service: 'ai-analysis', tenantId, provider: provider.name }
        );
        continue;
      }

      try {
        await updateIncidentAiStatus(
          config.incidentsTableName,
          tenantId,
          incidentId,
          incident.version,
          'pending',
          { aiProvider: provider.name, aiModel: config.aiModel }
        );
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          logger.info('ai analysis skipped due to incident update');
          emitMetrics(
            'Sentinel',
            [{ name: 'ai_analysis_skipped', unit: 'Count', value: 1 }],
            { service: 'ai-analysis', tenantId, provider: provider.name }
          );
          continue;
        }
        throw error;
      }

      const start = Date.now();
      emitMetrics(
        'Sentinel',
        [{ name: 'ai_analysis_started', unit: 'Count', value: 1 }],
        { service: 'ai-analysis', tenantId, provider: provider.name }
      );

      let recentEvents: IncidentEvent[] = [];
      try {
        const result = await listIncidentEvents(config.incidentEventsTableName, {
          tenantId,
          incidentId,
          limit: 5
        });
        recentEvents = result.items;
      } catch (error) {
        logger.warn('failed to load incident events for ai analysis', { error: String(error) });
      }

      const output = await analyzeWithProvider(
        provider,
        {
          incident,
          recentEvents,
          severityHint: resolveSeverityHint(recentEvents),
          eventCount: incident.eventCount
        },
        {
          aiProvider: config.aiProvider,
          aiModel: config.aiModel,
          aiTimeoutMs: config.aiTimeoutMs,
          aiMaxRetries: config.aiMaxRetries,
          openaiApiKey: config.openaiApiKey
        }
      );

      try {
        await updateIncidentAiResult(config.incidentsTableName, tenantId, incidentId, incident.version, output);
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          logger.info('ai analysis result skipped due to incident update');
          emitMetrics(
            'Sentinel',
            [{ name: 'ai_analysis_skipped', unit: 'Count', value: 1 }],
            { service: 'ai-analysis', tenantId, provider: provider.name }
          );
          continue;
        }
        throw error;
      }

      emitMetrics(
        'Sentinel',
        [
          { name: 'ai_analysis_completed', unit: 'Count', value: 1 },
          { name: 'ai_analysis_latency_ms', unit: 'Milliseconds', value: Date.now() - start }
        ],
        { service: 'ai-analysis', tenantId, provider: provider.name }
      );
      logger.info('ai analysis completed', { incidentId, provider: provider.name });
    } catch (error) {
      failures.push({ itemIdentifier: record.messageId });
      baseLogger.error('ai analysis failed', { error: String(error) });
      if (tenantId && incidentId && incidentVersion) {
        try {
          await updateIncidentAiStatus(
            config.incidentsTableName,
            tenantId,
            incidentId,
            incidentVersion,
            'failed',
            { aiError: sanitizeError(error) }
          );
        } catch {
          // best effort
        }
      }
      emitMetrics(
        'Sentinel',
        [{ name: 'ai_analysis_failed', unit: 'Count', value: 1 }],
        { service: 'ai-analysis', tenantId: 'unknown', provider: config.aiProvider }
      );
    }
  }

  return { batchItemFailures: failures };
};
