import { SQSEvent, SQSBatchResponse, Context, SQSRecord } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { getConfig, loadRules } from '@sentinel/config';
import { createLogger } from '@sentinel/logger';
import { emitMetrics } from '@sentinel/metrics';
import {
  buildIncidentKey,
  completeEventProcessing,
  createIncident,
  deleteActivePointer,
  getActiveIncident,
  getIncidentById,
  incrementTenantMetric,
  recordIncidentEvent,
  startEventProcessing,
  updateActivePointer,
  updateIncident,
  updateDedupState,
  updateSeverityState,
  failEventProcessing,
  putOutboxEvent
} from '@sentinel/dynamodb';
import { buildIncidentChangedDetail } from '@sentinel/events';
import { IngestEvent, Incident, IncidentStatus, Severity, maxSeverity } from '@sentinel/domain';

export const severityFromHint = (hint?: Severity): Severity => {
  return hint || 'low';
};

export const evaluateSeverity = (
  hint: Severity | undefined,
  rules: Awaited<ReturnType<typeof loadRules>>,
  countsByWindow: Map<number, number>,
  fallbackWindowMs: number
) => {
  let severity = severityFromHint(hint);
  for (const rule of rules.rules) {
    const windowMs = rule.windowMs || fallbackWindowMs;
    const count = countsByWindow.get(windowMs) || 0;
    if (count >= rule.threshold) {
      severity = maxSeverity(severity, rule.severity);
    }
  }
  return severity;
};

const parseRecord = (
  record: SQSRecord
): IngestEvent & { env?: string; correlationId?: string; tenantId?: string } => {
  const body = JSON.parse(record.body);
  return body.detail || body;
};

const shouldKeepActive = (status: IncidentStatus) => status !== 'RESOLVED';

export const handler = async (
  event: SQSEvent,
  context: Context
): Promise<SQSBatchResponse> => {
  const config = getConfig();
  const logger = createLogger({ requestId: context.awsRequestId, service: 'incident-engine' });
  const rulesCache = new Map<string, Awaited<ReturnType<typeof loadRules>>>();
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      await processRecord(record, config, logger, rulesCache);
    } catch (error) {
      failures.push({ itemIdentifier: record.messageId });
      logger.error('failed to process record', { error: String(error) });
    }
  }

  return { batchItemFailures: failures };
};

const processRecord = async (
  record: SQSRecord,
  config: ReturnType<typeof getConfig>,
  baseLogger: ReturnType<typeof createLogger>,
  rulesCache: Map<string, Awaited<ReturnType<typeof loadRules>>>
) => {
  const detail = parseRecord(record) as IngestEvent & {
    env?: string;
    correlationId?: string;
    tenantId?: string;
  };

  if (!detail.tenantId) {
    baseLogger.error('missing tenant id on event detail', { eventId: detail.eventId });
    throw new Error('missing_tenant_id');
  }

  const tenantId = detail.tenantId;
  const rules = rulesCache.get(tenantId) || (await loadRules(config.rulesTableName, tenantId));
  if (!rulesCache.has(tenantId)) {
    rulesCache.set(tenantId, rules);
  }
  const dedupWindowMs = rules.dedupWindowMs ?? config.dedupWindowMs;
  const severityWindowMs = rules.severityWindowMs ?? config.severityWindowMs;

  const env = typeof detail.attributes?.env === 'string' ? (detail.attributes.env as string) : config.defaultEnv;
  const correlationId = detail.correlationId || detail.eventId;
  const logger = baseLogger.withContext({
    correlationId,
    eventId: detail.eventId,
    source: detail.source,
    fingerprint: detail.fingerprint,
    tenantId
  });

  const processing = await startEventProcessing(
    config.eventStateTableName,
    tenantId,
    detail.eventId,
    config.eventStateTtlSeconds,
    config.processingTimeoutSeconds
  );

  if (processing.status === 'duplicate') {
    logger.info('duplicate event detected, skipping');
    return;
  }

  if (processing.status === 'in_progress') {
    logger.info('event already in progress, skipping');
    return;
  }

  let succeeded = false;
  try {
    const dedup = await updateDedupState(
      config.eventStateTableName,
      tenantId,
      env,
      detail.source,
      detail.fingerprint,
      dedupWindowMs,
      config.eventStateTtlSeconds
    );

    const suppressed = dedup.suppressed;
    if (suppressed) {
      emitMetrics('Sentinel', [{ name: 'events_deduplicated', unit: 'Count', value: 1 }], {
        service: 'incident-engine',
        source: detail.source,
        tenantId
      });
      if (config.metricsTableName) {
        try {
          await incrementTenantMetric(config.metricsTableName, tenantId, 'deduped_total', 1);
        } catch (error) {
          logger.warn('failed to update dedup metrics', { error: String(error) });
        }
      }
      logger.info('event suppressed by dedup', { count: dedup.count });
    }

    const processingLatencyMs = Date.now() - new Date(detail.timestamp).getTime();
    emitMetrics('Sentinel', [{ name: 'processing_latency_ms', unit: 'Milliseconds', value: processingLatencyMs }], {
      service: 'incident-engine',
      source: detail.source,
      tenantId
    });

    const countsByWindow = new Map<number, number>();
    for (const rule of rules.rules) {
      const windowMs = rule.windowMs || severityWindowMs;
      if (countsByWindow.has(windowMs)) {
        continue;
      }
      const state = await updateSeverityState(
        config.eventStateTableName,
        tenantId,
        env,
        detail.source,
        detail.fingerprint,
        windowMs,
        config.eventStateTtlSeconds
      );
      countsByWindow.set(windowMs, state.count);
    }

    const incidentKey = buildIncidentKey(tenantId, env, detail.source, detail.fingerprint);
    const severity = evaluateSeverity(detail.severityHint, rules, countsByWindow, severityWindowMs);

    const openIncident = async () => {
      const incidentId = uuidv4();
      const now = new Date().toISOString();
      const incident: Incident = {
        incidentId,
        tenantId,
        status: 'OPEN',
        source: detail.source,
        fingerprint: detail.fingerprint,
        env,
        severity,
        openedAt: now,
        updatedAt: now,
        lastEventAt: detail.timestamp,
        eventCount: 1,
        version: 1
      };

      try {
        await createIncident(
          config.incidentsTableName,
          tenantId,
          incident,
          env,
          detail.source,
          detail.fingerprint
        );
        if (!suppressed) {
          await recordIncidentEvent(
            config.incidentEventsTableName,
            tenantId,
            incidentId,
            detail,
            config.incidentEventsTtlSeconds
          );
        }
        await putOutboxEvent(config.outboxTableName, {
          outboxId: `INCIDENT#${incidentId}#${incident.version}`,
          status: 'PENDING',
          eventType: 'IncidentChanged',
          source: 'sentinel.incident',
          detail: buildIncidentChangedDetail(incident, 'OPENED', correlationId),
          createdAt: now,
          expiresAt: Math.floor((Date.now() + config.outboxTtlSeconds * 1000) / 1000)
        });

        emitMetrics('Sentinel', [{ name: 'incidents_opened', unit: 'Count', value: 1 }], {
          service: 'incident-engine',
          source: detail.source,
          tenantId
        });

        logger.info('incident opened', { incidentId, incidentKey });
        return true;
      } catch (error) {
        logger.warn('race detected while opening incident, retrying', { error: String(error) });
        return false;
      }
    };

    const active = await getActiveIncident(
      config.incidentsTableName,
      tenantId,
      env,
      detail.source,
      detail.fingerprint
    );

    if (!active) {
      const created = await openIncident();
      if (created) {
        succeeded = true;
        return;
      }
    }

    const pointer = active ||
      (await getActiveIncident(config.incidentsTableName, tenantId, env, detail.source, detail.fingerprint));

    if (!pointer) {
      throw new Error('active pointer missing after create attempt');
    }

    const incident = await getIncidentById(config.incidentsTableName, tenantId, pointer.incidentId);
    if (!incident) {
      logger.warn('incident state missing', { incidentId: pointer.incidentId });
      await deleteActivePointer(config.incidentsTableName, tenantId, env, detail.source, detail.fingerprint);
      const created = await openIncident();
      if (created) {
        succeeded = true;
        return;
      }
      throw new Error('failed to recreate missing incident');
    }

    const updatedSeverity = maxSeverity(incident.severity, severity);
    const updatedAt = new Date().toISOString();
    const eventCount = incident.eventCount + (suppressed ? 0 : 1);
    const nextVersion = incident.version + 1;

    await updateIncident(
      config.incidentsTableName,
      tenantId,
      incident.incidentId,
      {
        status: incident.status,
        severity: updatedSeverity,
        lastEventAt: detail.timestamp,
        updatedAt,
        eventCount,
        version: nextVersion,
        source: incident.source,
        env: incident.env
      },
      incident.version
    );

    if (shouldKeepActive(incident.status)) {
      await updateActivePointer(
        config.incidentsTableName,
        tenantId,
        incident.env,
        incident.source,
        incident.fingerprint,
        incident.status
      );
    } else {
      await deleteActivePointer(
        config.incidentsTableName,
        tenantId,
        incident.env,
        incident.source,
        incident.fingerprint
      );
    }

    if (!suppressed) {
      await recordIncidentEvent(
        config.incidentEventsTableName,
        tenantId,
        incident.incidentId,
        detail,
        config.incidentEventsTtlSeconds
      );
    }

    if (updatedSeverity !== incident.severity) {
      await putOutboxEvent(config.outboxTableName, {
        outboxId: `INCIDENT#${incident.incidentId}#${nextVersion}`,
        status: 'PENDING',
        eventType: 'IncidentChanged',
        source: 'sentinel.incident',
        detail: buildIncidentChangedDetail(
          { ...incident, severity: updatedSeverity, updatedAt, lastEventAt: detail.timestamp, eventCount, version: nextVersion },
          'ESCALATED',
          correlationId
        ),
        createdAt: updatedAt,
        expiresAt: Math.floor((Date.now() + config.outboxTtlSeconds * 1000) / 1000)
      });

      emitMetrics('Sentinel', [{ name: 'incidents_escalated', unit: 'Count', value: 1 }], {
        service: 'incident-engine',
        source: detail.source,
        tenantId
      });
    }

    logger.info('incident updated', {
      incidentId: incident.incidentId,
      eventCount,
      severity: updatedSeverity
    });
    succeeded = true;
  } catch (error) {
    try {
      await failEventProcessing(
        config.eventStateTableName,
        tenantId,
        detail.eventId,
        config.eventStateTtlSeconds,
        String(error)
      );
    } catch (failError) {
      logger.error('failed to mark event failed', { error: String(failError) });
    }
    throw error;
  } finally {
    if (succeeded) {
      try {
      await completeEventProcessing(
        config.eventStateTableName,
        tenantId,
        detail.eventId,
        config.eventStateTtlSeconds
      );
      } catch (error) {
        logger.warn('failed to mark event processed', { error: String(error) });
      }
    }
  }
};
