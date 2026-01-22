import { SQSEvent, SQSBatchResponse, Context, SQSRecord } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { getConfig, loadRules } from '@sentinel/config';
import { createLogger } from '@sentinel/logger';
import { emitMetrics } from '@sentinel/metrics';
import {
  buildIncidentKey,
  createIncident,
  deleteActivePointer,
  getActiveIncident,
  getIncidentById,
  recordIncidentEvent,
  updateActivePointer,
  updateIncident,
  updateDedupState,
  markEventProcessed,
  putOutboxEvent
} from '@sentinel/dynamodb';
import { buildIncidentChangedDetail } from '@sentinel/events';
import { IngestEvent, Incident, IncidentStatus, Severity, maxSeverity } from '@sentinel/domain';

const severityFromHint = (hint?: Severity): Severity => {
  return hint || 'low';
};

const evaluateSeverity = (hint: Severity | undefined, count: number, rules: Awaited<ReturnType<typeof loadRules>>) => {
  let severity = severityFromHint(hint);
  for (const rule of rules.rules) {
    if (count >= rule.threshold) {
      severity = maxSeverity(severity, rule.severity);
    }
  }
  return severity;
};

const parseRecord = (record: SQSRecord): IngestEvent & { env?: string; correlationId?: string } => {
  const body = JSON.parse(record.body);
  return body.detail || body;
};

const shouldKeepActive = (status: IncidentStatus) => status !== 'RESOLVED';

export const handler = async (
  event: SQSEvent,
  context: Context
): Promise<SQSBatchResponse> => {
  const config = getConfig();
  const rules = await loadRules(config.rulesTableName);
  const logger = createLogger({ requestId: context.awsRequestId, service: 'incident-engine' });
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      await processRecord(record, config, rules, logger);
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
  rules: Awaited<ReturnType<typeof loadRules>>,
  baseLogger: ReturnType<typeof createLogger>
) => {
  const detail = parseRecord(record) as IngestEvent & { env?: string; correlationId?: string };

  const env = typeof detail.attributes?.env === 'string' ? (detail.attributes.env as string) : config.defaultEnv;
  const correlationId = detail.correlationId || detail.eventId;
  const logger = baseLogger.withContext({
    correlationId,
    eventId: detail.eventId,
    source: detail.source,
    fingerprint: detail.fingerprint
  });

  const processed = await markEventProcessed(
    config.eventStateTableName,
    detail.eventId,
    config.eventStateTtlSeconds
  );

  if (!processed) {
    logger.info('duplicate event detected, skipping');
    return;
  }

  const dedup = await updateDedupState(
    config.eventStateTableName,
    env,
    detail.source,
    detail.fingerprint,
    config.dedupWindowMs,
    config.eventStateTtlSeconds
  );

  const suppressed = dedup.suppressed;
  if (suppressed) {
    emitMetrics('Sentinel', [{ name: 'events_deduplicated', unit: 'Count', value: 1 }], {
      service: 'incident-engine',
      source: detail.source
    });
    logger.info('event suppressed by dedup', { count: dedup.count });
  }

  const processingLatencyMs = Date.now() - new Date(detail.timestamp).getTime();
  emitMetrics('Sentinel', [{ name: 'processing_latency_ms', unit: 'Milliseconds', value: processingLatencyMs }], {
    service: 'incident-engine',
    source: detail.source
  });

  const incidentKey = buildIncidentKey(env, detail.source, detail.fingerprint);
  const active = await getActiveIncident(
    config.incidentsTableName,
    env,
    detail.source,
    detail.fingerprint
  );

  const severity = evaluateSeverity(detail.severityHint, dedup.count, rules);

  if (!active) {
    const incidentId = uuidv4();
    const now = new Date().toISOString();
    const incident: Incident = {
      incidentId,
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
      await createIncident(config.incidentsTableName, incident, env, detail.source, detail.fingerprint);
      if (!suppressed) {
        await recordIncidentEvent(
          config.incidentEventsTableName,
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
        source: detail.source
      });

      logger.info('incident opened', { incidentId, incidentKey });
      return;
    } catch (error) {
      logger.warn('race detected while opening incident, retrying', { error: String(error) });
    }
  }

  const pointer = active ||
    (await getActiveIncident(config.incidentsTableName, env, detail.source, detail.fingerprint));

  if (!pointer) {
    logger.warn('active pointer missing after create attempt');
    return;
  }

  const incident = await getIncidentById(config.incidentsTableName, pointer.incidentId);
  if (!incident) {
    logger.warn('incident state missing', { incidentId: pointer.incidentId });
    return;
  }

  const updatedSeverity = maxSeverity(incident.severity, severity);
  const updatedAt = new Date().toISOString();
  const eventCount = incident.eventCount + (suppressed ? 0 : 1);
  const nextVersion = incident.version + 1;

  await updateIncident(
    config.incidentsTableName,
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
      incident.env,
      incident.source,
      incident.fingerprint,
      incident.status
    );
  } else {
    await deleteActivePointer(config.incidentsTableName, incident.env, incident.source, incident.fingerprint);
  }

  if (!suppressed) {
    await recordIncidentEvent(
      config.incidentEventsTableName,
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
      source: detail.source
    });
  }

  logger.info('incident updated', {
    incidentId: incident.incidentId,
    eventCount,
    severity: updatedSeverity
  });
};
